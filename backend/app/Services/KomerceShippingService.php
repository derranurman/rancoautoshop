<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Thin wrapper for Komerce Collaborator API (the new "RajaOngkir").
 *
 * Why this exists separately from RajaOngkirService:
 *   The legacy RajaOngkir API (api.rajaongkir.com/starter) and the new
 *   Komerce Collaborator API (api[-sandbox].collaborator.komerce.id) have
 *   fundamentally different shapes:
 *     - Legacy is hierarchical (province → city → subdistrict, 3 IDs).
 *     - Komerce is flat: a single destination_id encodes the full address
 *       including kelurahan + zip. There is no separate province/city/
 *       subdistrict resource.
 *   Mixing both behind one class made the orchestrator unreadable, so we
 *   keep RajaOngkirService for the hierarchical lookups (served from the
 *   curated mock dataset) and isolate the live cost calculation here.
 *
 * Lifecycle inside a checkout request:
 *   1. RajaOngkirService::cost() is called with a mock city_id /
 *      subdistrict_id (whatever the address dropdown produced).
 *   2. It calls our resolveDestinationId() with the city/subdistrict
 *      *names* + postal code, which we use to search the Komerce
 *      destination index. The resolved Komerce id is cached forever
 *      (the mapping is stable — Indonesian admin codes don't move).
 *   3. RajaOngkirService::cost() then calls calculateCost() with that id.
 *
 * Failure handling:
 *   Every public method returns null / [] on any error and logs a warning.
 *   Callers are expected to fall back (RajaOngkirService falls back to
 *   the mock pricing model on null/empty), so a flaky upstream never
 *   surfaces a blank ongkir to the customer.
 *
 * Quota notes:
 *   The Komerce starter (sandbox) tier is 100 requests/day. We aggressively
 *   cache both the destination resolution (forever) and the cost result
 *   (6h, matching legacy) to minimize upstream calls. A typical store with
 *   repeat customers will hit cache > 90% of the time.
 */
class KomerceShippingService
{
    /** Per-call HTTP timeouts — short, since we'd rather fall back than hang. */
    protected const HTTP_CONNECT_TIMEOUT = 4;
    protected const HTTP_TIMEOUT         = 8;

    /** Bump these when changing parsing/normalization so old cache entries don't poison new code. */
    protected const CACHE_VER_DESTINATION = 'v1';
    protected const CACHE_VER_COST        = 'v1';

    /**
     * Map our internal courier codes (used by the frontend & legacy
     * RajaOngkir code) to Komerce's expected codes. Komerce actually uses
     * the same lowercase codes for the big four (jne/jnt/pos/tiki) — this
     * map exists mainly as a single source of truth and so adding sicepat,
     * anteraja, ninja, ide etc. in the future is just one line.
     */
    protected const COURIER_MAP = [
        'jne'  => 'jne',
        'jnt'  => 'jnt',
        'pos'  => 'pos',
        'tiki' => 'tiki',
    ];

    protected string $baseUrl;
    protected ?string $apiKey;
    protected ?string $originDestinationId;
    protected bool $configEnabled;

    public function __construct()
    {
        $this->baseUrl             = (string) config('services.komerce.base_url');
        $this->apiKey              = config('services.komerce.api_key');
        $this->originDestinationId = config('services.komerce.origin_destination_id');
        $this->configEnabled       = (bool) config('services.komerce.enabled', false);
    }

    /**
     * Whether this service is fully configured and turned on.
     *
     * Both the API key AND an origin destination id must be present —
     * without origin we can't run a cost calc, so it's not "enabled" in
     * any useful sense. The dedicated `enabled` toggle lets ops disable
     * Komerce entirely (e.g., during quota outage) without removing the
     * key from .env.
     */
    public function enabled(): bool
    {
        return $this->configEnabled
            && ! empty($this->apiKey)
            && ! empty($this->originDestinationId)
            && ! empty($this->baseUrl);
    }

    /**
     * Search Komerce's destination index. Returns the raw `data` array
     * exactly as Komerce returns it (each entry has at least:
     * id, label, province_name, city_name, district_name, subdistrict_name,
     * zip_code). Used directly by the admin "find my origin id" helper
     * endpoint.
     *
     * No caching here — callers (resolveDestinationId, the search route)
     * cache at a higher level using their own keys.
     */
    public function searchDestination(string $query, int $limit = 10): array
    {
        $query = trim($query);
        if ($query === '' || ! $this->apiKey) {
            return [];
        }

        try {
            $res = Http::connectTimeout(self::HTTP_CONNECT_TIMEOUT)
                ->timeout(self::HTTP_TIMEOUT)
                ->withHeaders(['x-api-key' => $this->apiKey])
                ->get(rtrim($this->baseUrl, '/').'/tariff/api/v1/destination/domestic-destination', [
                    'search' => $query,
                    'limit'  => max(1, min($limit, 50)),
                    'offset' => 0,
                ]);

            if (! $res->successful()) {
                Log::warning('[komerce] search destination non-2xx', [
                    'status' => $res->status(),
                    'query'  => $query,
                    'body'   => mb_substr((string) $res->body(), 0, 500),
                ]);
                return [];
            }

            $rows = $res->json('data') ?? [];
            return is_array($rows) ? $rows : [];
        } catch (\Throwable $e) {
            Log::warning('[komerce] search destination failed: '.$e->getMessage(), ['query' => $query]);
            return [];
        }
    }

    /**
     * Resolve a Komerce destination_id from the address fields we already
     * have (city name, optional subdistrict/kecamatan name, optional
     * postal code). Returns null if no plausible match was found — the
     * caller is expected to fall back to mock pricing in that case.
     *
     * Strategy:
     *   We try a few search queries from most-specific to least-specific
     *   and stop at the first one that yields a confident match. The
     *   resolved id is cached *forever* under a normalized key, because
     *   Indonesian kecamatan/postal codes are essentially static — the
     *   mapping shouldn't change between deployments.
     *
     * Match scoring picks the row whose (city_name + subdistrict_name +
     * zip_code) tokens overlap the most with the inputs, with postal code
     * as a strong tiebreaker. This avoids picking "Cipedes, Bandung" when
     * the customer typed "Cipedes, Tasikmalaya".
     */
    public function resolveDestinationId(string $cityName, ?string $subdistrictName = null, ?string $postalCode = null): ?int
    {
        $cityName        = trim($cityName);
        $subdistrictName = $subdistrictName !== null ? trim($subdistrictName) : null;
        $postalCode      = $postalCode !== null ? trim($postalCode) : null;

        if ($cityName === '' || ! $this->apiKey) {
            return null;
        }

        $cacheKey = sprintf(
            'komerce.%s.dest.%s|%s|%s',
            self::CACHE_VER_DESTINATION,
            $this->normalize($cityName),
            $this->normalize($subdistrictName ?? ''),
            $this->normalize($postalCode ?? ''),
        );

        // Cache::rememberForever wraps null too if we use sentinel — but
        // we *don't* want to cache "not found" forever (a future deploy
        // might add the data, or upstream may have been down). Cache hits
        // only when we have a real id; misses stay un-cached.
        $cached = Cache::get($cacheKey);
        if (is_int($cached) && $cached > 0) {
            return $cached;
        }

        // Strip "Kota " / "Kabupaten " prefix from city name — Komerce's
        // index is keyed on the bare locality name. "Kota Tasikmalaya"
        // matches nothing, "Tasikmalaya" matches plenty.
        $bareCity = preg_replace('/^(kota|kabupaten|kab\.?)\s+/i', '', $cityName);

        // Build candidate queries, most specific first.
        $queries = [];
        if ($subdistrictName) {
            $queries[] = $subdistrictName.' '.$bareCity;
        }
        if ($postalCode) {
            $queries[] = $postalCode;
        }
        $queries[] = $bareCity;
        $queries = array_values(array_unique(array_filter($queries, fn ($q) => trim((string) $q) !== '')));

        $best = null;
        $bestScore = -1;
        foreach ($queries as $q) {
            $rows = $this->searchDestination($q, 20);
            foreach ($rows as $row) {
                $score = $this->scoreMatch($row, $cityName, $subdistrictName, $postalCode);
                if ($score > $bestScore) {
                    $bestScore = $score;
                    $best = $row;
                }
            }
            // If we got a strong match (≥ 5: matches city + subdistrict + zip),
            // stop early — searching further queries is just burning quota.
            if ($bestScore >= 5) {
                break;
            }
        }

        if ($best === null || $bestScore < 1) {
            Log::warning('[komerce] destination not resolved', [
                'city'        => $cityName,
                'subdistrict' => $subdistrictName,
                'postal'      => $postalCode,
            ]);
            return null;
        }

        $id = isset($best['id']) ? (int) $best['id'] : 0;
        if ($id <= 0) {
            return null;
        }

        Cache::forever($cacheKey, $id);
        return $id;
    }

    /**
     * Calculate ongkir for a single courier between two Komerce destinations.
     *
     * Returns a flat array of services normalized to the legacy shape so
     * the frontend doesn't need to know which provider answered:
     *   [
     *     ['courier' => 'jne', 'service' => 'REG', 'description' => 'Reguler',
     *      'cost' => 12000, 'etd' => '2-3'],
     *     ...
     *   ]
     *
     * Returns [] on any failure — callers should fall back to mock.
     */
    public function calculateCost(int $originId, int $destinationId, int $weightGram, string $courier): array
    {
        $courier = strtolower(trim($courier));
        $courierKomerce = self::COURIER_MAP[$courier] ?? $courier;
        $weight = max(1, $weightGram);

        if (! $this->apiKey || $originId <= 0 || $destinationId <= 0) {
            return [];
        }

        $cacheKey = sprintf(
            'komerce.%s.cost.%d.%d.%d.%s',
            self::CACHE_VER_COST,
            $originId,
            $destinationId,
            $weight,
            $courierKomerce
        );

        return Cache::remember($cacheKey, now()->addHours(6), function () use ($originId, $destinationId, $weight, $courierKomerce) {
            try {
                // Komerce's calculate endpoint expects form-encoded body
                // with these field names (origin/destination = destination_id,
                // courier = colon-separated, price = "lowest"|"highest" sort).
                $res = Http::connectTimeout(self::HTTP_CONNECT_TIMEOUT)
                    ->timeout(self::HTTP_TIMEOUT)
                    ->asForm()
                    ->withHeaders(['x-api-key' => $this->apiKey])
                    ->post(rtrim($this->baseUrl, '/').'/tariff/api/v1/calculate/domestic-cost', [
                        'origin'      => (string) $originId,
                        'destination' => (string) $destinationId,
                        'weight'      => (string) $weight,
                        'courier'     => $courierKomerce,
                        'price'       => 'lowest',
                    ]);

                if (! $res->successful()) {
                    Log::warning('[komerce] calculate cost non-2xx', [
                        'status' => $res->status(),
                        'origin' => $originId,
                        'dest'   => $destinationId,
                        'body'   => mb_substr((string) $res->body(), 0, 500),
                    ]);
                    return [];
                }

                return $this->normalizeCostResponse($res->json('data'), $courier);
            } catch (\Throwable $e) {
                Log::warning('[komerce] calculate cost failed: '.$e->getMessage(), [
                    'origin' => $originId,
                    'dest'   => $destinationId,
                ]);
                return [];
            }
        });
    }

    /**
     * Komerce returns three categories: calculate_reguler, calculate_cargo,
     * calculate_instant — all share the same row shape but only the first
     * is universally available. We flatten all three into the legacy
     * RajaOngkir shape ({courier, service, description, cost, etd}).
     *
     * - `service` is set to the upstream `service_name` (REG, YES, OKE, ...)
     * - `description` is set to `service_name` repeated when no human label
     *   is given by the API; the frontend already falls back gracefully.
     * - `cost` uses `grandtotal` rather than `shipping_cost_net` so any
     *   service fees Komerce charges are visible to the customer.
     */
    protected function normalizeCostResponse(mixed $data, string $courierLegacyCode): array
    {
        if (! is_array($data)) {
            return [];
        }

        $out = [];
        foreach (['calculate_reguler', 'calculate_cargo', 'calculate_instant'] as $bucket) {
            $rows = $data[$bucket] ?? [];
            if (! is_array($rows)) {
                continue;
            }
            foreach ($rows as $r) {
                if (! is_array($r)) {
                    continue;
                }
                $cost = (int) ($r['grandtotal'] ?? $r['shipping_cost_net'] ?? $r['shipping_cost'] ?? 0);
                if ($cost <= 0) {
                    continue;
                }
                $service = (string) ($r['service_name'] ?? '');
                if ($service === '') {
                    continue;
                }
                $out[] = [
                    // Always emit the *legacy* code (jne/jnt/pos/tiki) so
                    // the frontend's existing courier filter works without
                    // changes, even if Komerce upstream returns "JNE" etc.
                    'courier'     => $courierLegacyCode,
                    'service'     => $service,
                    'description' => trim((string) ($r['shipping_name'] ?? $service.' '.strtoupper($courierLegacyCode))),
                    'cost'        => $cost,
                    'etd'         => trim((string) ($r['etd'] ?? '')),
                ];
            }
        }
        return $out;
    }

    /**
     * Lowercase + collapse whitespace + strip common admin prefixes ("Kota ",
     * "Kabupaten ", "Kec. ", "Kel. ") + remove punctuation. Used both for
     * cache keys and match scoring so they stay consistent.
     */
    protected function normalize(string $s): string
    {
        $s = mb_strtolower(trim($s));
        $s = preg_replace('/\b(kota|kabupaten|kab\.?|kec\.?|kel\.?|kecamatan|kelurahan|provinsi|prov\.?)\b/u', '', $s);
        $s = preg_replace('/[^\p{L}\p{N}\s]/u', ' ', $s);
        $s = preg_replace('/\s+/u', ' ', $s);
        return trim($s);
    }

    /**
     * Score how well a Komerce destination row matches the inputs.
     * Higher is better. Postal code is the strongest signal (3 points)
     * because two villages can share a name but not a postal code.
     */
    protected function scoreMatch(array $row, string $cityName, ?string $subdistrictName, ?string $postalCode): int
    {
        $score = 0;
        $rowCity        = $this->normalize((string) ($row['city_name'] ?? ''));
        $rowDistrict    = $this->normalize((string) ($row['district_name'] ?? ''));
        $rowSubdistrict = $this->normalize((string) ($row['subdistrict_name'] ?? ''));
        $rowZip         = trim((string) ($row['zip_code'] ?? ''));

        $needCity = $this->normalize($cityName);
        if ($needCity !== '' && $rowCity !== '' && (str_contains($rowCity, $needCity) || str_contains($needCity, $rowCity))) {
            $score += 2;
        }

        if ($subdistrictName) {
            $needSub = $this->normalize($subdistrictName);
            if ($needSub !== '' && (
                str_contains($rowDistrict, $needSub)
                || str_contains($rowSubdistrict, $needSub)
                || str_contains($needSub, $rowDistrict)
            )) {
                $score += 2;
            }
        }

        if ($postalCode && $rowZip !== '' && $postalCode === $rowZip) {
            $score += 3;
        }

        return $score;
    }

    /**
     * Convenience getter so RajaOngkirService doesn't need to read config
     * directly when it already has us injected.
     */
    public function originDestinationId(): ?int
    {
        $id = (int) ($this->originDestinationId ?? 0);
        return $id > 0 ? $id : null;
    }
}
