<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OrderAdminController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Order::query()->with(['user:id,name,email,phone', 'items']);

        if ($s = $request->string('search')->trim()->value()) {
            $q->where(fn ($qq) => $qq->where('order_number', 'like', "%{$s}%")
                ->orWhere('recipient_name', 'like', "%{$s}%")
                ->orWhere('tracking_number', 'like', "%{$s}%"));
        }
        if ($status = $request->string('status')->value()) {
            $q->where('status', $status);
        }
        return response()->json($q->latest()->paginate($request->integer('per_page', 20)));
    }

    public function show(Order $order): JsonResponse
    {
        return response()->json(['data' => $order->load(['user', 'items.product'])]);
    }

    public function updateStatus(Request $request, Order $order): JsonResponse
    {
        $data = $request->validate([
            'status'          => ['required', Rule::in([
                Order::STATUS_PAID, Order::STATUS_PACKED, Order::STATUS_SHIPPED,
                Order::STATUS_DELIVERED, Order::STATUS_CANCELLED,
            ])],
            'tracking_number' => ['nullable', 'string', 'max:60'],
        ]);

        $patch = ['status' => $data['status']];
        if (isset($data['tracking_number'])) {
            $patch['tracking_number'] = $data['tracking_number'];
        }
        if ($data['status'] === Order::STATUS_PAID && ! $order->paid_at) {
            $patch['paid_at'] = now();
        }
        $order->update($patch);
        return response()->json(['data' => $order->fresh('items')]);
    }
}
