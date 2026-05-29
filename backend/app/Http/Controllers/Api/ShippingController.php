<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SiteSetting;
use App\Services\BiteshipService;
use App\Services\RajaOngkirService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ShippingController extends Controller
{
    public function provinces(RajaOngkirService $ro): JsonResponse
    {
        try {
            return response()->json(['data' => $ro->provinces()]);
        } catch (\Throwable $e) {
            Log::warning('[shipping] provinces controller error: '.$e->getMessage());
            return response()->json(['data' => []]);
        }
    }

    public function cities(Request $request, RajaOngkirService $ro): JsonResponse
    {
        try {
            $provinceId = $request->query('province_id');
            return response()->json(['data' => $ro->cities($provinceId)]);
        } catch (\Throwable $e) {
            Log::warning('[shipping] cities controller error: '.$e->getMessage());
            return response()->json(['data' => []]);
        }
    }

    public function cost(Request $request, RajaOngkirService $ro): JsonResponse
    {
        $data = $request->validate([
            'destination' => ['required', 'string'],
            'weight'      => ['required', 'integer', 'min:1'],
            'courier'     => ['required', 'string', 'in:jne,jnt,pos,tiki'],
        ]);

        // Defensive: never let a transient upstream issue surface as 500.
        // The service already mocks on failure, but if anything else throws
        // (cache driver, etc.) we still want the UI to render an option.
        try {
            $rows = $ro->cost($data['destination'], $data['weight'], $data['courier']);
        } catch (\Throwable $e) {
            Log::warning('[shipping] cost controller error: '.$e->getMessage());
            $rows = [];
        }

        return response()->json(['data' => $rows]);
    }

    /**
     * Cek tarif via Biteship — paralel dengan RajaOngkir.
     *
     * Body:
     *   destination_postal_code: int (required)
     *   items: [{ name, value, weight, quantity }]
     *   couriers: optional CSV (default: jne,jnt,sicepat,anteraja,pos,tiki,...)
     *
     * Origin postal diambil dari SiteSetting → sender_postal_code (admin
     * harus mengisi di Pengaturan Tampilan dulu).
     *
     * Response: list pricing dengan field yang sudah dikenal frontend
     * (courier, courier_service, description, cost, etd) — diadaptasi dari
     * struktur Biteship supaya komponen pemilih kurir di checkout bisa
     * bareng-bareng menampilkan tarif RajaOngkir & Biteship tanpa cabang
     * UI yang rumit.
     */
    public function biteshipRates(Request $request, BiteshipService $biteship): JsonResponse
    {
        if (! $biteship->configured()) {
            return response()->json([
                'data'   => [],
                'reason' => 'Biteship belum di-konfigurasi (BITESHIP_API_KEY kosong).',
            ]);
        }
        if (! $biteship->enabled()) {
            return response()->json([
                'data'   => [],
                'reason' => 'Biteship dinonaktifkan oleh admin di Pengaturan Tampilan.',
            ]);
        }

        $data = $request->validate([
            'destination_postal_code' => ['required', 'integer'],
            'items'                   => ['required', 'array', 'min:1'],
            'items.*.name'            => ['nullable', 'string'],
            'items.*.value'           => ['nullable', 'integer', 'min:0'],
            'items.*.weight'          => ['required', 'integer', 'min:1'],
            'items.*.quantity'        => ['required', 'integer', 'min:1'],
            'couriers'                => ['nullable', 'string'],
        ]);

        $settings = SiteSetting::current();
        if (! $settings->sender_postal_code) {
            return response()->json([
                'data'   => [],
                'reason' => 'Kode pos pengirim belum diisi. Lengkapi di Pengaturan Tampilan → Identitas Pengirim.',
            ]);
        }

        $r = $biteship->rates(
            (int) $settings->sender_postal_code,
            (int) $data['destination_postal_code'],
            $data['items'],
            $data['couriers'] ?? null,
        );

        if (! empty($r['error'])) {
            return response()->json(['data' => [], 'reason' => $r['error']]);
        }

        // Adaptasi struktur Biteship → bentuk yang sudah dipakai komponen
        // courier picker existing. `courier` / `service` di sini ASCII
        // friendly supaya bisa langsung dipakai sebagai value.
        $rows = collect($r['pricing'] ?? [])->map(fn ($p) => [
            'provider'             => 'biteship',
            'courier'              => $p['courier_code'] ?? null,
            'courier_name'         => $p['courier_name'] ?? null,
            'service'              => $p['courier_service_code'] ?? null,
            'description'          => $p['courier_service_name'] ?? '',
            'cost'                 => (int) ($p['price'] ?? 0),
            'etd'                  => (string) ($p['shipment_duration_range'] ?? $p['duration'] ?? ''),
            'available_for_cod'    => (bool) ($p['available_for_cash_on_delivery'] ?? false),
            'company'              => $p['company'] ?? null,
            'type'                 => $p['type'] ?? null,
        ])->values();

        return response()->json(['data' => $rows]);
    }
}
