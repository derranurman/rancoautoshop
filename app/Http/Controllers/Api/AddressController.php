<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Address;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AddressController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $request->user()->addresses()->orderByDesc('is_default')->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'label'          => ['nullable', 'string', 'max:60'],
            'recipient_name' => ['required', 'string', 'max:120'],
            'phone'          => ['required', 'string', 'max:20'],
            'province'       => ['required', 'string'],
            'city'           => ['required', 'string'],
            'city_id'        => ['nullable', 'string'],
            'subdistrict'    => ['nullable', 'string', 'max:120'],
            'subdistrict_id' => ['nullable', 'string', 'max:40'],
            'postal_code'    => ['nullable', 'string'],
            'address_line'   => ['required', 'string'],
            'is_default'     => ['boolean'],
        ]);

        if (! empty($data['is_default'])) {
            $request->user()->addresses()->update(['is_default' => false]);
        }

        $addr = $request->user()->addresses()->create($data);
        return response()->json(['data' => $addr], 201);
    }

    public function update(Request $request, Address $address): JsonResponse
    {
        abort_unless($address->user_id === $request->user()->id, 403);

        $data = $request->validate([
            'label'          => ['nullable', 'string', 'max:60'],
            'recipient_name' => ['sometimes', 'string', 'max:120'],
            'phone'          => ['sometimes', 'string', 'max:20'],
            'province'       => ['sometimes', 'string'],
            'city'           => ['sometimes', 'string'],
            'city_id'        => ['nullable', 'string'],
            'subdistrict'    => ['nullable', 'string', 'max:120'],
            'subdistrict_id' => ['nullable', 'string', 'max:40'],
            'postal_code'    => ['nullable', 'string'],
            'address_line'   => ['sometimes', 'string'],
            'is_default'     => ['boolean'],
        ]);

        if (! empty($data['is_default'])) {
            $request->user()->addresses()->update(['is_default' => false]);
        }
        $address->update($data);
        return response()->json(['data' => $address]);
    }

    public function destroy(Request $request, Address $address): JsonResponse
    {
        abort_unless($address->user_id === $request->user()->id, 403);
        $address->delete();
        return response()->json(['message' => 'deleted']);
    }
}
