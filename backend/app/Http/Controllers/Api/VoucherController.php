<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VoucherController extends Controller
{
    /** POST /api/vouchers/check — cek voucher untuk subtotal tertentu. */
    public function check(Request $request): JsonResponse
    {
        $data = $request->validate([
            'code'     => ['required', 'string', 'max:40'],
            'subtotal' => ['required', 'integer', 'min:0'],
        ]);

        $v = Voucher::where('code', $data['code'])->first();
        if (! $v || ! $v->isUsable($data['subtotal'])) {
            return response()->json(['valid' => false, 'message' => 'Voucher tidak berlaku.'], 200);
        }
        return response()->json([
            'valid'    => true,
            'voucher'  => $v->only(['code', 'type', 'value', 'min_purchase', 'max_discount']),
            'discount' => $v->computeDiscount($data['subtotal']),
        ]);
    }
}
