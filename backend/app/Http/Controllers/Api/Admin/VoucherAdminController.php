<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class VoucherAdminController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['data' => Voucher::latest()->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        return response()->json(['data' => Voucher::create($data)], 201);
    }

    public function update(Request $request, Voucher $voucher): JsonResponse
    {
        $data = $this->validated($request, $voucher->id);
        $voucher->update($data);
        return response()->json(['data' => $voucher]);
    }

    public function destroy(Voucher $voucher): JsonResponse
    {
        $voucher->delete();
        return response()->json(['message' => 'deleted']);
    }

    protected function validated(Request $request, ?int $ignoreId = null): array
    {
        return $request->validate([
            'code'         => ['required', 'string', 'max:40', Rule::unique('vouchers', 'code')->ignore($ignoreId)],
            'type'         => ['required', Rule::in([Voucher::TYPE_PERCENT, Voucher::TYPE_FIXED])],
            'value'        => ['required', 'integer', 'min:1'],
            'min_purchase' => ['nullable', 'integer', 'min:0'],
            'max_discount' => ['nullable', 'integer', 'min:0'],
            'usage_limit'  => ['nullable', 'integer', 'min:1'],
            'starts_at'    => ['nullable', 'date'],
            'ends_at'      => ['nullable', 'date', 'after_or_equal:starts_at'],
            'is_active'    => ['boolean'],
        ]);
    }
}
