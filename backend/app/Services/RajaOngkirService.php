<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Thin wrapper for RajaOngkir (starter plan).
 * Docs: https://rajaongkir.com/dokumentasi
 *
 * When no API key is configured (or the live call fails), falls back to a
 * mock so the dev UI still works end-to-end.
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
        try {
            $res = Http::timeout(8)->withHeaders(['key' => $this->apiKey])
                ->get("{$this->baseUrl}/province");
            $rows = $res->json('rajaongkir.results') ?? [];
            // If RajaOngkir returns nothing (bad key, plan limit, downtime),
            // don't leave the dropdown empty — fall back to the mock list.
            return ! empty($rows) ? $rows : $this->mockProvinces();
        } catch (\Throwable $e) {
            Log::warning('[rajaongkir] provinces failed: '.$e->getMessage());
            return $this->mockProvinces();
        }
    }

    /** GET /city?province=ID */
    public function cities(?string $provinceId = null): array
    {
        if (! $this->enabled()) {
            return $this->mockCities($provinceId);
        }
        try {
            $res = Http::timeout(8)->withHeaders(['key' => $this->apiKey])
                ->get("{$this->baseUrl}/city", array_filter(['province' => $provinceId]));
            $rows = $res->json('rajaongkir.results') ?? [];
            return ! empty($rows) ? $rows : $this->mockCities($provinceId);
        } catch (\Throwable $e) {
            Log::warning('[rajaongkir] cities failed: '.$e->getMessage());
            return $this->mockCities($provinceId);
        }
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
        try {
            $res = Http::timeout(8)->asForm()->withHeaders(['key' => $this->apiKey])
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
            return ! empty($flat) ? $flat : $this->mockCost($courier, $weightGram);
        } catch (\Throwable $e) {
            Log::warning('[rajaongkir] cost failed: '.$e->getMessage());
            return $this->mockCost($courier, $weightGram);
        }
    }

    // --------------------- mocks ---------------------

    /**
     * Mock list of all 34 RajaOngkir provinces (IDs match the real RajaOngkir
     * starter response). Lets the dev UI feel realistic without an API key.
     */
    protected function mockProvinces(): array
    {
        return [
            ['province_id' => '21', 'province' => 'Aceh'],
            ['province_id' => '32', 'province' => 'Sumatera Utara'],
            ['province_id' => '24', 'province' => 'Sumatera Barat'],
            ['province_id' => '26', 'province' => 'Riau'],
            ['province_id' => '5',  'province' => 'Kepulauan Riau'],
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
            ['province_id' => '17', 'province' => 'Maluku Utara'],
            ['province_id' => '24', 'province' => 'Papua Barat'],
            ['province_id' => '25', 'province' => 'Papua'],
        ];
    }

    /**
     * Mock cities per province. IDs match RajaOngkir starter where known.
     */
    protected function mockCities(?string $provinceId): array
    {
        $all = [
            // Aceh
            '21' => [
                ['city_id' => '17',  'province_id' => '21', 'type' => 'Kota',      'city_name' => 'Banda Aceh',  'postal_code' => '23111'],
                ['city_id' => '236', 'province_id' => '21', 'type' => 'Kota',      'city_name' => 'Lhokseumawe', 'postal_code' => '24351'],
            ],
            // Sumatera Utara
            '32' => [
                ['city_id' => '278', 'province_id' => '32', 'type' => 'Kota', 'city_name' => 'Medan',     'postal_code' => '20111'],
                ['city_id' => '52',  'province_id' => '32', 'type' => 'Kota', 'city_name' => 'Binjai',    'postal_code' => '20712'],
                ['city_id' => '419', 'province_id' => '32', 'type' => 'Kota', 'city_name' => 'Pematang Siantar', 'postal_code' => '21111'],
            ],
            // Sumatera Barat
            '24' => [
                ['city_id' => '341', 'province_id' => '24', 'type' => 'Kota',      'city_name' => 'Padang',     'postal_code' => '25111'],
                ['city_id' => '54',  'province_id' => '24', 'type' => 'Kota',      'city_name' => 'Bukittinggi','postal_code' => '26111'],
            ],
            // Riau
            '26' => [
                ['city_id' => '350', 'province_id' => '26', 'type' => 'Kota', 'city_name' => 'Pekanbaru', 'postal_code' => '28111'],
                ['city_id' => '125', 'province_id' => '26', 'type' => 'Kota', 'city_name' => 'Dumai',     'postal_code' => '28811'],
            ],
            // Kepulauan Riau
            '17' => [
                ['city_id' => '48', 'province_id' => '17', 'type' => 'Kota', 'city_name' => 'Batam',         'postal_code' => '29400'],
                ['city_id' => '442', 'province_id' => '17', 'type' => 'Kota', 'city_name' => 'Tanjung Pinang','postal_code' => '29111'],
            ],
            // Jambi
            '8' => [
                ['city_id' => '156', 'province_id' => '8',  'type' => 'Kota', 'city_name' => 'Jambi', 'postal_code' => '36111'],
            ],
            // Sumatera Selatan
            '33' => [
                ['city_id' => '348', 'province_id' => '33', 'type' => 'Kota', 'city_name' => 'Palembang', 'postal_code' => '30111'],
                ['city_id' => '276', 'province_id' => '33', 'type' => 'Kota', 'city_name' => 'Lubuk Linggau', 'postal_code' => '31611'],
            ],
            // Bangka Belitung
            '4'  => [
                ['city_id' => '349', 'province_id' => '4',  'type' => 'Kota', 'city_name' => 'Pangkal Pinang', 'postal_code' => '33115'],
            ],
            // Bengkulu
            '2'  => [
                ['city_id' => '63', 'province_id' => '2',  'type' => 'Kota', 'city_name' => 'Bengkulu', 'postal_code' => '38229'],
            ],
            // Lampung
            '18' => [
                ['city_id' => '21', 'province_id' => '18', 'type' => 'Kota',      'city_name' => 'Bandar Lampung', 'postal_code' => '35139'],
                ['city_id' => '273', 'province_id' => '18', 'type' => 'Kota',     'city_name' => 'Metro',          'postal_code' => '34111'],
            ],
            // DKI Jakarta
            '6'  => [
                ['city_id' => '152', 'province_id' => '6', 'type' => 'Kota', 'city_name' => 'Jakarta Pusat',  'postal_code' => '10110'],
                ['city_id' => '153', 'province_id' => '6', 'type' => 'Kota', 'city_name' => 'Jakarta Selatan','postal_code' => '12110'],
                ['city_id' => '154', 'province_id' => '6', 'type' => 'Kota', 'city_name' => 'Jakarta Timur',  'postal_code' => '13330'],
                ['city_id' => '151', 'province_id' => '6', 'type' => 'Kota', 'city_name' => 'Jakarta Utara',  'postal_code' => '14140'],
                ['city_id' => '155', 'province_id' => '6', 'type' => 'Kota', 'city_name' => 'Jakarta Barat',  'postal_code' => '11220'],
                ['city_id' => '150', 'province_id' => '6', 'type' => 'Kabupaten', 'city_name' => 'Kepulauan Seribu', 'postal_code' => '14550'],
            ],
            // Banten
            '3'  => [
                ['city_id' => '455', 'province_id' => '3',  'type' => 'Kota',      'city_name' => 'Tangerang',         'postal_code' => '15111'],
                ['city_id' => '456', 'province_id' => '3',  'type' => 'Kota',      'city_name' => 'Tangerang Selatan', 'postal_code' => '15311'],
                ['city_id' => '76',  'province_id' => '3',  'type' => 'Kota',      'city_name' => 'Cilegon',           'postal_code' => '42417'],
                ['city_id' => '402', 'province_id' => '3',  'type' => 'Kota',      'city_name' => 'Serang',            'postal_code' => '42111'],
            ],
            // Jawa Barat
            '9'  => [
                ['city_id' => '22',  'province_id' => '9',  'type' => 'Kota',      'city_name' => 'Bandung',         'postal_code' => '40111'],
                ['city_id' => '23',  'province_id' => '9',  'type' => 'Kabupaten', 'city_name' => 'Bandung',         'postal_code' => '40311'],
                ['city_id' => '78',  'province_id' => '9',  'type' => 'Kota',      'city_name' => 'Bekasi',          'postal_code' => '17112'],
                ['city_id' => '79',  'province_id' => '9',  'type' => 'Kabupaten', 'city_name' => 'Bekasi',          'postal_code' => '17837'],
                ['city_id' => '80',  'province_id' => '9',  'type' => 'Kota',      'city_name' => 'Bogor',           'postal_code' => '16119'],
                ['city_id' => '81',  'province_id' => '9',  'type' => 'Kabupaten', 'city_name' => 'Bogor',           'postal_code' => '16911'],
                ['city_id' => '115', 'province_id' => '9',  'type' => 'Kota',      'city_name' => 'Cimahi',          'postal_code' => '40512'],
                ['city_id' => '105', 'province_id' => '9',  'type' => 'Kota',      'city_name' => 'Cirebon',         'postal_code' => '45111'],
                ['city_id' => '103', 'province_id' => '9',  'type' => 'Kota',      'city_name' => 'Depok',           'postal_code' => '16416'],
                ['city_id' => '423', 'province_id' => '9',  'type' => 'Kota',      'city_name' => 'Sukabumi',        'postal_code' => '43111'],
                ['city_id' => '470', 'province_id' => '9',  'type' => 'Kota',      'city_name' => 'Tasikmalaya',     'postal_code' => '46411'],
            ],
            // Jawa Tengah
            '10' => [
                ['city_id' => '399', 'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Semarang',  'postal_code' => '50135'],
                ['city_id' => '457', 'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Solo (Surakarta)', 'postal_code' => '57113'],
                ['city_id' => '253', 'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Magelang',  'postal_code' => '56133'],
                ['city_id' => '343', 'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Pekalongan','postal_code' => '51122'],
                ['city_id' => '430', 'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Tegal',     'postal_code' => '52114'],
                ['city_id' => '398', 'province_id' => '10', 'type' => 'Kota',      'city_name' => 'Salatiga',  'postal_code' => '50711'],
            ],
            // DI Yogyakarta
            '5'  => [
                ['city_id' => '501', 'province_id' => '5',  'type' => 'Kota',      'city_name' => 'Yogyakarta',  'postal_code' => '55111'],
                ['city_id' => '419', 'province_id' => '5',  'type' => 'Kabupaten', 'city_name' => 'Sleman',      'postal_code' => '55513'],
                ['city_id' => '39',  'province_id' => '5',  'type' => 'Kabupaten', 'city_name' => 'Bantul',      'postal_code' => '55715'],
            ],
            // Jawa Timur
            '11' => [
                ['city_id' => '444', 'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Surabaya',  'postal_code' => '60119'],
                ['city_id' => '256', 'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Malang',    'postal_code' => '65112'],
                ['city_id' => '255', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Malang',    'postal_code' => '65163'],
                ['city_id' => '174', 'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Kediri',    'postal_code' => '64125'],
                ['city_id' => '266', 'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Mojokerto', 'postal_code' => '61321'],
                ['city_id' => '317', 'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Pasuruan',  'postal_code' => '67118'],
                ['city_id' => '376', 'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Probolinggo','postal_code' => '67213'],
                ['city_id' => '142', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Gresik',    'postal_code' => '61115'],
                ['city_id' => '409', 'province_id' => '11', 'type' => 'Kabupaten', 'city_name' => 'Sidoarjo',  'postal_code' => '61219'],
                ['city_id' => '215', 'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Madiun',    'postal_code' => '63122'],
                ['city_id' => '40',  'province_id' => '11', 'type' => 'Kota',      'city_name' => 'Batu',      'postal_code' => '65311'],
            ],
            // Bali
            '1'  => [
                ['city_id' => '114', 'province_id' => '1',  'type' => 'Kota',      'city_name' => 'Denpasar', 'postal_code' => '80227'],
                ['city_id' => '17',  'province_id' => '1',  'type' => 'Kabupaten', 'city_name' => 'Badung',   'postal_code' => '80351'],
                ['city_id' => '143', 'province_id' => '1',  'type' => 'Kabupaten', 'city_name' => 'Gianyar',  'postal_code' => '80511'],
            ],
            // NTB
            '22' => [
                ['city_id' => '276', 'province_id' => '22', 'type' => 'Kota',      'city_name' => 'Mataram', 'postal_code' => '83239'],
                ['city_id' => '67',  'province_id' => '22', 'type' => 'Kota',      'city_name' => 'Bima',    'postal_code' => '84111'],
            ],
            // NTT
            '23' => [
                ['city_id' => '174', 'province_id' => '23', 'type' => 'Kota', 'city_name' => 'Kupang', 'postal_code' => '85111'],
            ],
            // Kalbar
            '12' => [
                ['city_id' => '361', 'province_id' => '12', 'type' => 'Kota', 'city_name' => 'Pontianak',  'postal_code' => '78112'],
                ['city_id' => '419', 'province_id' => '12', 'type' => 'Kota', 'city_name' => 'Singkawang', 'postal_code' => '79112'],
            ],
            // Kalteng
            '13' => [
                ['city_id' => '344', 'province_id' => '13', 'type' => 'Kota', 'city_name' => 'Palangka Raya', 'postal_code' => '73111'],
            ],
            // Kalsel
            '14' => [
                ['city_id' => '13',  'province_id' => '14', 'type' => 'Kota', 'city_name' => 'Banjarmasin', 'postal_code' => '70117'],
                ['city_id' => '12',  'province_id' => '14', 'type' => 'Kota', 'city_name' => 'Banjarbaru',  'postal_code' => '70711'],
            ],
            // Kaltim
            '15' => [
                ['city_id' => '15',  'province_id' => '15', 'type' => 'Kota', 'city_name' => 'Balikpapan', 'postal_code' => '76111'],
                ['city_id' => '386', 'province_id' => '15', 'type' => 'Kota', 'city_name' => 'Samarinda',  'postal_code' => '75112'],
                ['city_id' => '69',  'province_id' => '15', 'type' => 'Kota', 'city_name' => 'Bontang',    'postal_code' => '75321'],
            ],
            // Kaltara
            '35' => [
                ['city_id' => '450', 'province_id' => '35', 'type' => 'Kota', 'city_name' => 'Tarakan', 'postal_code' => '77111'],
            ],
            // Sulut
            '31' => [
                ['city_id' => '263', 'province_id' => '31', 'type' => 'Kota', 'city_name' => 'Manado', 'postal_code' => '95247'],
                ['city_id' => '53',  'province_id' => '31', 'type' => 'Kota', 'city_name' => 'Bitung', 'postal_code' => '95511'],
            ],
            // Gorontalo
            '34' => [
                ['city_id' => '146', 'province_id' => '34', 'type' => 'Kota', 'city_name' => 'Gorontalo', 'postal_code' => '96115'],
            ],
            // Sulteng
            '29' => [
                ['city_id' => '321', 'province_id' => '29', 'type' => 'Kota', 'city_name' => 'Palu', 'postal_code' => '94111'],
            ],
            // Sulsel
            '28' => [
                ['city_id' => '254', 'province_id' => '28', 'type' => 'Kota', 'city_name' => 'Makassar',  'postal_code' => '90111'],
                ['city_id' => '331', 'province_id' => '28', 'type' => 'Kota', 'city_name' => 'Parepare',  'postal_code' => '91123'],
            ],
            // Sultra
            '30' => [
                ['city_id' => '177', 'province_id' => '30', 'type' => 'Kota', 'city_name' => 'Kendari', 'postal_code' => '93111'],
                ['city_id' => '37',  'province_id' => '30', 'type' => 'Kota', 'city_name' => 'Bau-Bau', 'postal_code' => '93717'],
            ],
            // Sulbar
            '27' => [
                ['city_id' => '249', 'province_id' => '27', 'type' => 'Kabupaten', 'city_name' => 'Mamuju', 'postal_code' => '91511'],
            ],
            // Maluku
            '20' => [
                ['city_id' => '11', 'province_id' => '20', 'type' => 'Kota', 'city_name' => 'Ambon', 'postal_code' => '97114'],
            ],
            // Maluku Utara
            '17b' => [
                ['city_id' => '457', 'province_id' => '17', 'type' => 'Kota', 'city_name' => 'Ternate', 'postal_code' => '97714'],
                ['city_id' => '459', 'province_id' => '17', 'type' => 'Kota', 'city_name' => 'Tidore Kepulauan', 'postal_code' => '97813'],
            ],
            // Papua
            '25' => [
                ['city_id' => '161', 'province_id' => '25', 'type' => 'Kota', 'city_name' => 'Jayapura', 'postal_code' => '99111'],
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
