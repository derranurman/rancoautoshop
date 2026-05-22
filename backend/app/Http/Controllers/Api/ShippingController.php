<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\RajaOngkirService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShippingController extends Controller
{
    public function provinces(RajaOngkirService $ro): JsonResponse
    {
        return response()->json(['data' => $ro->provinces()]);
    }

    public function cities(Request $request, RajaOngkirService $ro): JsonResponse
    {
        $provinceId = $request->query('province_id');
        return response()->json(['data' => $ro->cities($provinceId)]);
    }

    public function cost(Request $request, RajaOngkirService $ro): JsonResponse
    {
        $data = $request->validate([
            'destination' => ['required', 'string'],
            'weight'      => ['required', 'integer', 'min:1'],
            'courier'     => ['required', 'string', 'in:jne,jnt,pos,tiki'],
        ]);

        return response()->json(['data' => $ro->cost($data['destination'], $data['weight'], $data['courier'])]);
    }
}
