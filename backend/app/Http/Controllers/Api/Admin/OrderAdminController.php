<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderTrackingEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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

        // Filter rentang tanggal pembuatan order (admin Pesanan).
        // Memakai created_at karena admin biasanya butuh "pesanan masuk hari X
        // sampai Y", bukan kapan dibayar.
        if ($from = $request->string('date_from')->trim()->value()) {
            try {
                $q->where('created_at', '>=', \Illuminate\Support\Carbon::parse($from)->startOfDay());
            } catch (\Throwable) { /* abaikan parse gagal */ }
        }
        if ($to = $request->string('date_to')->trim()->value()) {
            try {
                $q->where('created_at', '<=', \Illuminate\Support\Carbon::parse($to)->endOfDay());
            } catch (\Throwable) { /* abaikan parse gagal */ }
        }

        // Mode export: kembalikan semua hasil yang cocok (tanpa pagination)
        // supaya tombol "Export Excel" bisa men-download seluruh data sesuai
        // filter, bukan hanya 20 baris di halaman aktif. Dibatasi 10.000 baris
        // sebagai pengaman supaya tidak menghabiskan memori PHP.
        if ($request->boolean('all')) {
            return response()->json([
                'data' => $q->latest()->limit(10000)->get(),
            ]);
        }

        return response()->json($q->latest()->paginate($request->integer('per_page', 20)));
    }

    public function show(Order $order): JsonResponse
    {
        return response()->json([
            'data' => $order->load(['user', 'items.product', 'trackingEvents']),
        ]);
    }

    public function updateStatus(Request $request, Order $order): JsonResponse
    {
        $data = $request->validate([
            'status'          => ['required', Rule::in([
                Order::STATUS_PAID, Order::STATUS_PACKED, Order::STATUS_SHIPPED,
                Order::STATUS_DELIVERED, Order::STATUS_CANCELLED,
            ])],
            'tracking_number' => ['nullable', 'string', 'max:60'],
            'note'            => ['nullable', 'string', 'max:500'],
            'location'        => ['nullable', 'string', 'max:120'],
        ]);

        DB::transaction(function () use ($order, $data) {
            $patch = ['status' => $data['status']];
            if (array_key_exists('tracking_number', $data) && $data['tracking_number'] !== null) {
                $patch['tracking_number'] = $data['tracking_number'];
            }
            if ($data['status'] === Order::STATUS_PAID && ! $order->paid_at) {
                $patch['paid_at'] = now();
            }
            $order->update($patch);

            // Build a friendly default note based on the new status.
            $note = $data['note'] ?? null;
            if (! $note) {
                $note = match ($data['status']) {
                    Order::STATUS_PAID      => 'Pembayaran dikonfirmasi oleh admin.',
                    Order::STATUS_PACKED    => 'Pesanan sedang dikemas di gudang.',
                    Order::STATUS_SHIPPED   => $order->tracking_number
                        ? "Pesanan diserahkan ke kurir ".strtoupper((string) $order->courier).". Resi: {$order->tracking_number}"
                        : 'Pesanan diserahkan ke kurir.',
                    Order::STATUS_DELIVERED => 'Pesanan telah diterima oleh pelanggan.',
                    Order::STATUS_CANCELLED => 'Pesanan dibatalkan oleh admin.',
                    default                 => null,
                };
            }

            $order->addTrackingEvent(
                $data['status'],
                $note,
                OrderTrackingEvent::SOURCE_ADMIN,
                $data['location'] ?? null,
            );
        });

        return response()->json([
            'data' => $order->fresh(['items', 'trackingEvents']),
        ]);
    }

    /**
     * Append an informational tracking event without changing the order status.
     * E.g. "Paket transit di Cikarang", "Kurir mencoba pengiriman, alamat kosong".
     */
    public function addTrackingEvent(Request $request, Order $order): JsonResponse
    {
        $data = $request->validate([
            'note'     => ['required', 'string', 'max:500'],
            'location' => ['nullable', 'string', 'max:120'],
        ]);

        $order->addTrackingEvent(
            null,
            $data['note'],
            OrderTrackingEvent::SOURCE_ADMIN,
            $data['location'] ?? null,
        );

        return response()->json([
            'data' => $order->fresh(['items', 'trackingEvents']),
        ]);
    }
}
