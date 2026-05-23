<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderTrackingEvent;
use App\Services\MidtransService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class PaymentController extends Controller
{
    /**
     * Midtrans server → our server notification webhook.
     * Configure this URL in Midtrans dashboard as Payment Notification URL.
     */
    public function midtransNotification(Request $request, MidtransService $mt): JsonResponse
    {
        $payload = $request->all();
        Log::info('[midtrans] notification', $payload);

        if (! $mt->verifySignature($payload)) {
            return response()->json(['message' => 'invalid signature'], 403);
        }

        $orderNumber = $payload['order_id'] ?? null;
        $status      = $payload['transaction_status'] ?? null;
        $fraud       = $payload['fraud_status'] ?? null;

        // Match by the Midtrans-side reference first (which we rotate on each
        // retry, e.g. "RANCO-ABCDE12345-RXYZ1"), then fall back to the
        // canonical order_number — and finally strip any "-R...." retry
        // suffix so a webhook arriving for an older Snap session still
        // resolves to the right order.
        $order = Order::where('midtrans_order_id', $orderNumber)
            ->orWhere('order_number', $orderNumber)
            ->first();

        if (! $order && is_string($orderNumber)) {
            $stripped = preg_replace('/-R[A-Z0-9]+$/i', '', $orderNumber);
            if ($stripped !== $orderNumber) {
                $order = Order::where('order_number', $stripped)->first();
            }
        }

        if (! $order) {
            return response()->json(['message' => 'order not found'], 404);
        }

        // Map Midtrans status → internal status
        if (in_array($status, ['capture', 'settlement']) && $fraud !== 'deny') {
            if ($order->status === Order::STATUS_PENDING) {
                $order->update([
                    'status'  => Order::STATUS_PAID,
                    'paid_at' => now(),
                ]);
                $order->addTrackingEvent(
                    Order::STATUS_PAID,
                    'Pembayaran diterima via Midtrans.',
                    OrderTrackingEvent::SOURCE_WEBHOOK,
                );
            }
        } elseif (in_array($status, ['cancel', 'expire', 'deny'])) {
            if ($order->status === Order::STATUS_PENDING) {
                $order->update(['status' => Order::STATUS_CANCELLED]);
                $reason = match ($status) {
                    'expire' => 'Pembayaran kedaluwarsa.',
                    'deny'   => 'Pembayaran ditolak oleh penyedia pembayaran.',
                    default  => 'Transaksi dibatalkan di sisi pembayaran.',
                };
                $order->addTrackingEvent(
                    Order::STATUS_CANCELLED,
                    $reason,
                    OrderTrackingEvent::SOURCE_WEBHOOK,
                );
            }
        }

        return response()->json(['message' => 'ok']);
    }
}
