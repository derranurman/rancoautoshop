<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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

    /**
     * GET /shipping/subdistricts?city_id=X
     *
     * Kecamatan (subdistrict) lookup for a given RajaOngkir city. Used by
     * the address form / checkout page to render an additional dropdown
     * after the user picks a city. Empty array means we don't have
     * kecamatan data for that city — the UI falls back to city-level
     * pricing in that case (which is still correct, just less granular).
     */
    public function subdistricts(Request $request, RajaOngkirService $ro): JsonResponse
    {
        try {
            $cityId = $request->query('city_id');
            return response()->json(['data' => $ro->subdistricts($cityId)]);
        } catch (\Throwable $e) {
            Log::warning('[shipping] subdistricts controller error: '.$e->getMessage());
            return response()->json(['data' => []]);
        }
    }

    public function cost(Request $request, RajaOngkirService $ro): JsonResponse
    {
        $data = $request->validate([
            'destination'    => ['required', 'string'],
            'subdistrict_id' => ['nullable', 'string'],
            'weight'         => ['required', 'integer', 'min:1'],
            'courier'        => ['required', 'string', 'in:jne,jnt,pos,tiki'],
        ]);

        // Defensive: never let a transient upstream issue surface as 500.
        // The service already mocks on failure, but if anything else throws
        // (cache driver, etc.) we still want the UI to render an option.
        try {
            $rows = $ro->cost(
                $data['destination'],
                $data['weight'],
                $data['courier'],
                $data['subdistrict_id'] ?? null,
            );
        } catch (\Throwable $e) {
            Log::warning('[shipping] cost controller error: '.$e->getMessage());
            $rows = [];
        }

        return response()->json(['data' => $rows]);
    }
}
