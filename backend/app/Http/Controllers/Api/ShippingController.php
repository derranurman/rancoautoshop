<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\KomerceShippingService;
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

    /**
     * GET /admin/shipping/search-destination?q=<query>&limit=<n>
     *
     * Admin-only helper used during initial Komerce onboarding to discover
     * the numeric destination_id that should be pasted into the
     * `KOMERCE_ORIGIN_DESTINATION_ID` env var. Hits Komerce's destination
     * search endpoint and returns the raw rows. Each call burns one quota
     * hit, so we cap `limit` and intentionally don't expose this to the
     * storefront — checkout uses the curated mock dropdowns instead.
     *
     * Returns 503 when Komerce isn't configured rather than silently
     * returning [] so misconfiguration is obvious to the operator.
     */
    public function searchDestination(Request $request, KomerceShippingService $komerce): JsonResponse
    {
        $data = $request->validate([
            'q'     => ['required', 'string', 'min:2', 'max:80'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);

        if (empty(config('services.komerce.api_key'))) {
            return response()->json([
                'message' => 'Komerce API key is not configured. Set KOMERCE_API_KEY in your .env first.',
                'data'    => [],
            ], 503);
        }

        try {
            $rows = $komerce->searchDestination($data['q'], (int) ($data['limit'] ?? 10));
        } catch (\Throwable $e) {
            Log::warning('[shipping] search-destination controller error: '.$e->getMessage());
            $rows = [];
        }

        return response()->json(['data' => $rows]);
    }
}
