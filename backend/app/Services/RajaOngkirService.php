<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Thin wrapper for RajaOngkir (starter plan) + the new Komerce
 * Collaborator API which superseded it.
 *
 * Docs:
 *  - Legacy: https://rajaongkir.com/dokumentasi
 *  - Komerce Collaborator: https://collaborator.komerce.id
 *
 * Resolution order for a cost lookup:
 *   1. If Komerce is configured & enabled → delegate to KomerceShippingService
 *      (real-time prices, counts against your Komerce quota).
 *   2. Else if a legacy RajaOngkir api_key is set → call the legacy
 *      api.rajaongkir.com/starter endpoint (still works for accounts
 *      grandfathered before the Komerce migration).
 *   3. Else → destination-aware mock so the dev UI still produces realistic,
 *      varied shipping prices end-to-end without any external calls.
 *
 * Provinces / cities / subdistricts always come from the curated mock
 * dataset — Indonesian admin geography is essentially static and the
 * Komerce API has a different (flat) shape that doesn't map onto our
 * cascading dropdowns. Keeping the dropdowns mock-backed avoids burning
 * Komerce quota on data that never changes.
 *
 * Caching strategy:
 * - provinces: 24h (very static)
 * - cities per province: 24h (very static)
 * - cost per origin/destination/weight/courier: 6h (price rarely changes
 *   intra-day; lets repeat checkout views render instantly without hitting
 *   the upstream API and prevents PHP-FPM worker exhaustion when the user
 *   toggles couriers repeatedly).
 *
 * Cache keys are versioned so changes to the mock dataset / pricing model
 * automatically invalidate stale entries on the next request.
 */
class RajaOngkirService
{
    /** Couriers actually allowed by RajaOngkir's starter plan. */
    protected const STARTER_COURIERS = ['jne', 'pos', 'tiki'];

    /** Per-call HTTP timeouts (kept short — we'd rather mock than hang the UI). */
    protected const HTTP_CONNECT_TIMEOUT = 3;
    protected const HTTP_TIMEOUT         = 5;

    /**
     * Bump these when changing mock data / pricing logic so old Cache::remember
     * entries don't keep serving stale results to the UI.
     */
    protected const CACHE_VER_PROVINCES    = 'v2';
    protected const CACHE_VER_CITIES       = 'v2';
    protected const CACHE_VER_SUBDISTRICTS = 'v1';
    protected const CACHE_VER_COST         = 'v4';

    protected string $baseUrl;
    protected ?string $apiKey;
    protected string $originCityId;
    protected KomerceShippingService $komerce;

    public function __construct(KomerceShippingService $komerce)
    {
        $this->baseUrl      = (string) config('services.rajaongkir.base_url');
        $this->apiKey       = config('services.rajaongkir.api_key');
        $this->originCityId = (string) config('services.rajaongkir.origin_city_id');
        $this->komerce      = $komerce;
    }

    public function enabled(): bool
    {
        return ! empty($this->apiKey);
    }

    /** GET /province */
    public function provinces(): array
    {
        if (! $this->enabled()) {
            return $this->mockProvinces();
        }
        return Cache::remember('rajaongkir.'.self::CACHE_VER_PROVINCES.'.provinces', now()->addHours(24), function () {
            try {
                $res = Http::connectTimeout(self::HTTP_CONNECT_TIMEOUT)
                    ->timeout(self::HTTP_TIMEOUT)
                    ->withHeaders(['key' => $this->apiKey])
                    ->get("{$this->baseUrl}/province");
                $rows = $res->json('rajaongkir.results') ?? [];
                // If RajaOngkir returns nothing (bad key, plan limit, downtime),
                // don't leave the dropdown empty — fall back to the mock list.
                return ! empty($rows) ? $rows : $this->mockProvinces();
            } catch (\Throwable $e) {
                Log::warning('[rajaongkir] provinces failed: '.$e->getMessage());
                return $this->mockProvinces();
            }
        });
    }

    /** GET /city?province=ID */
    public function cities(?string $provinceId = null): array
    {
        if (! $this->enabled()) {
            return $this->mockCities($provinceId);
        }
        $cacheKey = 'rajaongkir.'.self::CACHE_VER_CITIES.'.cities.'.($provinceId ?: 'all');
        return Cache::remember($cacheKey, now()->addHours(24), function () use ($provinceId) {
            try {
                $res = Http::connectTimeout(self::HTTP_CONNECT_TIMEOUT)
                    ->timeout(self::HTTP_TIMEOUT)
                    ->withHeaders(['key' => $this->apiKey])
                    ->get("{$this->baseUrl}/city", array_filter(['province' => $provinceId]));
                $rows = $res->json('rajaongkir.results') ?? [];
                return ! empty($rows) ? $rows : $this->mockCities($provinceId);
            } catch (\Throwable $e) {
                Log::warning('[rajaongkir] cities failed: '.$e->getMessage());
                return $this->mockCities($provinceId);
            }
        });
    }

    /**
     * POST /cost
     *
     * @param  string       $destinationCityId  RajaOngkir destination city id
     * @param  int          $weightGram         total weight in grams
     * @param  string       $courier            jne|pos|tiki (starter); jnt always mock
     * @param  string|null  $subdistrictId      RajaOngkir Pro subdistrict (kecamatan) id, optional —
     *                                          when present, applies a small kecamatan-level
     *                                          adjustment on top of the city-zone tariff so two
     *                                          addresses in the same city but different kecamatan
     *                                          don't render identical ongkir.
     */
    public function cost(string $destinationCityId, int $weightGram, string $courier = 'jne', ?string $subdistrictId = null): array
    {
        $courier = strtolower(trim($courier));
        $weight  = max(1, $weightGram);

        // ============================================================
        // Path 1: Komerce Collaborator API (preferred for go-live).
        // ============================================================
        // When Komerce is configured we go through the Komerce service for
        // live pricing. We still cache the *result* at this layer (in
        // addition to KomerceShippingService's own per-call cache) so that
        // a checkout view re-rendered with no input changes never hits any
        // service call at all — the cache versioning (`v4`) plus the
        // explicit "komerce" namespace prevents this entry from ever
        // colliding with the legacy RajaOngkir cache key below.
        if ($this->komerce->enabled()) {
            $komerceCacheKey = sprintf(
                'rajaongkir.%s.komerce.cost.%s.%s.%s.%d.%s',
                self::CACHE_VER_COST,
                $this->originCityId,
                $destinationCityId,
                $subdistrictId ?: '-',
                $weight,
                $courier
            );

            return Cache::remember($komerceCacheKey, now()->addHours(6), function () use ($destinationCityId, $weight, $courier, $subdistrictId) {
                $rows = $this->costViaKomerce($destinationCityId, $weight, $courier, $subdistrictId);
                // Empty result means upstream couldn't quote (destination
                // not resolvable, courier not served at that lane, quota
                // exhausted, network error, ...). Fall back to the mock so
                // the customer still sees an option rather than a blank
                // courier list — the service has already logged the cause.
                return ! empty($rows)
                    ? $rows
                    : $this->mockCost($courier, $weight, $destinationCityId, $subdistrictId);
            });
        }

        // ============================================================
        // Path 2: Legacy RajaOngkir starter API.
        // ============================================================
        // Short-circuit: starter plan does not support J&T (jnt), so calling
        // RajaOngkir always wastes a full round-trip before failing. Just
        // serve the mock immediately for a snappy UI.
        if (! $this->enabled() || ! in_array($courier, self::STARTER_COURIERS, true)) {
            return $this->mockCost($courier, $weight, $destinationCityId, $subdistrictId);
        }

        $cacheKey = sprintf(
            'rajaongkir.%s.cost.%s.%s.%s.%d.%s',
            self::CACHE_VER_COST,
            $this->originCityId,
            $destinationCityId,
            $subdistrictId ?: '-',
            $weight,
            $courier
        );

        return Cache::remember($cacheKey, now()->addHours(6), function () use ($destinationCityId, $weight, $courier, $subdistrictId) {
            try {
                $res = Http::connectTimeout(self::HTTP_CONNECT_TIMEOUT)
                    ->timeout(self::HTTP_TIMEOUT)
                    ->asForm()
                    ->withHeaders(['key' => $this->apiKey])
                    ->post("{$this->baseUrl}/cost", array_filter([
                        'origin'      => $this->originCityId,
                        'destination' => $destinationCityId,
                        // Pro plan accepts originType/destinationType=subdistrict —
                        // we don't enable that here because most installs are on
                        // starter; subdistrict is only used to add granularity to
                        // the local mock when it kicks in.
                        'weight'      => $weight,
                        'courier'     => $courier,
                    ]));
                $results = $res->json('rajaongkir.results') ?? [];
                // Flatten costs array for easier frontend consumption.
                $flat = [];
                foreach ($results as $r) {
                    foreach (($r['costs'] ?? []) as $c) {
                        $flat[] = [
                            'courier'     => $r['code'] ?? $courier,
                            'service'     => $c['service'] ?? null,
                            'description' => $c['description'] ?? null,
                            'cost'        => (int) (($c['cost'][0]['value'] ?? 0)),
                            'etd'         => $c['cost'][0]['etd'] ?? null,
                        ];
                    }
                }
                return ! empty($flat) ? $flat : $this->mockCost($courier, $weight, $destinationCityId, $subdistrictId);
            } catch (\Throwable $e) {
                Log::warning('[rajaongkir] cost failed: '.$e->getMessage());
                return $this->mockCost($courier, $weight, $destinationCityId, $subdistrictId);
            }
        });
    }

    /**
     * GET /subdistrict?city=ID  (RajaOngkir Pro)
     *
     * Returns kecamatan-level rows for a given city. Most installs run on
     * the starter plan (which does not expose this endpoint), so we serve
     * a curated mock dataset for the major cities. Cities without mock
     * data return an empty list — the frontend treats that as "kecamatan
     * not available, fall back to city-level ongkir".
     */
    public function subdistricts(?string $cityId = null): array
    {
        if (! $cityId) {
            return [];
        }

        // The Starter plan does not have /subdistrict. Trying to call it
        // would 403 every single time, so we go straight to the mock.
        // (When this codebase eventually upgrades to Pro, swap the guard
        // for an explicit `services.rajaongkir.plan === 'pro'` check.)
        if (! $this->enabled()) {
            return $this->mockSubdistricts($cityId);
        }

        $cacheKey = 'rajaongkir.'.self::CACHE_VER_SUBDISTRICTS.'.subdistricts.'.$cityId;
        return Cache::remember($cacheKey, now()->addHours(24), function () use ($cityId) {
            try {
                $res = Http::connectTimeout(self::HTTP_CONNECT_TIMEOUT)
                    ->timeout(self::HTTP_TIMEOUT)
                    ->withHeaders(['key' => $this->apiKey])
                    ->get("{$this->baseUrl}/subdistrict", ['city' => $cityId]);
                $rows = $res->json('rajaongkir.results') ?? [];
                if (empty($rows)) {
                    return $this->mockSubdistricts($cityId);
                }
                // Pro returns a denser shape; normalize down to the keys our
                // frontend uses so swapping plans doesn't require any FE work.
                return array_map(fn ($r) => [
                    'subdistrict_id'   => (string) ($r['subdistrict_id'] ?? ''),
                    'city_id'          => (string) ($r['city_id'] ?? $cityId),
                    'subdistrict_name' => (string) ($r['subdistrict_name'] ?? ''),
                ], $rows);
            } catch (\Throwable $e) {
                Log::warning('[rajaongkir] subdistricts failed: '.$e->getMessage());
                return $this->mockSubdistricts($cityId);
            }
        });
    }

    // --------------------- komerce delegation helpers ---------------------

    /**
     * Resolve our mock city_id (+ optional subdistrict_id) into a Komerce
     * destination_id, then ask Komerce to calculate the cost for that
     * origin/destination pair. Returns [] on any failure so the caller can
     * fall back to the mock pricing.
     *
     * The flow lives here (not in KomerceShippingService) because only
     * RajaOngkirService knows the mock dataset that the frontend dropdown
     * IDs come from. KomerceShippingService just deals in name+postal
     * tuples that any layer can supply.
     */
    protected function costViaKomerce(string $destinationCityId, int $weightGram, string $courier, ?string $subdistrictId): array
    {
        $cityRow = $this->findMockCityById($destinationCityId);
        if ($cityRow === null) {
            // Address points at a city_id we don't know about (could be a
            // legacy id from before the dataset was rebuilt). Bail and let
            // the caller fall back to mock pricing.
            Log::warning('[komerce-bridge] city_id not found in mock dataset', [
                'city_id' => $destinationCityId,
            ]);
            return [];
        }

        $cityName        = (string) ($cityRow['city_name'] ?? '');
        $postalCode      = (string) ($cityRow['postal_code'] ?? '');
        $subdistrictName = $subdistrictId
            ? $this->findMockSubdistrictName($destinationCityId, $subdistrictId)
            : null;

        $destinationKomerceId = $this->komerce->resolveDestinationId(
            $cityName,
            $subdistrictName,
            $postalCode !== '' ? $postalCode : null,
        );
        if ($destinationKomerceId === null) {
            return [];
        }

        $originKomerceId = $this->komerce->originDestinationId();
        if ($originKomerceId === null) {
            // enabled() already guarded against this; defensive double-check.
            return [];
        }

        return $this->komerce->calculateCost(
            $originKomerceId,
            $destinationKomerceId,
            $weightGram,
            $courier,
        );
    }

    /**
     * Look up a city row from the mock dataset by city_id. Returns null
     * if the id isn't in the curated list. The mock dataset is the source
     * of truth for the dropdowns the customer sees, so any id the frontend
     * sends back here should be findable — anything else means stale
     * client cache or a manually crafted request.
     */
    protected function findMockCityById(string $cityId): ?array
    {
        if ($cityId === '') {
            return null;
        }
        // mockCities(null) returns the flattened list across all provinces.
        foreach ($this->mockCities(null) as $row) {
            if ((string) ($row['city_id'] ?? '') === $cityId) {
                return $row;
            }
        }
        return null;
    }

    /**
     * Look up a subdistrict's display name from the mock dataset.
     * Returns null when the id isn't found — caller falls back to
     * city-level resolution, which Komerce still handles fine.
     */
    protected function findMockSubdistrictName(string $cityId, string $subdistrictId): ?string
    {
        foreach ($this->mockSubdistricts($cityId) as $row) {
            if ((string) ($row['subdistrict_id'] ?? '') === $subdistrictId) {
                $name = trim((string) ($row['subdistrict_name'] ?? ''));
                return $name !== '' ? $name : null;
            }
        }
        return null;
    }

    // --------------------- mocks ---------------------

    /**
     * Mock list of all 34 RajaOngkir provinces.
     *
     * IDs are unique within this dataset (3 collisions in the previous
     * version — DI Yogyakarta vs Kepulauan Riau on '5', and Sumatera Barat
     * vs Papua Barat on '24' — caused several provinces' city dropdowns to
     * silently load the wrong list or stay empty).
     */
    protected function mockProvinces(): array
    {
        return [
            ['province_id' => '21', 'province' => 'Aceh'],
            ['province_id' => '32', 'province' => 'Sumatera Utara'],
            ['province_id' => '24', 'province' => 'Sumatera Barat'],
            ['province_id' => '26', 'province' => 'Riau'],
            ['province_id' => '7',  'province' => 'Kepulauan Riau'],
            ['province_id' => '8',  'province' => 'Jambi'],
            ['province_id' => '33', 'province' => 'Sumatera Selatan'],
            ['province_id' => '4',  'province' => 'Bangka Belitung'],
            ['province_id' => '2',  'province' => 'Bengkulu'],
            ['province_id' => '18', 'province' => 'Lampung'],
            ['province_id' => '6',  'province' => 'DKI Jakarta'],
            ['province_id' => '3',  'province' => 'Banten'],
            ['province_id' => '9',  'province' => 'Jawa Barat'],
            ['province_id' => '10', 'province' => 'Jawa Tengah'],
            ['province_id' => '5',  'province' => 'DI Yogyakarta'],
            ['province_id' => '11', 'province' => 'Jawa Timur'],
            ['province_id' => '1',  'province' => 'Bali'],
            ['province_id' => '22', 'province' => 'Nusa Tenggara Barat'],
            ['province_id' => '23', 'province' => 'Nusa Tenggara Timur'],
            ['province_id' => '12', 'province' => 'Kalimantan Barat'],
            ['province_id' => '13', 'province' => 'Kalimantan Tengah'],
            ['province_id' => '14', 'province' => 'Kalimantan Selatan'],
            ['province_id' => '15', 'province' => 'Kalimantan Timur'],
            ['province_id' => '35', 'province' => 'Kalimantan Utara'],
            ['province_id' => '31', 'province' => 'Sulawesi Utara'],
            ['province_id' => '34', 'province' => 'Gorontalo'],
            ['province_id' => '29', 'province' => 'Sulawesi Tengah'],
            ['province_id' => '28', 'province' => 'Sulawesi Selatan'],
            ['province_id' => '30', 'province' => 'Sulawesi Tenggara'],
            ['province_id' => '27', 'province' => 'Sulawesi Barat'],
            ['province_id' => '20', 'province' => 'Maluku'],
            ['province_id' => '19', 'province' => 'Maluku Utara'],
            ['province_id' => '16', 'province' => 'Papua Barat'],
            ['province_id' => '25', 'province' => 'Papua'],
        ];
    }

    /**
     * Mock cities per province with both Kota and Kabupaten entries.
     *
     * Pre-existing city_ids (those used by previously saved addresses) are
     * preserved verbatim. Newly added Kabupaten/Kota entries use synthetic
     * IDs in the 90000+ range to avoid colliding with real RajaOngkir IDs
     * if/when the project switches to a live API key.
     */
    protected function mockCities(?string $provinceId): array
    {
        $all = [
            // Aceh
            '21' => [
                ['city_id' => '17',    'province_id' => '21', 'type' => 'Kota',      'city_name' => 'Banda Aceh',     'postal_code' => '23111'],
                ['city_id' => '236',   'province_id' => '21', 'type' => 'Kota',      'city_name' => 'Lhokseumawe',    'postal_code' => '24351'],
                ['city_id' => '90101', 'province_id' => '21', 'type' => 'Kota',      'city_name' => 'Sabang',         'postal_code' => '23512'],
                ['city_id' => '90102', 'province_id' => '21', 'type' => 'Kota',      'city_name' => 'Langsa',         'postal_code' => '24411'],
                ['city_id' => '90103', 'province_id' => '21', 'type' => 'Kabupaten', 'city_name' => 'Aceh Besar',     'postal_code' => '23911'],
                ['city_id' => '90104', 'province_id' => '21', 'type' => 'Kabupaten', 'city_name' => 'Aceh Utara',     'postal_code' => '24382'],
                ['city_id' => '90105', 'province_id' => '21', 'type' => 'Kabupaten', 'city_name' => 'Bireuen',        'postal_code' => '24251'],
                ['city_id' => '90106', 'province_id' => '21', 'type' => 'Kabupaten', 'city_name' => 'Pidie',          'postal_code' => '24116'],
                ['city_id' => '90107', 'province_id' => '21', 'type' => 'Kabupaten', 'city_name' => 'Aceh Tamiang',   'postal_code' => '24476'],
                ['city_id' => '90108', 'province_id' => '21', 'type' => 'Kabupaten', 'city_name' => 'Aceh Barat',     'postal_code' => '23681'],
            ],
            // Sumatera Utara
            '32' => [
                ['city_id' => '278',   'province_id' => '32', 'type' => 'Kota',      'city_name' => 'Medan',             'postal_code' => '20111'],
                ['city_id' => '52',    'province_id' => '32', 'type' => 'Kota',      'city_name' => 'Binjai',            'postal_code' => '20712'],
                ['city_id' => '419',   'province_id' => '32', 'type' => 'Kota',      'city_name' => 'Pematang Siantar',  'postal_code' => '21111'],
                ['city_id' => '90201', 'province_id' => '32', 'type' => 'Kota',      'city_name' => 'Sibolga',           'postal_code' => '22513'],
                ['city_id' => '90202', 'province_id' => '32', 'type' => 'Kota',      'city_name' => 'Tebing Tinggi',     'postal_code' => '20611'],
                ['city_id' => '90203', 'province_id' => '32', 'type' => 'Kota',      'city_name' => 'Tanjung Balai',     'postal_code' => '21311'],
                ['city_id' => '90204', 'province_id' => '32', 'type' => 'Kota',      'city_name' => 'Padang Sidempuan',  'postal_code' => '22713'],
                ['city_id' => '90205', 'province_id' => '32', 'type' => 'Kabupaten', 'city_name' => 'Deli Serdang',      'postal_code' => '20511'],
                ['city_id' => '90206', 'province_id' => '32', 'type' => 'Kabupaten', 'city_name' => 'Langkat',           'postal_code' => '20811'],
                ['city_id' => '90207', 'province_id' => '32', 'type' => 'Kabupaten', 'city_name' => 'Karo',              'postal_code' => '22111'],
                ['city_id' => '90208', 'province_id' => '32', 'type' => 'Kabupaten', 'city_name' => 'Asahan',            'postal_code' => '21214'],
                ['city_id' => '90209', 'province_id' => '32', 'type' => 'Kabupaten', 'city_name' => 'Serdang Bedagai',   'postal_code' => '20991'],
                ['city_id' => '90210', 'province_id' => '32', 'type' => 'Kabupaten', 'city_name' => 'Toba Samosir',      'postal_code' => '22316'],
            ],
            // Sumatera Barat
            '24' => [
                ['city_id' => '341',   'province_id' => '24', 'type' => 'Kota',      'city_name' => 'Padang',          'postal_code' => '25111'],
                ['city_id' => '54',    'province_id' => '24', 'type' => 'Kota',      'city_name' => 'Bukittinggi',     'postal_code' => '26111'],
                ['city_id' => '90301', 'province_id' => '24', 'type' => 'Kota',      'city_name' => 'Payakumbuh',      'postal_code' => '26211'],
                ['city_id' => '90302', 'province_id' => '24', 'type' => 'Kota',      'city_name' => 'Pariaman',        'postal_code' => '25513'],
                ['city_id' => '90303', 'province_id' => '24', 'type' => 'Kota',      'city_name' => 'Solok',           'postal_code' => '27315'],
                ['city_id' => '90304', 'province_id' => '24', 'type' => 'Kabupaten', 'city_name' => 'Padang Pariaman', 'postal_code' => '25584'],
                ['city_id' => '90305', 'province_id' => '24', 'type' => 'Kabupaten', 'city_name' => 'Agam',            'postal_code' => '26411'],
                ['city_id' => '90306', 'province_id' => '24', 'type' => 'Kabupaten', 'city_name' => 'Tanah Datar',     'postal_code' => '27211'],
                ['city_id' => '90307', 'province_id' => '24', 'type' => 'Kabupaten', 'city_name' => 'Lima Puluh Kota', 'postal_code' => '26271'],
                ['city_id' => '90308', 'province_id' => '24', 'type' => 'Kabupaten', 'city_name' => 'Pesisir Selatan', 'postal_code' => '25611'],
            ],
            // Riau
            '26' => [
                ['city_id' => '350',   'province_id' => '26', 'type' => 'Kota',      'city_name' => 'Pekanbaru',     'postal_code' => '28111'],
                ['city_id' => '125',   'province_id' => '26', 'type' => 'Kota',      'city_name' => 'Dumai',         'postal_code' => '28811'],
                ['city_id' => '90401', 'province_id' => '26', 'type' => 'Kabupaten', 'city_name' => 'Kampar',        'postal_code' => '28411'],
                ['city_id' => '90402', 'province_id' => '26', 'type' => 'Kabupaten', 'city_name' => 'Bengkalis',     'postal_code' => '28711'],
                ['city_id' => '90403', 'province_id' => '26', 'type' => 'Kabupaten', 'city_name' => 'Indragiri Hulu','postal_code' => '29311'],
                ['city_id' => '90404', 'province_id' => '26', 'type' => 'Kabupaten', 'city_name' => 'Indragiri Hilir','postal_code' => '29212'],
                ['city_id' => '90405', 'province_id' => '26', 'type' => 'Kabupaten', 'city_name' => 'Siak',          'postal_code' => '28673'],
                ['city_id' => '90406', 'province_id' => '26', 'type' => 'Kabupaten', 'city_name' => 'Rokan Hulu',    'postal_code' => '28557'],
                ['city_id' => '90407', 'province_id' => '26', 'type' => 'Kabupaten', 'city_name' => 'Pelalawan',     'postal_code' => '28381'],
            ],
            // Kepulauan Riau
            '7' => [
                ['city_id' => '48',    'province_id' => '7', 'type' => 'Kota',      'city_name' => 'Batam',           'postal_code' => '29400'],
                ['city_id' => '442',   'province_id' => '7', 'type' => 'Kota',      'city_name' => 'Tanjung Pinang',  'postal_code' => '29111'],
                ['city_id' => '90501', 'province_id' => '7', 'type' => 'Kabupaten', 'city_name' => 'Bintan',          'postal_code' => '29152'],
                ['city_id' => '90502', 'province_id' => '7', 'type' => 'Kabupaten', 'city_name' => 'Karimun',         'postal_code' => '29661'],
                ['city_id' => '90503', 'province_id' => '7', 'type' => 'Kabupaten', 'city_name' => 'Lingga',          'postal_code' => '29871'],
                ['city_id' => '90504', 'province_id' => '7', 'type' => 'Kabupaten', 'city_name' => 'Natuna',          'postal_code' => '29711'],
                ['city_id' => '90505', 'province_id' => '7', 'type' => 'Kabupaten', 'city_name' => 'Kepulauan Anambas','postal_code' => '29791'],
            ],
            // Jambi
            '8' => [
                ['city_id' => '156',   'province_id' => '8', 'type' => 'Kota',      'city_name' => 'Jambi',         'postal_code' => '36111'],
                ['city_id' => '90601', 'province_id' => '8', 'type' => 'Kota',      'city_name' => 'Sungai Penuh',  'postal_code' => '37113'],
                ['city_id' => '90602', 'province_id' => '8', 'type' => 'Kabupaten', 'city_name' => 'Muaro Jambi',   'postal_code' => '36363'],
                ['city_id' => '90603', 'province_id' => '8', 'type' => 'Kabupaten', 'city_name' => 'Batanghari',    'postal_code' => '36613'],
                ['city_id' => '90604', 'province_id' => '8', 'type' => 'Kabupaten', 'city_name' => 'Bungo',         'postal_code' => '37211'],
                ['city_id' => '90605', 'province_id' => '8', 'type' => 'Kabupaten', 'city_name' => 'Tebo',          'postal_code' => '37571'],
                ['city_id' => '90606', 'province_id' => '8', 'type' => 'Kabupaten', 'city_name' => 'Merangin',      'postal_code' => '37312'],
                ['city_id' => '90607', 'province_id' => '8', 'type' => 'Kabupaten', 'city_name' => 'Sarolangun',    'postal_code' => '37481'],
                ['city_id' => '90608', 'province_id' => '8', 'type' => 'Kabupaten', 'city_name' => 'Tanjung Jabung Timur','postal_code' => '36573'],
                ['city_id' => '90609', 'province_id' => '8', 'type' => 'Kabupaten', 'city_name' => 'Tanjung Jabung Barat','postal_code' => '36513'],
            ],
            // Sumatera Selatan
            '33' => [
                ['city_id' => '348',   'province_id' => '33', 'type' => 'Kota',      'city_name' => 'Palembang',      'postal_code' => '30111'],
                ['city_id' => '276',   'province_id' => '33', 'type' => 'Kota',      'city_name' => 'Lubuk Linggau',  'postal_code' => '31611'],
                ['city_id' => '90701', 'province_id' => '33', 'type' => 'Kota',      'city_name' => 'Prabumulih',     'postal_code' => '31111'],
                ['city_id' => '90702', 'province_id' => '33', 'type' => 'Kota',      'city_name' => 'Pagar Alam',     'postal_code' => '31511'],
                ['city_id' => '90703', 'province_id' => '33', 'type' => 'Kabupaten', 'city_name' => 'Ogan Komering Ulu','postal_code' => '32117'],
                ['city_id' => '90704', 'province_id' => '33', 'type' => 'Kabupaten', 'city_name' => 'Ogan Komering Ilir','postal_code' => '30654'],
                ['city_id' => '90705', 'province_id' => '33', 'type' => 'Kabupaten', 'city_name' => 'Banyuasin',      'postal_code' => '30911'],
                ['city_id' => '90706', 'province_id' => '33', 'type' => 'Kabupaten', 'city_name' => 'Musi Banyuasin', 'postal_code' => '30714'],
                ['city_id' => '90707', 'province_id' => '33', 'type' => 'Kabupaten', 'city_name' => 'Musi Rawas',     'postal_code' => '31661'],
                ['city_id' => '90708', 'province_id' => '33', 'type' => 'Kabupaten', 'city_name' => 'Lahat',          'postal_code' => '31411'],
            ],
            // Bangka Belitung
            '4' => [
                ['city_id' => '349',   'province_id' => '4', 'type' => 'Kota',      'city_name' => 'Pangkal Pinang',  'postal_code' => '33115'],
                ['city_id' => '90801', 'province_id' => '4', 'type' => 'Kabupaten', 'city_name' => 'Bangka',          'postal_code' => '33212'],
                ['city_id' => '90802', 'province_id' => '4', 'type' => 'Kabupaten', 'city_name' => 'Bangka Barat',    'postal_code' => '33311'],
                ['city_id' => '90803', 'province_id' => '4', 'type' => 'Kabupaten', 'city_name' => 'Bangka Tengah',   'postal_code' => '33681'],
                ['city_id' => '90804', 'province_id' => '4', 'type' => 'Kabupaten', 'city_name' => 'Bangka Selatan',  'postal_code' => '33781'],
                ['city_id' => '90805', 'province_id' => '4', 'type' => 'Kabupaten', 'city_name' => 'Belitung',        'postal_code' => '33411'],
                ['city_id' => '90806', 'province_id' => '4', 'type' => 'Kabupaten', 'city_name' => 'Belitung Timur',  'postal_code' => '33513'],
            ],
            // Bengkulu
            '2' => [
                ['city_id' => '63',    'province_id' => '2', 'type' => 'Kota',      'city_name' => 'Bengkulu',         'postal_code' => '38229'],
                ['city_id' => '90901', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Bengkulu Utara',   'postal_code' => '38613'],
                ['city_id' => '90902', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Bengkulu Selatan', 'postal_code' => '38513'],
                ['city_id' => '90903', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Bengkulu Tengah',  'postal_code' => '38319'],
                ['city_id' => '90904', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Rejang Lebong',    'postal_code' => '39112'],
                ['city_id' => '90905', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Mukomuko',         'postal_code' => '38765'],
                ['city_id' => '90906', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Kepahiang',        'postal_code' => '39172'],
                ['city_id' => '90907', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Lebong',           'postal_code' => '39264'],
                ['city_id' => '90908', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Kaur',             'postal_code' => '38961'],
                ['city_id' => '90909', 'province_id' => '2', 'type' => 'Kabupaten', 'city_name' => 'Seluma',           'postal_code' => '38876'],
            ],
            // Lampung
            '18' => [
                ['city_id' => '21',    'province_id' => '18', 'type' => 'Kota',      'city_name' => 'Bandar Lampung',  'postal_code' => '35139'],
                ['city_id' => '273',   'province_id' => '18', 'type' => 'Kota',      'city_name' => 'Metro',           'postal_code' => '34111'],
                ['city_id' => '91001', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Lampung Selatan', 'postal_code' => '35511'],
                ['city_id' => '91002', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Lampung Tengah',  'postal_code' => '34111'],
                ['city_id' => '91003', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Lampung Utara',   'postal_code' => '34516'],
                ['city_id' => '91004', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Lampung Timur',   'postal_code' => '34192'],
                ['city_id' => '91005', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Lampung Barat',   'postal_code' => '34813'],
                ['city_id' => '91006', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Pesawaran',       'postal_code' => '35365'],
                ['city_id' => '91007', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Pringsewu',       'postal_code' => '35373'],
                ['city_id' => '91008', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Tanggamus',       'postal_code' => '35384'],
                ['city_id' => '91009', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Tulang Bawang',   'postal_code' => '34613'],
                ['city_id' => '91010', 'province_id' => '18', 'type' => 'Kabupaten', 'city_name' => 'Way Kanan',       'postal_code' => '34764'],
            ],
            // DKI Jakarta
            '6' => [
                ['city_id' => '152', 'province_id' => '6', 'type' => 'Kota',      'city_name' => 'Jakarta Pusat',     'postal_code' => '10110'],
                ['city_id' => '153', 'province_id' => '6', 'type' => 'Kota',      'city_name' => 'Jakarta Selatan',   'postal_code' => '12110'],
                ['city_id' => '154', 'province_id' => '6', 'type' => 'Kota',      'city_name' => 'Jakarta Timur',     'postal_code' => '13330'],
                ['city_id' => '151', 'province_id' => '6', 'type' => 'Kota',      'city_name' => 'Jakarta Utara',     'postal_code' => '14140'],
                ['city_id' => '155', 'province_id' => '6', 'type' => 'Kota',      'city_name' => 'Jakarta Barat',     'postal_code' => '11220'],
                ['city_id' => '150', 'province_id' => '6', 'type' => 'Kabupaten', 'city_name' => 'Kepulauan Seribu',  'postal_code' => '14550'],
            ],
            // Banten
            '3' => [
                ['city_id' => '455',   'province_id' => '3', 'type' => 'Kota',      'city_name' => 'Tangerang',         'postal_code' => '15111'],
                ['city_id' => '456',   'province_id' => '3', 'type' => 'Kota',      'city_name' => 'Tangerang Selatan', 'postal_code' => '15311'],
                ['city_id' => '76',    'province_id' => '3', 'type' => 'Kota',      'city_name' => 'Cilegon',           'postal_code' => '42417'],
                ['city_id' => '402',   'province_id' => '3', 'type' => 'Kota',      'city_name' => 'Serang',            'postal_code' => '42111'],
                ['city_id' => '91101', 'province_id' => '3', 'type' => 'Kabupaten', 'city_name' => 'Tangerang',         'postal_code' => '15820'],
                ['city_id' => '91102', 'province_id' => '3', 'type' => 'Kabupaten', 'city_name' => 'Serang',            'postal_code' => '42182'],
                ['city_id' => '91103', 'province_id' => '3', 'type' => 'Kabupaten', 'city_name' => 'Lebak',             'postal_code' => '42313'],
                ['city_id' => '91104', 'province_id' => '3', 'type' => 'Kabupaten', 'city_name' => 'Pandeglang',        'postal_code' => '42213'],
            ],
            // Jawa Barat
            '9' => [
                ['city_id' => '22',    'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Bandung',          'postal_code' => '40111'],
                ['city_id' => '23',    'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Bandung',          'postal_code' => '40311'],
                ['city_id' => '78',    'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Bekasi',           'postal_code' => '17112'],
                ['city_id' => '79',    'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Bekasi',           'postal_code' => '17837'],
                ['city_id' => '80',    'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Bogor',            'postal_code' => '16119'],
                ['city_id' => '81',    'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Bogor',            'postal_code' => '16911'],
                ['city_id' => '115',   'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Cimahi',           'postal_code' => '40512'],
                ['city_id' => '105',   'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Cirebon',          'postal_code' => '45111'],
                ['city_id' => '103',   'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Depok',            'postal_code' => '16416'],
                ['city_id' => '423',   'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Sukabumi',         'postal_code' => '43111'],
                ['city_id' => '470',   'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Tasikmalaya',      'postal_code' => '46411'],
                ['city_id' => '91201', 'province_id' => '9', 'type' => 'Kota',      'city_name' => 'Banjar',           'postal_code' => '46311'],
                ['city_id' => '91202', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Bandung Barat',    'postal_code' => '40721'],
                ['city_id' => '91203', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Cianjur',          'postal_code' => '43211'],
                ['city_id' => '91204', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Garut',            'postal_code' => '44151'],
                ['city_id' => '91205', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Sumedang',         'postal_code' => '45311'],
                ['city_id' => '91206', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Subang',           'postal_code' => '41211'],
                ['city_id' => '91207', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Karawang',         'postal_code' => '41311'],
                ['city_id' => '91208', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Purwakarta',       'postal_code' => '41115'],
                ['city_id' => '91209', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Indramayu',        'postal_code' => '45213'],
                ['city_id' => '91210', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Cirebon',          'postal_code' => '45611'],
                ['city_id' => '91211', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Kuningan',         'postal_code' => '45511'],
                ['city_id' => '91212', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Majalengka',       'postal_code' => '45411'],
                ['city_id' => '91213', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Sukabumi',         'postal_code' => '43311'],
                ['city_id' => '91214', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Tasikmalaya',      'postal_code' => '46411'],
                ['city_id' => '91215', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Ciamis',           'postal_code' => '46211'],
                ['city_id' => '91216', 'province_id' => '9', 'type' => 'Kabupaten', 'city_name' => 'Pangandaran',      'postal_code' => '46396'],
            ],
            // Jawa Tengah
            '10' => [
                ['city_id' => '399',   'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Semarang',         'postal_code' => '50135'],
                ['city_id' => '457',   'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Solo (Surakarta)', 'postal_code' => '57113'],
                ['city_id' => '253',   'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Magelang',         'postal_code' => '56133'],
                ['city_id' => '343',   'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Pekalongan',       'postal_code' => '51122'],
                ['city_id' => '430',   'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Tegal',            'postal_code' => '52114'],
                ['city_id' => '398',   'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Salatiga',         'postal_code' => '50711'],
                ['city_id' => '91301', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Semarang',         'postal_code' => '50511'],
                ['city_id' => '91302', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Banyumas',         'postal_code' => '53111'],
                ['city_id' => '91303', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Cilacap',          'postal_code' => '53211'],
                ['city_id' => '91304', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Klaten',           'postal_code' => '57411'],
                ['city_id' => '91305', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Boyolali',         'postal_code' => '57311'],
                ['city_id' => '91306', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Sragen',           'postal_code' => '57211'],
                ['city_id' => '91307', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Sukoharjo',        'postal_code' => '57521'],
                ['city_id' => '91308', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Karanganyar',      'postal_code' => '57711'],
                ['city_id' => '91309', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Wonogiri',         'postal_code' => '57612'],
                ['city_id' => '91310', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Demak',            'postal_code' => '59511'],
                ['city_id' => '91311', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Kudus',            'postal_code' => '59311'],
                ['city_id' => '91312', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Jepara',           'postal_code' => '59411'],
                ['city_id' => '91313', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Pati',             'postal_code' => '59111'],
                ['city_id' => '91314', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Rembang',          'postal_code' => '59211'],
                ['city_id' => '91315', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Blora',            'postal_code' => '58219'],
                ['city_id' => '91316', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Brebes',           'postal_code' => '52212'],
                ['city_id' => '91317', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Tegal',            'postal_code' => '52419'],
                ['city_id' => '91318', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Pemalang',         'postal_code' => '52311'],
                ['city_id' => '91319', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Pekalongan',       'postal_code' => '51161'],
                ['city_id' => '91320', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Batang',           'postal_code' => '51211'],
                ['city_id' => '91321', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Kendal',           'postal_code' => '51315'],
                ['city_id' => '91322', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Wonosobo',         'postal_code' => '56311'],
                ['city_id' => '91323', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Banjarnegara',     'postal_code' => '53415'],
                ['city_id' => '91324', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Purbalingga',      'postal_code' => '53312'],
                ['city_id' => '91325', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Purworejo',        'postal_code' => '54111'],
                ['city_id' => '91326', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Magelang',         'postal_code' => '56511'],
                ['city_id' => '91327', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Temanggung',       'postal_code' => '56212'],
                ['city_id' => '91328', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Kebumen',          'postal_code' => '54311'],
                ['city_id' => '91329', 'province_id' => '10', 'type' => 'Kabupaten', 'city_name' => 'Grobogan',         'postal_code' => '58111'],
            ],
            // DI Yogyakarta
            '5' => [
                ['city_id' => '501',   'province_id' => '5', 'type' => 'Kota',      'city_name' => 'Yogyakarta',  'postal_code' => '55111'],
                ['city_id' => '91401', 'province_id' => '5', 'type' => 'Kabupaten', 'city_name' => 'Sleman',      'postal_code' => '55513'],
                ['city_id' => '39',    'province_id' => '5', 'type' => 'Kabupaten', 'city_name' => 'Bantul',      'postal_code' => '55715'],
                ['city_id' => '91402', 'province_id' => '5', 'type' => 'Kabupaten', 'city_name' => 'Kulon Progo', 'postal_code' => '55611'],
                ['city_id' => '91403', 'province_id' => '5', 'type' => 'Kabupaten', 'city_name' => 'Gunung Kidul','postal_code' => '55812'],
            ],
            // Jawa Timur
            '11' => [
                ['city_id' => '444',   'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Surabaya',     'postal_code' => '60119'],
                ['city_id' => '256',   'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Malang',       'postal_code' => '65112'],
                ['city_id' => '255',   'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Malang',       'postal_code' => '65163'],
                ['city_id' => '174',   'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Kediri',       'postal_code' => '64125'],
                ['city_id' => '266',   'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Mojokerto',    'postal_code' => '61321'],
                ['city_id' => '317',   'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Pasuruan',     'postal_code' => '67118'],
                ['city_id' => '376',   'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Probolinggo',  'postal_code' => '67213'],
                ['city_id' => '142',   'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Gresik',       'postal_code' => '61115'],
                ['city_id' => '409',   'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Sidoarjo',     'postal_code' => '61219'],
                ['city_id' => '215',   'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Madiun',       'postal_code' => '63122'],
                ['city_id' => '40',    'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Batu',         'postal_code' => '65311'],
                ['city_id' => '91501', 'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Blitar',       'postal_code' => '66117'],
                ['city_id' => '91502', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Banyuwangi',   'postal_code' => '68411'],
                ['city_id' => '91503', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Jember',       'postal_code' => '68118'],
                ['city_id' => '91504', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Lumajang',     'postal_code' => '67311'],
                ['city_id' => '91505', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Bondowoso',    'postal_code' => '68211'],
                ['city_id' => '91506', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Situbondo',    'postal_code' => '68311'],
                ['city_id' => '91507', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Probolinggo',  'postal_code' => '67215'],
                ['city_id' => '91508', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Pasuruan',     'postal_code' => '67156'],
                ['city_id' => '91509', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Mojokerto',    'postal_code' => '61382'],
                ['city_id' => '91510', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Jombang',      'postal_code' => '61411'],
                ['city_id' => '91511', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Lamongan',     'postal_code' => '62214'],
                ['city_id' => '91512', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Tuban',        'postal_code' => '62311'],
                ['city_id' => '91513', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Bojonegoro',   'postal_code' => '62112'],
                ['city_id' => '91514', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Nganjuk',      'postal_code' => '64411'],
                ['city_id' => '91515', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Madiun',       'postal_code' => '63151'],
                ['city_id' => '91516', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Magetan',      'postal_code' => '63351'],
                ['city_id' => '91517', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Ngawi',        'postal_code' => '63211'],
                ['city_id' => '91518', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Ponorogo',     'postal_code' => '63411'],
                ['city_id' => '91519', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Pacitan',      'postal_code' => '63511'],
                ['city_id' => '91520', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Trenggalek',   'postal_code' => '66311'],
                ['city_id' => '91521', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Tulungagung',  'postal_code' => '66212'],
                ['city_id' => '91522', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Blitar',       'postal_code' => '66112'],
                ['city_id' => '91523', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Kediri',       'postal_code' => '64182'],
                ['city_id' => '91524', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Bangkalan',    'postal_code' => '69118'],
                ['city_id' => '91525', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Sampang',      'postal_code' => '69216'],
                ['city_id' => '91526', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Pamekasan',    'postal_code' => '69319'],
                ['city_id' => '91527', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Sumenep',      'postal_code' => '69417'],
            ],
            // Bali
            '1' => [
                ['city_id' => '114',   'province_id' => '1', 'type' => 'Kota',      'city_name' => 'Denpasar',     'postal_code' => '80227'],
                ['city_id' => '17',    'province_id' => '1', 'type' => 'Kabupaten', 'city_name' => 'Badung',       'postal_code' => '80351'],
                ['city_id' => '143',   'province_id' => '1', 'type' => 'Kabupaten', 'city_name' => 'Gianyar',      'postal_code' => '80511'],
                ['city_id' => '91601', 'province_id' => '1', 'type' => 'Kabupaten', 'city_name' => 'Buleleng',     'postal_code' => '81111'],
                ['city_id' => '91602', 'province_id' => '1', 'type' => 'Kabupaten', 'city_name' => 'Tabanan',      'postal_code' => '82113'],
                ['city_id' => '91603', 'province_id' => '1', 'type' => 'Kabupaten', 'city_name' => 'Klungkung',    'postal_code' => '80716'],
                ['city_id' => '91604', 'province_id' => '1', 'type' => 'Kabupaten', 'city_name' => 'Karangasem',   'postal_code' => '80811'],
                ['city_id' => '91605', 'province_id' => '1', 'type' => 'Kabupaten', 'city_name' => 'Bangli',       'postal_code' => '80619'],
                ['city_id' => '91606', 'province_id' => '1', 'type' => 'Kabupaten', 'city_name' => 'Jembrana',     'postal_code' => '82218'],
            ],
            // Nusa Tenggara Barat
            '22' => [
                ['city_id' => '276',   'province_id' => '22', 'type' => 'Kota',      'city_name' => 'Mataram',         'postal_code' => '83239'],
                ['city_id' => '67',    'province_id' => '22', 'type' => 'Kota',      'city_name' => 'Bima',            'postal_code' => '84111'],
                ['city_id' => '91701', 'province_id' => '22', 'type' => 'Kabupaten', 'city_name' => 'Lombok Barat',    'postal_code' => '83361'],
                ['city_id' => '91702', 'province_id' => '22', 'type' => 'Kabupaten', 'city_name' => 'Lombok Tengah',   'postal_code' => '83511'],
                ['city_id' => '91703', 'province_id' => '22', 'type' => 'Kabupaten', 'city_name' => 'Lombok Timur',    'postal_code' => '83612'],
                ['city_id' => '91704', 'province_id' => '22', 'type' => 'Kabupaten', 'city_name' => 'Lombok Utara',    'postal_code' => '83711'],
                ['city_id' => '91705', 'province_id' => '22', 'type' => 'Kabupaten', 'city_name' => 'Sumbawa',         'postal_code' => '84311'],
                ['city_id' => '91706', 'province_id' => '22', 'type' => 'Kabupaten', 'city_name' => 'Sumbawa Barat',   'postal_code' => '84411'],
                ['city_id' => '91707', 'province_id' => '22', 'type' => 'Kabupaten', 'city_name' => 'Dompu',           'postal_code' => '84217'],
                ['city_id' => '91708', 'province_id' => '22', 'type' => 'Kabupaten', 'city_name' => 'Bima',            'postal_code' => '84171'],
            ],
            // Nusa Tenggara Timur
            '23' => [
                ['city_id' => '174',   'province_id' => '23', 'type' => 'Kota',      'city_name' => 'Kupang',          'postal_code' => '85111'],
                ['city_id' => '91801', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Kupang',          'postal_code' => '85362'],
                ['city_id' => '91802', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Belu',            'postal_code' => '85711'],
                ['city_id' => '91803', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Sikka',           'postal_code' => '86113'],
                ['city_id' => '91804', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Manggarai',       'postal_code' => '86511'],
                ['city_id' => '91805', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Manggarai Barat', 'postal_code' => '86711'],
                ['city_id' => '91806', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Ngada',           'postal_code' => '86411'],
                ['city_id' => '91807', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Ende',            'postal_code' => '86319'],
                ['city_id' => '91808', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Flores Timur',    'postal_code' => '86213'],
                ['city_id' => '91809', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Sumba Barat',     'postal_code' => '87113'],
                ['city_id' => '91810', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Sumba Timur',     'postal_code' => '87212'],
                ['city_id' => '91811', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Timor Tengah Selatan', 'postal_code' => '85511'],
                ['city_id' => '91812', 'province_id' => '23', 'type' => 'Kabupaten', 'city_name' => 'Timor Tengah Utara',   'postal_code' => '85613'],
            ],
            // Kalimantan Barat
            '12' => [
                ['city_id' => '361',   'province_id' => '12', 'type' => 'Kota',      'city_name' => 'Pontianak',     'postal_code' => '78112'],
                ['city_id' => '419',   'province_id' => '12', 'type' => 'Kota',      'city_name' => 'Singkawang',    'postal_code' => '79112'],
                ['city_id' => '91901', 'province_id' => '12', 'type' => 'Kabupaten', 'city_name' => 'Pontianak',     'postal_code' => '78911'],
                ['city_id' => '91902', 'province_id' => '12', 'type' => 'Kabupaten', 'city_name' => 'Kubu Raya',     'postal_code' => '78351'],
                ['city_id' => '91903', 'province_id' => '12', 'type' => 'Kabupaten', 'city_name' => 'Sambas',        'postal_code' => '79453'],
                ['city_id' => '91904', 'province_id' => '12', 'type' => 'Kabupaten', 'city_name' => 'Sintang',       'postal_code' => '78611'],
                ['city_id' => '91905', 'province_id' => '12', 'type' => 'Kabupaten', 'city_name' => 'Kapuas Hulu',   'postal_code' => '78711'],
                ['city_id' => '91906', 'province_id' => '12', 'type' => 'Kabupaten', 'city_name' => 'Ketapang',      'postal_code' => '78813'],
                ['city_id' => '91907', 'province_id' => '12', 'type' => 'Kabupaten', 'city_name' => 'Sanggau',       'postal_code' => '78557'],
                ['city_id' => '91908', 'province_id' => '12', 'type' => 'Kabupaten', 'city_name' => 'Bengkayang',    'postal_code' => '79213'],
            ],
            // Kalimantan Tengah
            '13' => [
                ['city_id' => '344',   'province_id' => '13', 'type' => 'Kota',      'city_name' => 'Palangka Raya',     'postal_code' => '73111'],
                ['city_id' => '92001', 'province_id' => '13', 'type' => 'Kabupaten', 'city_name' => 'Kotawaringin Barat','postal_code' => '74112'],
                ['city_id' => '92002', 'province_id' => '13', 'type' => 'Kabupaten', 'city_name' => 'Kotawaringin Timur','postal_code' => '74322'],
                ['city_id' => '92003', 'province_id' => '13', 'type' => 'Kabupaten', 'city_name' => 'Kapuas',            'postal_code' => '73511'],
                ['city_id' => '92004', 'province_id' => '13', 'type' => 'Kabupaten', 'city_name' => 'Barito Selatan',    'postal_code' => '73711'],
                ['city_id' => '92005', 'province_id' => '13', 'type' => 'Kabupaten', 'city_name' => 'Barito Utara',      'postal_code' => '73881'],
                ['city_id' => '92006', 'province_id' => '13', 'type' => 'Kabupaten', 'city_name' => 'Pulang Pisau',      'postal_code' => '74811'],
                ['city_id' => '92007', 'province_id' => '13', 'type' => 'Kabupaten', 'city_name' => 'Lamandau',          'postal_code' => '74611'],
                ['city_id' => '92008', 'province_id' => '13', 'type' => 'Kabupaten', 'city_name' => 'Sukamara',          'postal_code' => '74172'],
            ],
            // Kalimantan Selatan
            '14' => [
                ['city_id' => '13',    'province_id' => '14', 'type' => 'Kota',      'city_name' => 'Banjarmasin',         'postal_code' => '70117'],
                ['city_id' => '12',    'province_id' => '14', 'type' => 'Kota',      'city_name' => 'Banjarbaru',          'postal_code' => '70711'],
                ['city_id' => '92101', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Banjar',              'postal_code' => '70611'],
                ['city_id' => '92102', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Tanah Laut',          'postal_code' => '70811'],
                ['city_id' => '92103', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Tapin',               'postal_code' => '71111'],
                ['city_id' => '92104', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Hulu Sungai Selatan', 'postal_code' => '71211'],
                ['city_id' => '92105', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Hulu Sungai Tengah',  'postal_code' => '71311'],
                ['city_id' => '92106', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Hulu Sungai Utara',   'postal_code' => '71419'],
                ['city_id' => '92107', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Tabalong',            'postal_code' => '71513'],
                ['city_id' => '92108', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Kotabaru',            'postal_code' => '72111'],
                ['city_id' => '92109', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Tanah Bumbu',         'postal_code' => '72271'],
                ['city_id' => '92110', 'province_id' => '14', 'type' => 'Kabupaten', 'city_name' => 'Barito Kuala',        'postal_code' => '70513'],
            ],
            // Kalimantan Timur
            '15' => [
                ['city_id' => '15',    'province_id' => '15', 'type' => 'Kota',      'city_name' => 'Balikpapan',          'postal_code' => '76111'],
                ['city_id' => '386',   'province_id' => '15', 'type' => 'Kota',      'city_name' => 'Samarinda',           'postal_code' => '75112'],
                ['city_id' => '69',    'province_id' => '15', 'type' => 'Kota',      'city_name' => 'Bontang',             'postal_code' => '75321'],
                ['city_id' => '92201', 'province_id' => '15', 'type' => 'Kabupaten', 'city_name' => 'Kutai Kartanegara',   'postal_code' => '75511'],
                ['city_id' => '92202', 'province_id' => '15', 'type' => 'Kabupaten', 'city_name' => 'Kutai Barat',         'postal_code' => '75711'],
                ['city_id' => '92203', 'province_id' => '15', 'type' => 'Kabupaten', 'city_name' => 'Kutai Timur',         'postal_code' => '75611'],
                ['city_id' => '92204', 'province_id' => '15', 'type' => 'Kabupaten', 'city_name' => 'Berau',               'postal_code' => '77311'],
                ['city_id' => '92205', 'province_id' => '15', 'type' => 'Kabupaten', 'city_name' => 'Paser',               'postal_code' => '76211'],
                ['city_id' => '92206', 'province_id' => '15', 'type' => 'Kabupaten', 'city_name' => 'Penajam Paser Utara', 'postal_code' => '76141'],
                ['city_id' => '92207', 'province_id' => '15', 'type' => 'Kabupaten', 'city_name' => 'Mahakam Ulu',         'postal_code' => '75775'],
            ],
            // Kalimantan Utara
            '35' => [
                ['city_id' => '450',   'province_id' => '35', 'type' => 'Kota',      'city_name' => 'Tarakan',     'postal_code' => '77111'],
                ['city_id' => '92301', 'province_id' => '35', 'type' => 'Kabupaten', 'city_name' => 'Bulungan',    'postal_code' => '77211'],
                ['city_id' => '92302', 'province_id' => '35', 'type' => 'Kabupaten', 'city_name' => 'Malinau',     'postal_code' => '77554'],
                ['city_id' => '92303', 'province_id' => '35', 'type' => 'Kabupaten', 'city_name' => 'Nunukan',     'postal_code' => '77482'],
                ['city_id' => '92304', 'province_id' => '35', 'type' => 'Kabupaten', 'city_name' => 'Tana Tidung', 'postal_code' => '77611'],
            ],
            // Sulawesi Utara
            '31' => [
                ['city_id' => '263',   'province_id' => '31', 'type' => 'Kota',      'city_name' => 'Manado',             'postal_code' => '95247'],
                ['city_id' => '53',    'province_id' => '31', 'type' => 'Kota',      'city_name' => 'Bitung',             'postal_code' => '95511'],
                ['city_id' => '92401', 'province_id' => '31', 'type' => 'Kota',      'city_name' => 'Tomohon',            'postal_code' => '95416'],
                ['city_id' => '92402', 'province_id' => '31', 'type' => 'Kota',      'city_name' => 'Kotamobagu',         'postal_code' => '95711'],
                ['city_id' => '92403', 'province_id' => '31', 'type' => 'Kabupaten', 'city_name' => 'Minahasa',           'postal_code' => '95614'],
                ['city_id' => '92404', 'province_id' => '31', 'type' => 'Kabupaten', 'city_name' => 'Minahasa Utara',     'postal_code' => '95371'],
                ['city_id' => '92405', 'province_id' => '31', 'type' => 'Kabupaten', 'city_name' => 'Minahasa Selatan',   'postal_code' => '95914'],
                ['city_id' => '92406', 'province_id' => '31', 'type' => 'Kabupaten', 'city_name' => 'Minahasa Tenggara',  'postal_code' => '95995'],
                ['city_id' => '92407', 'province_id' => '31', 'type' => 'Kabupaten', 'city_name' => 'Bolaang Mongondow',  'postal_code' => '95762'],
                ['city_id' => '92408', 'province_id' => '31', 'type' => 'Kabupaten', 'city_name' => 'Kepulauan Sangihe',  'postal_code' => '95812'],
                ['city_id' => '92409', 'province_id' => '31', 'type' => 'Kabupaten', 'city_name' => 'Kepulauan Talaud',   'postal_code' => '95885'],
            ],
            // Gorontalo
            '34' => [
                ['city_id' => '146',   'province_id' => '34', 'type' => 'Kota',      'city_name' => 'Gorontalo',         'postal_code' => '96115'],
                ['city_id' => '92501', 'province_id' => '34', 'type' => 'Kabupaten', 'city_name' => 'Gorontalo',         'postal_code' => '96218'],
                ['city_id' => '92502', 'province_id' => '34', 'type' => 'Kabupaten', 'city_name' => 'Boalemo',           'postal_code' => '96313'],
                ['city_id' => '92503', 'province_id' => '34', 'type' => 'Kabupaten', 'city_name' => 'Bone Bolango',      'postal_code' => '96511'],
                ['city_id' => '92504', 'province_id' => '34', 'type' => 'Kabupaten', 'city_name' => 'Pohuwato',          'postal_code' => '96419'],
                ['city_id' => '92505', 'province_id' => '34', 'type' => 'Kabupaten', 'city_name' => 'Gorontalo Utara',   'postal_code' => '96252'],
            ],
            // Sulawesi Tengah
            '29' => [
                ['city_id' => '321',   'province_id' => '29', 'type' => 'Kota',      'city_name' => 'Palu',          'postal_code' => '94111'],
                ['city_id' => '92601', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Donggala',      'postal_code' => '94351'],
                ['city_id' => '92602', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Sigi',          'postal_code' => '94364'],
                ['city_id' => '92603', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Parigi Moutong','postal_code' => '94371'],
                ['city_id' => '92604', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Poso',          'postal_code' => '94619'],
                ['city_id' => '92605', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Banggai',       'postal_code' => '94715'],
                ['city_id' => '92606', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Banggai Kepulauan','postal_code' => '94881'],
                ['city_id' => '92607', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Tojo Una-Una',  'postal_code' => '94683'],
                ['city_id' => '92608', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Morowali',      'postal_code' => '94971'],
                ['city_id' => '92609', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Morowali Utara','postal_code' => '94855'],
                ['city_id' => '92610', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Tolitoli',      'postal_code' => '94511'],
                ['city_id' => '92611', 'province_id' => '29', 'type' => 'Kabupaten', 'city_name' => 'Buol',          'postal_code' => '94564'],
            ],
            // Sulawesi Selatan
            '28' => [
                ['city_id' => '254',   'province_id' => '28', 'type' => 'Kota',      'city_name' => 'Makassar',     'postal_code' => '90111'],
                ['city_id' => '331',   'province_id' => '28', 'type' => 'Kota',      'city_name' => 'Parepare',     'postal_code' => '91123'],
                ['city_id' => '92701', 'province_id' => '28', 'type' => 'Kota',      'city_name' => 'Palopo',       'postal_code' => '91913'],
                ['city_id' => '92702', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Gowa',         'postal_code' => '92111'],
                ['city_id' => '92703', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Maros',        'postal_code' => '90511'],
                ['city_id' => '92704', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Pangkajene Kepulauan', 'postal_code' => '90611'],
                ['city_id' => '92705', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Bone',         'postal_code' => '92711'],
                ['city_id' => '92706', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Bulukumba',    'postal_code' => '92511'],
                ['city_id' => '92707', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Sinjai',       'postal_code' => '92611'],
                ['city_id' => '92708', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Wajo',         'postal_code' => '90911'],
                ['city_id' => '92709', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Soppeng',      'postal_code' => '90812'],
                ['city_id' => '92710', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Pinrang',      'postal_code' => '91212'],
                ['city_id' => '92711', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Sidenreng Rappang', 'postal_code' => '91611'],
                ['city_id' => '92712', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Enrekang',     'postal_code' => '91711'],
                ['city_id' => '92713', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Luwu',         'postal_code' => '91993'],
                ['city_id' => '92714', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Luwu Utara',   'postal_code' => '91911'],
                ['city_id' => '92715', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Luwu Timur',   'postal_code' => '92981'],
                ['city_id' => '92716', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Toraja Utara', 'postal_code' => '91831'],
                ['city_id' => '92717', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Tana Toraja',  'postal_code' => '91811'],
                ['city_id' => '92718', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Takalar',      'postal_code' => '92211'],
                ['city_id' => '92719', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Jeneponto',    'postal_code' => '92311'],
                ['city_id' => '92720', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Bantaeng',     'postal_code' => '92411'],
                ['city_id' => '92721', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Selayar',      'postal_code' => '92812'],
                ['city_id' => '92722', 'province_id' => '28', 'type' => 'Kabupaten', 'city_name' => 'Barru',        'postal_code' => '90711'],
            ],
            // Sulawesi Tenggara
            '30' => [
                ['city_id' => '177',   'province_id' => '30', 'type' => 'Kota',      'city_name' => 'Kendari',           'postal_code' => '93111'],
                ['city_id' => '37',    'province_id' => '30', 'type' => 'Kota',      'city_name' => 'Bau-Bau',           'postal_code' => '93717'],
                ['city_id' => '92801', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Konawe',            'postal_code' => '93411'],
                ['city_id' => '92802', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Konawe Selatan',    'postal_code' => '93811'],
                ['city_id' => '92803', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Konawe Utara',      'postal_code' => '93351'],
                ['city_id' => '92804', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Muna',              'postal_code' => '93611'],
                ['city_id' => '92805', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Buton',             'postal_code' => '93755'],
                ['city_id' => '92806', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Buton Utara',       'postal_code' => '93672'],
                ['city_id' => '92807', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Kolaka',            'postal_code' => '93511'],
                ['city_id' => '92808', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Kolaka Utara',      'postal_code' => '93911'],
                ['city_id' => '92809', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Bombana',           'postal_code' => '93772'],
                ['city_id' => '92810', 'province_id' => '30', 'type' => 'Kabupaten', 'city_name' => 'Wakatobi',          'postal_code' => '93791'],
            ],
            // Sulawesi Barat
            '27' => [
                ['city_id' => '249',   'province_id' => '27', 'type' => 'Kabupaten', 'city_name' => 'Mamuju',          'postal_code' => '91511'],
                ['city_id' => '92901', 'province_id' => '27', 'type' => 'Kabupaten', 'city_name' => 'Mamuju Tengah',   'postal_code' => '91561'],
                ['city_id' => '92902', 'province_id' => '27', 'type' => 'Kabupaten', 'city_name' => 'Mamuju Utara',    'postal_code' => '91571'],
                ['city_id' => '92903', 'province_id' => '27', 'type' => 'Kabupaten', 'city_name' => 'Polewali Mandar', 'postal_code' => '91315'],
                ['city_id' => '92904', 'province_id' => '27', 'type' => 'Kabupaten', 'city_name' => 'Majene',          'postal_code' => '91411'],
                ['city_id' => '92905', 'province_id' => '27', 'type' => 'Kabupaten', 'city_name' => 'Mamasa',          'postal_code' => '91362'],
            ],
            // Maluku
            '20' => [
                ['city_id' => '11',    'province_id' => '20', 'type' => 'Kota',      'city_name' => 'Ambon',                 'postal_code' => '97114'],
                ['city_id' => '93001', 'province_id' => '20', 'type' => 'Kota',      'city_name' => 'Tual',                  'postal_code' => '97611'],
                ['city_id' => '93002', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Maluku Tengah',         'postal_code' => '97511'],
                ['city_id' => '93003', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Maluku Tenggara',       'postal_code' => '97651'],
                ['city_id' => '93004', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Maluku Tenggara Barat', 'postal_code' => '97464'],
                ['city_id' => '93005', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Maluku Barat Daya',     'postal_code' => '97473'],
                ['city_id' => '93006', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Buru',                  'postal_code' => '97571'],
                ['city_id' => '93007', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Buru Selatan',          'postal_code' => '97552'],
                ['city_id' => '93008', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Seram Bagian Barat',    'postal_code' => '97511'],
                ['city_id' => '93009', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Seram Bagian Timur',    'postal_code' => '97581'],
                ['city_id' => '93010', 'province_id' => '20', 'type' => 'Kabupaten', 'city_name' => 'Kepulauan Aru',         'postal_code' => '97681'],
            ],
            // Maluku Utara
            '19' => [
                ['city_id' => '457',   'province_id' => '19', 'type' => 'Kota',      'city_name' => 'Ternate',           'postal_code' => '97714'],
                ['city_id' => '459',   'province_id' => '19', 'type' => 'Kota',      'city_name' => 'Tidore Kepulauan',  'postal_code' => '97813'],
                ['city_id' => '93101', 'province_id' => '19', 'type' => 'Kabupaten', 'city_name' => 'Halmahera Barat',   'postal_code' => '97757'],
                ['city_id' => '93102', 'province_id' => '19', 'type' => 'Kabupaten', 'city_name' => 'Halmahera Tengah',  'postal_code' => '97853'],
                ['city_id' => '93103', 'province_id' => '19', 'type' => 'Kabupaten', 'city_name' => 'Halmahera Selatan', 'postal_code' => '97911'],
                ['city_id' => '93104', 'province_id' => '19', 'type' => 'Kabupaten', 'city_name' => 'Halmahera Utara',   'postal_code' => '97762'],
                ['city_id' => '93105', 'province_id' => '19', 'type' => 'Kabupaten', 'city_name' => 'Halmahera Timur',   'postal_code' => '97862'],
                ['city_id' => '93106', 'province_id' => '19', 'type' => 'Kabupaten', 'city_name' => 'Kepulauan Sula',    'postal_code' => '97791'],
                ['city_id' => '93107', 'province_id' => '19', 'type' => 'Kabupaten', 'city_name' => 'Pulau Morotai',     'postal_code' => '97771'],
                ['city_id' => '93108', 'province_id' => '19', 'type' => 'Kabupaten', 'city_name' => 'Pulau Taliabu',     'postal_code' => '97793'],
            ],
            // Papua Barat
            '16' => [
                ['city_id' => '93201', 'province_id' => '16', 'type' => 'Kota',      'city_name' => 'Sorong',         'postal_code' => '98411'],
                ['city_id' => '93202', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Sorong',         'postal_code' => '98414'],
                ['city_id' => '93203', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Sorong Selatan', 'postal_code' => '98452'],
                ['city_id' => '93204', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Manokwari',      'postal_code' => '98311'],
                ['city_id' => '93205', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Manokwari Selatan','postal_code' => '98361'],
                ['city_id' => '93206', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Fakfak',         'postal_code' => '98611'],
                ['city_id' => '93207', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Kaimana',        'postal_code' => '98671'],
                ['city_id' => '93208', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Teluk Bintuni',  'postal_code' => '98551'],
                ['city_id' => '93209', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Teluk Wondama',  'postal_code' => '98361'],
                ['city_id' => '93210', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Raja Ampat',     'postal_code' => '98481'],
                ['city_id' => '93211', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Tambrauw',       'postal_code' => '98461'],
                ['city_id' => '93212', 'province_id' => '16', 'type' => 'Kabupaten', 'city_name' => 'Maybrat',        'postal_code' => '98471'],
            ],
            // Papua
            '25' => [
                ['city_id' => '161',   'province_id' => '25', 'type' => 'Kota',      'city_name' => 'Jayapura',     'postal_code' => '99111'],
                ['city_id' => '93301', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Jayapura',     'postal_code' => '99352'],
                ['city_id' => '93302', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Jayawijaya',   'postal_code' => '99511'],
                ['city_id' => '93303', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Mimika',       'postal_code' => '99910'],
                ['city_id' => '93304', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Merauke',      'postal_code' => '99611'],
                ['city_id' => '93305', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Nabire',       'postal_code' => '98816'],
                ['city_id' => '93306', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Biak Numfor',  'postal_code' => '98112'],
                ['city_id' => '93307', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Kepulauan Yapen','postal_code' => '98211'],
                ['city_id' => '93308', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Puncak Jaya',  'postal_code' => '99571'],
                ['city_id' => '93309', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Paniai',       'postal_code' => '98765'],
                ['city_id' => '93310', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Yahukimo',     'postal_code' => '99581'],
                ['city_id' => '93311', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Keerom',       'postal_code' => '99461'],
                ['city_id' => '93312', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Sarmi',        'postal_code' => '99373'],
                ['city_id' => '93313', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Boven Digoel', 'postal_code' => '99662'],
                ['city_id' => '93314', 'province_id' => '25', 'type' => 'Kabupaten', 'city_name' => 'Asmat',        'postal_code' => '99777'],
            ],
        ];
        if ($provinceId !== null && $provinceId !== '' && isset($all[$provinceId])) {
            return $all[$provinceId];
        }
        return array_merge(...array_values($all));
    }

    /**
     * Mock cost — destination-aware. Uses a 5-zone model based on the
     * destination city's province (relative to Jakarta as origin), with a
     * deterministic per-city jitter so two different cities in the same zone
     * still produce visibly different prices, plus an additional kecamatan
     * adjustment so two addresses in the same city but different kecamatan
     * see slightly different ongkir (mimicking RajaOngkir Pro behavior).
     *
     * Tariff is roughly:
     *   cost = ceil(weight/1000) * basePerKg(courier) * zoneMultiplier
     *        + (cityIdHash % 7) * 500
     *        + (subdistrictIdHash % 13) * 500    // only when kecamatan provided
     *
     * Each call returns 3 service tiers (REG/YES/OKE) with sensible spreads.
     */
    protected function mockCost(string $courier, int $weightGram, string $destinationCityId = '', ?string $subdistrictId = null): array
    {
        $courier = strtolower($courier);
        $weightKg = max(1, (int) ceil($weightGram / 1000));

        // basePerKg for the REG tier per courier (idr).
        $basePerKgByCourier = [
            'jne'  => 11000,
            'jnt'  => 10000,
            'pos'  => 9000,
            'tiki' => 10500,
        ];
        $basePerKg = $basePerKgByCourier[$courier] ?? 10000;

        $zone     = $this->cityZone($destinationCityId);
        $zoneMult = [1 => 1.0, 2 => 1.5, 3 => 2.2, 4 => 3.0, 5 => 4.2][$zone] ?? 1.5;

        // Deterministic jitter so cities in the same zone aren't all identical.
        // Range: 0..3000 idr.
        $jitter = (abs(crc32($destinationCityId)) % 7) * 500;

        // Kecamatan-level adjustment. Range 0..6000 idr (deterministic per
        // subdistrict_id). Only applied when the caller provided a
        // subdistrict_id, otherwise we'd be inventing variation for cart
        // sessions where the user hasn't picked a kecamatan yet.
        //
        // The previous range (0..2000) was too subtle — most users couldn't
        // tell whether their kecamatan choice actually affected ongkir.
        // 0..6000 is still well below realistic intra-city tariff variance
        // (RajaOngkir Pro can swing ~5–10k per kecamatan in practice) but
        // visible enough to feel responsive in the UI.
        $subAdj = $subdistrictId
            ? (abs(crc32($subdistrictId)) % 13) * 500
            : 0;

        $regBase = (int) round($weightKg * $basePerKg * $zoneMult) + $jitter + $subAdj;
        // Floor so a 1kg local package never looks free.
        $regBase = max(8000, $regBase);

        return [
            [
                'courier'     => $courier,
                'service'     => 'REG',
                'description' => 'Layanan Reguler',
                'cost'        => $regBase,
                'etd'         => $this->etdForZone($zone, 'REG'),
            ],
            [
                'courier'     => $courier,
                'service'     => 'YES',
                'description' => 'Yakin Esok Sampai',
                'cost'        => (int) round($regBase * 1.9),
                'etd'         => $this->etdForZone($zone, 'YES'),
            ],
            [
                'courier'     => $courier,
                'service'     => 'OKE',
                'description' => 'Ongkos Kirim Ekonomi',
                'cost'        => max(7000, (int) round($regBase * 0.78)),
                'etd'         => $this->etdForZone($zone, 'OKE'),
            ],
        ];
    }

    /**
     * Map a destination city_id to a shipping zone (1=closest, 5=furthest)
     * relative to the configured origin.
     *
     * Resolution order:
     *  1. Specific Jabodetabek city overrides → zone 1 (origin defaults to
     *     Jakarta Pusat, so Bekasi/Bogor/Depok-area packages should be cheap
     *     even though those cities live in Jawa Barat which would otherwise
     *     map to zone 2).
     *  2. Look up the destination's province in mockCities and apply the
     *     province → zone table.
     *  3. Default to zone 2 (Java) when nothing matches — safest middle
     *     value if a saved address has an unknown id.
     */
    protected function cityZone(string $destinationCityId): int
    {
        // Jabodetabek-area overrides (Jakarta + adjacent Jabar/Banten cities).
        $jabodetabekCityIds = [
            // DKI
            '152', '153', '154', '151', '155', '150',
            // Jabar (Bogor/Bekasi/Depok)
            '78', '79', '80', '81', '103',
            // Banten (Tangerang area)
            '455', '456', '91101',
        ];
        if (in_array($destinationCityId, $jabodetabekCityIds, true)) {
            return 1;
        }

        // province → zone table.
        $provinceZone = [
            // Zone 1 — origin metro
            '6'  => 1, // DKI Jakarta
            '3'  => 1, // Banten (rest of)

            // Zone 2 — rest of Java
            '9'  => 2, // Jawa Barat
            '10' => 2, // Jawa Tengah
            '11' => 2, // Jawa Timur
            '5'  => 2, // DI Yogyakarta

            // Zone 3 — Sumatra + Bali + NT
            '21' => 3, '32' => 3, '24' => 3, '26' => 3, '7' => 3, '8' => 3,
            '33' => 3, '4'  => 3, '2'  => 3, '18' => 3,
            '1'  => 3, '22' => 3, '23' => 3,

            // Zone 4 — Kalimantan + Sulawesi
            '12' => 4, '13' => 4, '14' => 4, '15' => 4, '35' => 4,
            '31' => 4, '34' => 4, '29' => 4, '28' => 4, '30' => 4, '27' => 4,

            // Zone 5 — Maluku + Papua
            '20' => 5, '19' => 5, '16' => 5, '25' => 5,
        ];

        $provinceId = $this->lookupCityProvince($destinationCityId);
        if ($provinceId !== null && isset($provinceZone[$provinceId])) {
            return $provinceZone[$provinceId];
        }
        return 2;
    }

    /** Find a city's province_id by scanning the mock dataset. Cached in-memory. */
    protected function lookupCityProvince(string $cityId): ?string
    {
        static $index = null;
        if ($index === null) {
            $index = [];
            foreach ($this->mockCities(null) as $row) {
                // First-write-wins. mockCities() is a flat merge; if the same
                // city_id appears twice across provinces (the legacy dataset
                // had a few collisions), the first hit is good enough for
                // zone classification.
                if (isset($row['city_id']) && ! isset($index[$row['city_id']])) {
                    $index[$row['city_id']] = (string) ($row['province_id'] ?? '');
                }
            }
        }
        return $index[$cityId] ?? null;
    }

    /** Reasonable ETD per zone & service tier. */
    protected function etdForZone(int $zone, string $tier): string
    {
        if ($tier === 'YES') {
            // Yakin Esok Sampai — only realistic in zones 1-2.
            return $zone <= 2 ? '1-1' : '2-2';
        }
        if ($tier === 'OKE') {
            return [1 => '2-3', 2 => '3-4', 3 => '4-6', 4 => '5-7', 5 => '7-10'][$zone] ?? '3-5';
        }
        // REG
        return [1 => '1-2', 2 => '2-3', 3 => '3-5', 4 => '4-6', 5 => '6-9'][$zone] ?? '2-3';
    }

    /**
     * Mock kecamatan (subdistrict) per city. Covers the cities most likely
     * to receive orders (DKI Jakarta, the rest of Jabodetabek, Bandung,
     * Yogyakarta, Surabaya, Medan, Makassar, Denpasar, Banda Aceh, ...).
     *
     * Cities not in this map return [] — the frontend handles that as
     * "kecamatan tidak tersedia, ongkir level kota" and lets the user
     * proceed without picking a kecamatan.
     *
     * Subdistrict IDs use synthetic 6-digit values (city_id * 1000 + n)
     * so they're stable, globally unique, and obviously not real
     * RajaOngkir Pro IDs (avoiding accidental collisions if/when this
     * project upgrades to the Pro plan).
     */
    protected function mockSubdistricts(string $cityId): array
    {
        $namesByCity = [
            // DKI Jakarta
            '152' /* Jakarta Pusat */  => ['Tanah Abang', 'Menteng', 'Senen', 'Kemayoran', 'Gambir', 'Sawah Besar', 'Cempaka Putih', 'Johar Baru'],
            '153' /* Jakarta Selatan */=> ['Kebayoran Baru', 'Kebayoran Lama', 'Tebet', 'Setiabudi', 'Mampang Prapatan', 'Pancoran', 'Pasar Minggu', 'Cilandak', 'Pesanggrahan', 'Jagakarsa'],
            '154' /* Jakarta Timur */  => ['Matraman', 'Pulogadung', 'Jatinegara', 'Kramat Jati', 'Pasar Rebo', 'Cakung', 'Duren Sawit', 'Makasar', 'Ciracas', 'Cipayung'],
            '151' /* Jakarta Utara */  => ['Penjaringan', 'Pademangan', 'Tanjung Priok', 'Koja', 'Kelapa Gading', 'Cilincing'],
            '155' /* Jakarta Barat */  => ['Tambora', 'Taman Sari', 'Grogol Petamburan', 'Palmerah', 'Kebon Jeruk', 'Kembangan', 'Cengkareng', 'Kalideres'],
            '150' /* Kep. Seribu */    => ['Kepulauan Seribu Utara', 'Kepulauan Seribu Selatan'],

            // Banten — Tangerang area
            '455' /* Kota Tangerang */         => ['Cipondoh', 'Karawaci', 'Cibodas', 'Pinang', 'Karang Tengah', 'Ciledug', 'Larangan', 'Tangerang', 'Periuk', 'Batu Ceper'],
            '456' /* Tangerang Selatan */      => ['Serpong', 'Serpong Utara', 'Pondok Aren', 'Ciputat', 'Ciputat Timur', 'Pamulang', 'Setu'],
            '91101' /* Kab. Tangerang */       => ['Kelapa Dua', 'Curug', 'Cikupa', 'Pasar Kemis', 'Sepatan', 'Mauk', 'Tigaraksa'],

            // Jawa Barat — Bandung & Jabodetabek extension
            '78'  /* Kota Bekasi */    => ['Bekasi Barat', 'Bekasi Timur', 'Bekasi Utara', 'Bekasi Selatan', 'Pondok Gede', 'Jatiasih', 'Pondok Melati', 'Bantargebang', 'Medan Satria', 'Mustika Jaya', 'Rawalumbu', 'Jatisampurna'],
            '79'  /* Kab. Bekasi */    => ['Tambun Selatan', 'Tambun Utara', 'Cikarang Pusat', 'Cikarang Barat', 'Cikarang Utara', 'Cikarang Selatan', 'Cikarang Timur', 'Cibitung', 'Setu', 'Serang Baru'],
            '80'  /* Kota Bogor */     => ['Bogor Tengah', 'Bogor Utara', 'Bogor Selatan', 'Bogor Barat', 'Bogor Timur', 'Tanah Sareal'],
            '81'  /* Kab. Bogor */     => ['Cibinong', 'Gunung Putri', 'Gunung Sindur', 'Bojonggede', 'Citeureup', 'Sukaraja', 'Babakan Madang', 'Cileungsi', 'Cariu', 'Tanjungsari'],
            '103' /* Kota Depok */     => ['Beji', 'Pancoran Mas', 'Sukmajaya', 'Cilodong', 'Cimanggis', 'Tapos', 'Sawangan', 'Bojongsari', 'Cinere', 'Limo', 'Cipayung'],
            '22'  /* Kota Bandung */   => ['Sukajadi', 'Cidadap', 'Coblong', 'Bandung Wetan', 'Sumur Bandung', 'Andir', 'Cicendo', 'Bandung Kidul', 'Lengkong', 'Regol', 'Astana Anyar', 'Bojongloa Kaler', 'Antapani', 'Arcamanik', 'Cibeunying Kaler', 'Cibeunying Kidul', 'Mandalajati', 'Ujungberung', 'Cinambo', 'Panyileukan'],
            '23'  /* Kab. Bandung */   => ['Soreang', 'Margahayu', 'Margaasih', 'Katapang', 'Dayeuhkolot', 'Bojongsoang', 'Banjaran', 'Cileunyi', 'Cimenyan', 'Cilengkrang', 'Rancaekek', 'Pameungpeuk'],
            '115' /* Cimahi */         => ['Cimahi Utara', 'Cimahi Tengah', 'Cimahi Selatan'],
            // Jabar lainnya — sering jadi tujuan kirim e-commerce
            '105'  /* Kota Cirebon */   => ['Kejaksan', 'Lemahwungkuk', 'Harjamukti', 'Pekalipan', 'Kesambi'],
            '91210'/* Kab. Cirebon */   => ['Sumber', 'Kedawung', 'Mundu', 'Plered', 'Weru', 'Talun', 'Tengah Tani', 'Plumbon', 'Arjawinangun', 'Susukan', 'Babakan', 'Sindang Laut', 'Pabedilan', 'Gegesik', 'Klangenan'],
            '423'  /* Kota Sukabumi */  => ['Cikole', 'Citamiang', 'Warudoyong', 'Gunungpuyuh', 'Cibeureum', 'Lembursitu', 'Baros'],
            '91213'/* Kab. Sukabumi */  => ['Cisaat', 'Cibadak', 'Sukabumi', 'Sukaraja', 'Cicurug', 'Parungkuda', 'Cidahu', 'Palabuhanratu', 'Cikidang', 'Nagrak'],
            '470'  /* Kota Tasikmalaya */ => ['Cipedes', 'Cihideung', 'Tawang', 'Mangkubumi', 'Indihiang', 'Kawalu', 'Tamansari', 'Bungursari', 'Purbaratu', 'Cibeureum'],
            '91214'/* Kab. Tasikmalaya */ => ['Singaparna', 'Manonjaya', 'Cikatomas', 'Karangnunggal', 'Cipatujah', 'Salopa', 'Taraju', 'Sariwangi', 'Sukaraja', 'Cigalontang'],
            '91201'/* Kota Banjar */    => ['Banjar', 'Pataruman', 'Purwaharja', 'Langensari'],
            '91202'/* Kab. Bandung Barat */ => ['Padalarang', 'Ngamprah', 'Cipatat', 'Cisarua', 'Lembang', 'Parongpong', 'Cikalongwetan', 'Cipongkor', 'Batujajar', 'Cililin'],
            '91203'/* Kab. Cianjur */   => ['Cianjur', 'Karangtengah', 'Sukaresmi', 'Cipanas', 'Pacet', 'Sukaluyu', 'Mande', 'Warungkondang', 'Cibeber', 'Cilaku', 'Ciranjang'],
            '91204'/* Kab. Garut */     => ['Garut Kota', 'Tarogong Kaler', 'Tarogong Kidul', 'Bayongbong', 'Cilawu', 'Leles', 'Wanaraja', 'Cisurupan', 'Cikajang', 'Banyuresmi', 'Pameungpeuk', 'Bungbulang'],
            '91205'/* Kab. Sumedang */  => ['Sumedang Selatan', 'Sumedang Utara', 'Cimalaka', 'Tanjungsari', 'Jatinangor', 'Cikeruh', 'Rancakalong', 'Tomo', 'Wado', 'Conggeang'],
            '91206'/* Kab. Subang */    => ['Subang', 'Pagaden', 'Kalijati', 'Cibogo', 'Cipeundeuy', 'Pamanukan', 'Pusakanagara', 'Patokbeusi', 'Ciasem', 'Pabuaran', 'Jalancagak', 'Sagalaherang'],
            '91207'/* Kab. Karawang */  => ['Karawang Barat', 'Karawang Timur', 'Telukjambe Timur', 'Telukjambe Barat', 'Klari', 'Cikampek', 'Kotabaru', 'Purwasari', 'Tirtamulya', 'Jatisari', 'Cilamaya Kulon', 'Rengasdengklok', 'Pedes'],
            '91208'/* Kab. Purwakarta */=> ['Purwakarta', 'Babakancikao', 'Jatiluhur', 'Sukatani', 'Plered', 'Pondoksalam', 'Wanayasa', 'Kiarapedes', 'Bojong', 'Campaka'],
            '91209'/* Kab. Indramayu */ => ['Indramayu', 'Sindang', 'Lohbener', 'Jatibarang', 'Kertasemaya', 'Karangampel', 'Krangkeng', 'Juntinyuat', 'Sliyeg', 'Balongan', 'Losarang', 'Lelea'],
            '91211'/* Kab. Kuningan */  => ['Kuningan', 'Kramatmulya', 'Cilimus', 'Mandirancan', 'Pasawahan', 'Cigugur', 'Jalaksana', 'Garawangi', 'Lebakwangi', 'Cidahu', 'Ciawigebang'],
            '91212'/* Kab. Majalengka */=> ['Majalengka', 'Cigasong', 'Sukahaji', 'Maja', 'Jatiwangi', 'Dawuan', 'Kasokandel', 'Palasah', 'Leuwimunding', 'Jatitujuh', 'Kadipaten', 'Kertajati'],
            '91215'/* Kab. Ciamis */    => ['Ciamis', 'Cikoneng', 'Cijeungjing', 'Sadananya', 'Cidolog', 'Banjarsari', 'Pamarican', 'Cisaga', 'Rancah', 'Lakbok', 'Panumbangan'],
            '91216'/* Kab. Pangandaran */ => ['Pangandaran', 'Parigi', 'Cijulang', 'Cigugur', 'Mangunjaya', 'Padaherang', 'Kalipucang', 'Cimerak', 'Sidamulih'],

            // Jawa Tengah / DIY
            '399' /* Kota Semarang */  => ['Semarang Tengah', 'Semarang Utara', 'Semarang Timur', 'Semarang Selatan', 'Semarang Barat', 'Tugu', 'Genuk', 'Pedurungan', 'Banyumanik', 'Tembalang', 'Candisari', 'Gajahmungkur', 'Gunungpati', 'Mijen', 'Ngaliyan', 'Gayamsari'],
            '457' /* Solo (Surakarta) */ => ['Laweyan', 'Serengan', 'Pasar Kliwon', 'Jebres', 'Banjarsari'],
            '501' /* Yogyakarta */     => ['Mantrijeron', 'Kraton', 'Mergangsan', 'Umbulharjo', 'Kotagede', 'Gondokusuman', 'Danurejan', 'Pakualaman', 'Gondomanan', 'Ngampilan', 'Wirobrajan', 'Gedongtengen', 'Jetis', 'Tegalrejo'],
            '91401' /* Sleman */       => ['Mlati', 'Depok', 'Berbah', 'Kalasan', 'Ngemplak', 'Gamping', 'Godean', 'Sleman', 'Pakem', 'Cangkringan'],
            '39'    /* Bantul */       => ['Bantul', 'Kasihan', 'Sewon', 'Banguntapan', 'Pleret', 'Piyungan', 'Sedayu'],
            // Jateng tambahan — penting buat e-commerce
            '253'   /* Kota Magelang */    => ['Magelang Utara', 'Magelang Tengah', 'Magelang Selatan'],
            '343'   /* Kota Pekalongan */  => ['Pekalongan Utara', 'Pekalongan Timur', 'Pekalongan Selatan', 'Pekalongan Barat'],
            '430'   /* Kota Tegal */       => ['Tegal Barat', 'Tegal Timur', 'Tegal Selatan', 'Margadana'],
            '398'   /* Salatiga */         => ['Sidorejo', 'Sidomukti', 'Argomulyo', 'Tingkir'],
            '91301' /* Kab. Semarang */    => ['Ungaran Barat', 'Ungaran Timur', 'Bawen', 'Bergas', 'Pringapus', 'Tuntang', 'Ambarawa', 'Sumowono', 'Banyubiru'],
            '91302' /* Kab. Banyumas */    => ['Purwokerto Utara', 'Purwokerto Selatan', 'Purwokerto Timur', 'Purwokerto Barat', 'Sokaraja', 'Kembaran', 'Sumbang', 'Baturraden', 'Banyumas', 'Patikraja', 'Cilongok', 'Ajibarang'],
            '91303' /* Kab. Cilacap */     => ['Cilacap Utara', 'Cilacap Tengah', 'Cilacap Selatan', 'Kroya', 'Sampang', 'Maos', 'Adipala', 'Binangun', 'Nusawungu', 'Kawunganten', 'Kedungreja', 'Sidareja', 'Majenang'],
            '91304' /* Kab. Klaten */      => ['Klaten Utara', 'Klaten Tengah', 'Klaten Selatan', 'Wedi', 'Bayat', 'Cawas', 'Trucuk', 'Ceper', 'Pedan', 'Karangdowo', 'Delanggu', 'Polanharjo'],
            '91305' /* Kab. Boyolali */    => ['Boyolali', 'Mojosongo', 'Teras', 'Banyudono', 'Sambi', 'Ngemplak', 'Nogosari', 'Simo', 'Karanggede', 'Klego', 'Andong', 'Cepogo'],
            '91306' /* Kab. Sragen */      => ['Sragen', 'Karangmalang', 'Masaran', 'Kedawung', 'Sambirejo', 'Gondang', 'Sambungmacan', 'Ngrampal', 'Sumberlawang'],
            '91307' /* Kab. Sukoharjo */   => ['Sukoharjo', 'Kartasura', 'Grogol', 'Baki', 'Mojolaban', 'Polokarto', 'Bendosari', 'Tawangsari', 'Bulu', 'Nguter'],
            '91308' /* Kab. Karanganyar */ => ['Karanganyar', 'Tasikmadu', 'Jaten', 'Colomadu', 'Gondangrejo', 'Mojogedang', 'Kebakkramat', 'Kerjo', 'Jenawi', 'Tawangmangu', 'Matesih'],
            '91310' /* Kab. Demak */       => ['Demak', 'Sayung', 'Karangtengah', 'Mranggen', 'Bonang', 'Wonosalam', 'Dempet', 'Karanganyar', 'Mijen', 'Wedung'],
            '91311' /* Kab. Kudus */       => ['Kota', 'Jati', 'Mejobo', 'Bae', 'Gebog', 'Kaliwungu', 'Undaan', 'Jekulo', 'Dawe'],
            '91312' /* Kab. Jepara */      => ['Jepara', 'Tahunan', 'Kedung', 'Pecangaan', 'Kalinyamatan', 'Mayong', 'Welahan', 'Bangsri', 'Mlonggo', 'Keling'],
            '91313' /* Kab. Pati */        => ['Pati', 'Margorejo', 'Juwana', 'Tayu', 'Margoyoso', 'Trangkil', 'Wedarijaksa', 'Gabus', 'Winong', 'Kayen', 'Sukolilo', 'Tambakromo'],
            '91316' /* Kab. Brebes */      => ['Brebes', 'Wanasari', 'Bulakamba', 'Tanjung', 'Losari', 'Tonjong', 'Ketanggungan', 'Bumiayu', 'Paguyangan', 'Larangan'],
            '91317' /* Kab. Tegal */       => ['Slawi', 'Adiwerna', 'Pangkah', 'Dukuhturi', 'Talang', 'Lebaksiu', 'Balapulang', 'Pagerbarang', 'Margasari', 'Bumijawa'],
            '91325' /* Kab. Purworejo */   => ['Purworejo', 'Banyuurip', 'Kutoarjo', 'Bayan', 'Loano', 'Bener', 'Bagelen', 'Butuh', 'Pituruh', 'Bruno'],
            '91328' /* Kab. Kebumen */     => ['Kebumen', 'Pejagoan', 'Sruweng', 'Karanganyar', 'Adimulyo', 'Kuwarasan', 'Buayan', 'Puring', 'Petanahan', 'Klirong', 'Bulupesantren', 'Ambal', 'Mirit'],

            // Jawa Timur
            '444' /* Kota Surabaya */  => ['Tegalsari', 'Genteng', 'Bubutan', 'Simokerto', 'Pabean Cantian', 'Semampir', 'Krembangan', 'Kenjeran', 'Bulak', 'Tambaksari', 'Gubeng', 'Rungkut', 'Tenggilis Mejoyo', 'Gunung Anyar', 'Sukolilo', 'Mulyorejo', 'Sawahan', 'Wonokromo', 'Karangpilang', 'Dukuh Pakis', 'Wiyung', 'Gayungan', 'Wonocolo', 'Jambangan'],
            '256' /* Kota Malang */    => ['Klojen', 'Blimbing', 'Kedungkandang', 'Sukun', 'Lowokwaru'],
            '142' /* Gresik */         => ['Gresik', 'Kebomas', 'Manyar', 'Cerme', 'Driyorejo', 'Menganti', 'Wringinanom', 'Duduksampeyan'],
            '409' /* Sidoarjo */       => ['Sidoarjo', 'Buduran', 'Candi', 'Waru', 'Taman', 'Krian', 'Gedangan', 'Sukodono', 'Tanggulangin', 'Porong'],
            // Jatim tambahan
            '174'   /* Kota Kediri */      => ['Mojoroto', 'Kota', 'Pesantren'],
            '266'   /* Kota Mojokerto */   => ['Magersari', 'Prajurit Kulon', 'Kranggan'],
            '317'   /* Kota Pasuruan */    => ['Gadingrejo', 'Bugul Kidul', 'Purworejo', 'Panggungrejo'],
            '376'   /* Kota Probolinggo */ => ['Mayangan', 'Kanigaran', 'Kademangan', 'Wonoasih', 'Kedopok'],
            '215'   /* Kota Madiun */      => ['Manguharjo', 'Taman', 'Kartoharjo'],
            '40'    /* Kota Batu */        => ['Batu', 'Bumiaji', 'Junrejo'],
            '91501' /* Kota Blitar */      => ['Sukorejo', 'Kepanjenkidul', 'Sananwetan'],
            '255'   /* Kab. Malang */      => ['Kepanjen', 'Singosari', 'Lawang', 'Pakis', 'Tumpang', 'Bululawang', 'Gondanglegi', 'Pagak', 'Ngantang', 'Pujon', 'Wajak', 'Tajinan', 'Karangploso'],
            '91502' /* Kab. Banyuwangi */  => ['Banyuwangi', 'Giri', 'Kalipuro', 'Glagah', 'Rogojampi', 'Muncar', 'Cluring', 'Genteng', 'Srono', 'Kabat', 'Sempu', 'Pesanggaran'],
            '91503' /* Kab. Jember */      => ['Sumbersari', 'Patrang', 'Kaliwates', 'Ambulu', 'Wuluhan', 'Balung', 'Tanggul', 'Rambipuji', 'Mayang', 'Bangsalsari', 'Puger', 'Kalisat'],
            '91504' /* Kab. Lumajang */    => ['Lumajang', 'Sukodono', 'Tekung', 'Kunir', 'Yosowilangun', 'Tempeh', 'Rowokangkung', 'Pasrujambe', 'Senduro', 'Pasirian'],
            '91510' /* Kab. Jombang */     => ['Jombang', 'Diwek', 'Mojoagung', 'Mojowarno', 'Tembelang', 'Megaluh', 'Peterongan', 'Sumobito', 'Kesamben', 'Ngoro', 'Bareng'],
            '91511' /* Kab. Lamongan */    => ['Lamongan', 'Babat', 'Brondong', 'Paciran', 'Kembangbahu', 'Sukodadi', 'Pucuk', 'Sekaran', 'Maduran', 'Karanggeneng', 'Modo'],
            '91512' /* Kab. Tuban */       => ['Tuban', 'Semanding', 'Palang', 'Jenu', 'Merakurak', 'Kerek', 'Tambakboyo', 'Bancar', 'Jatirogo', 'Bangilan', 'Singgahan', 'Senori'],
            '91513' /* Kab. Bojonegoro */  => ['Bojonegoro', 'Dander', 'Kapas', 'Kalitidu', 'Padangan', 'Purwosari', 'Kasiman', 'Malo', 'Trucuk', 'Sumberrejo', 'Baureno', 'Kepoh Baru'],
            '91523' /* Kab. Kediri */      => ['Pare', 'Plemahan', 'Pagu', 'Kunjang', 'Papar', 'Purwoasri', 'Kayen Kidul', 'Ngadiluwih', 'Wates', 'Ngancar', 'Plosoklaten', 'Gurah'],

            // Bali
            '114' /* Denpasar */       => ['Denpasar Utara', 'Denpasar Timur', 'Denpasar Selatan', 'Denpasar Barat'],
            '143' /* Gianyar */        => ['Gianyar', 'Ubud', 'Sukawati', 'Blahbatuh', 'Tampaksiring', 'Tegallalang', 'Payangan'],

            // NOTE: city_id '17' is shared between Banda Aceh (Aceh) and
            // Kabupaten Badung (Bali) in the legacy mock dataset. Resolving
            // a kecamatan list keyed by city_id alone would silently leak
            // Banda Aceh subdistricts to Bali users (or vice versa), which
            // is worse than showing nothing — so for that one collision we
            // intentionally omit kecamatan and let both cities fall back
            // to city-level ongkir until the legacy ids get reissued.

            // Sumatera Utara
            '278' /* Medan */          => ['Medan Kota', 'Medan Baru', 'Medan Timur', 'Medan Tembung', 'Medan Petisah', 'Medan Helvetia', 'Medan Polonia', 'Medan Marelan', 'Medan Selayang', 'Medan Sunggal', 'Medan Tuntungan', 'Medan Johor', 'Medan Amplas', 'Medan Area', 'Medan Belawan', 'Medan Deli', 'Medan Denai', 'Medan Labuhan', 'Medan Maimun', 'Medan Perjuangan', 'Medan Barat'],

            // Sumatera Selatan
            '348' /* Palembang */      => ['Ilir Barat I', 'Ilir Barat II', 'Ilir Timur I', 'Ilir Timur II', 'Seberang Ulu I', 'Seberang Ulu II', 'Sukarami', 'Sako', 'Plaju', 'Kemuning', 'Kalidoni', 'Bukit Kecil', 'Gandus', 'Kertapati', 'Alang-Alang Lebar', 'Sematang Borang'],

            // Sulawesi Selatan
            '254' /* Makassar */       => ['Mariso', 'Mamajang', 'Tamalate', 'Rappocini', 'Makassar', 'Ujung Pandang', 'Wajo', 'Bontoala', 'Ujung Tanah', 'Tallo', 'Panakkukang', 'Manggala', 'Biringkanaya', 'Tamalanrea'],

            // Riau
            '350' /* Pekanbaru */      => ['Sukajadi', 'Pekanbaru Kota', 'Sail', 'Senapelan', 'Lima Puluh', 'Bukit Raya', 'Tampan', 'Marpoyan Damai', 'Tenayan Raya', 'Payung Sekaki', 'Rumbai', 'Rumbai Pesisir'],

            // Kepulauan Riau
            '48' /* Batam */           => ['Sekupang', 'Batu Aji', 'Sagulung', 'Lubuk Baja', 'Batam Kota', 'Bengkong', 'Batu Ampar', 'Nongsa', 'Sei Beduk', 'Bulang', 'Belakang Padang', 'Galang'],

            // Jambi
            '156' /* Jambi */          => ['Telanaipura', 'Jambi Selatan', 'Jambi Timur', 'Pasar Jambi', 'Pelayangan', 'Danau Teluk', 'Kota Baru', 'Jelutung'],

            // Lampung
            '21' /* Bandar Lampung */  => ['Tanjung Karang Pusat', 'Tanjung Karang Timur', 'Tanjung Karang Barat', 'Teluk Betung Utara', 'Teluk Betung Selatan', 'Teluk Betung Barat', 'Teluk Betung Timur', 'Panjang', 'Sukabumi', 'Sukarame', 'Kedaton', 'Rajabasa', 'Tanjung Senang', 'Way Halim', 'Langkapura', 'Enggal', 'Labuhan Ratu', 'Bumi Waras', 'Kemiling', 'Kedamaian'],

            // Kalimantan Selatan
            '13' /* Banjarmasin */     => ['Banjarmasin Tengah', 'Banjarmasin Utara', 'Banjarmasin Timur', 'Banjarmasin Selatan', 'Banjarmasin Barat'],

            // Kalimantan Timur
            '15' /* Balikpapan */      => ['Balikpapan Selatan', 'Balikpapan Tengah', 'Balikpapan Utara', 'Balikpapan Timur', 'Balikpapan Barat', 'Balikpapan Kota'],
            '386' /* Samarinda */      => ['Samarinda Kota', 'Samarinda Ulu', 'Samarinda Ilir', 'Samarinda Utara', 'Samarinda Seberang', 'Sungai Kunjang', 'Sungai Pinang', 'Palaran', 'Loa Janan Ilir', 'Sambutan'],

            // Sulawesi Utara
            '263' /* Manado */         => ['Malalayang', 'Sario', 'Wanea', 'Wenang', 'Tikala', 'Mapanget', 'Singkil', 'Tuminting', 'Bunaken', 'Paal Dua', 'Bunaken Kepulauan'],

            // Papua / Papua Barat
            '161' /* Jayapura */       => ['Jayapura Utara', 'Jayapura Selatan', 'Heram', 'Abepura', 'Muara Tami'],
            '93201' /* Sorong */       => ['Sorong', 'Sorong Barat', 'Sorong Timur', 'Sorong Utara', 'Sorong Kota', 'Sorong Manoi'],
        ];

        $list = $namesByCity[$cityId] ?? [];
        if (empty($list)) {
            return [];
        }

        $out = [];
        // Synthetic id = "{cityId}-{1-based index}" so it's stable, unique
        // per (city, kecamatan), and trivially traceable in logs.
        foreach ($list as $i => $name) {
            $idx = $i + 1;
            $out[] = [
                'subdistrict_id'   => $cityId.'-'.$idx,
                'city_id'          => (string) $cityId,
                'subdistrict_name' => $name,
            ];
        }
        return $out;
    }
}
