<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

/**
 * Thin wrapper for RajaOngkir (starter plan).
 * Docs: https://rajaongkir.com/dokumentasi
 *
 * When no API key is configured, falls back to a mock so the dev UI still works.
 */
class RajaOngkirService
{
    protected string $baseUrl;
    protected ?string $apiKey;
    protected string $originCityId;

    public function __construct()
    {
        $this->baseUrl      = (string) config('services.rajaongkir.base_url');
        $this->apiKey       = config('services.rajaongkir.api_key');
        $this->originCityId = (string) config('services.rajaongkir.origin_city_id');
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
        $res = Http::withHeaders(['key' => $this->apiKey])->get("{$this->baseUrl}/province");
        return $res->json('rajaongkir.results') ?? [];
    }

    /** GET /city?province=ID */
    public function cities(?string $provinceId = null): array
    {
        if (! $this->enabled()) {
            return $this->mockCities($provinceId);
        }
        $res = Http::withHeaders(['key' => $this->apiKey])
            ->get("{$this->baseUrl}/city", array_filter(['province' => $provinceId]));
        return $res->json('rajaongkir.results') ?? [];
    }

    /**
     * POST /cost
     *
     * @param  string  $destinationCityId  RajaOngkir destination city id
     * @param  int     $weightGram         total weight in grams
     * @param  string  $courier            jne|pos|tiki (starter)
     */
    public function cost(string $destinationCityId, int $weightGram, string $courier = 'jne'): array
    {
        if (! $this->enabled()) {
            return $this->mockCost($courier, $weightGram);
        }
        $res = Http::asForm()->withHeaders(['key' => $this->apiKey])
            ->post("{$this->baseUrl}/cost", [
                'origin'      => $this->originCityId,
                'destination' => $destinationCityId,
                'weight'      => max(1, $weightGram),
                'courier'     => $courier,
            ]);
        $results = $res->json('rajaongkir.results') ?? [];
        // Flatten costs array for easier frontend consumption.
        $flat = [];
        foreach ($results as $r) {
            foreach (($r['costs'] ?? []) as $c) {
                $flat[] = [
                    'courier'  => $r['code'] ?? $courier,
                    'service'  => $c['service'] ?? null,
                    'description' => $c['description'] ?? null,
                    'cost'     => (int) ($c['cost'][0]['value'] ?? 0),
                    'etd'      => $c['cost'][0]['etd'] ?? null,
                ];
            }
        }
        return $flat;
    }

    // --------------------- mocks ---------------------

    protected function mockProvinces(): array
    {
        return [
            ['province_id' => '6',  'province' => 'DKI Jakarta'],
            ['province_id' => '9',  'province' => 'Jawa Barat'],
            ['province_id' => '10', 'province' => 'Jawa Tengah'],
            ['province_id' => '11', 'province' => 'Jawa Timur'],
        ];
    }

    protected function mockCities(?string $provinceId): array
    {
        $all = [
            '6'  => [
                ['city_id' => '152', 'province_id' => '6', 'type' => 'Kota', 'city_name' => 'Jakarta Pusat', 'postal_code' => '10110'],
                ['city_id' => '153', 'province_id' => '6', 'type' => 'Kota', 'city_name' => 'Jakarta Selatan', 'postal_code' => '12110'],
            ],
            '9'  => [
                ['city_id' => '22',  'province_id' => '9', 'type' => 'Kota', 'city_name' => 'Bandung',   'postal_code' => '40111'],
                ['city_id' => '78',  'province_id' => '9', 'type' => 'Kota', 'city_name' => 'Bekasi',    'postal_code' => '17112'],
            ],
            '10' => [
                ['city_id' => '399', 'province_id' => '10', 'type' => 'Kota', 'city_name' => 'Semarang', 'postal_code' => '50135'],
            ],
            '11' => [
                ['city_id' => '444', 'province_id' => '11', 'type' => 'Kota', 'city_name' => 'Surabaya', 'postal_code' => '60119'],
            ],
        ];
        if ($provinceId && isset($all[$provinceId])) {
            return $all[$provinceId];
        }
        return array_merge(...array_values($all));
    }

    protected function mockCost(string $courier, int $weightGram): array
    {
        $base = max(9000, (int) ceil($weightGram / 1000) * 9000);
        return [
            ['courier' => $courier, 'service' => 'REG', 'description' => 'Layanan Reguler',     'cost' => $base,              'etd' => '2-3'],
            ['courier' => $courier, 'service' => 'YES', 'description' => 'Yakin Esok Sampai',   'cost' => (int) ($base * 2),  'etd' => '1-1'],
            ['courier' => $courier, 'service' => 'OKE', 'description' => 'Ongkos Kirim Ekonomi','cost' => (int) ($base * 0.8),'etd' => '3-5'],
        ];
    }
}
