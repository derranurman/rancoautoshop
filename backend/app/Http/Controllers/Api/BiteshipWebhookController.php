<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderTrackingEvent;
use App\Services\BiteshipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Webhook receiver dari Biteship untuk update status pengiriman real-time.
 *
 * Set URL ini di Biteship dashboard → Webhooks:
 *   https://your-domain.com/api/webhooks/biteship
 *
 * Atur `BITESHIP_WEBHOOK_SECRET` di .env yang sama dengan secret di dashboard.
 * Tanpa secret, webhook akan tetap diterima (mode dev) — JANGAN production tanpa secret.
 *
 * Payload typical (Biteship docs format `order.status`):
 *   {
 *     "event": "order.status",
 *     "order_id": "5dad9e...",
 *     "waybill_id": "JX9481926078",
 *     "status": "picked",
 *     "courier_company": "jnt",
 *     "history": [...]
 *   }
 */
class BiteshipWebhookController extends Controller
{
    public function handle(Request $request, BiteshipService $biteship): JsonResponse
    {
        $raw = $request->getContent();
        $signature = $request->header('signature')
            ?? $request->header('x-biteship-signature')
            ?? $request->header('X-Biteship-Signature');

        if (! $biteship->verifyWebhookSignature($raw, $signature)) {
            Log::warning('[biteship-webhook] invalid signature');
            return response()->json(['message' => 'invalid signature'], 403);
        }

        $payload = $request->all();
        Log::info('[biteship-webhook] received', $payload);

        $biteshipOrderId = (string) ($payload['order_id'] ?? '');
        if ($biteshipOrderId === '') {
            return response()->json(['message' => 'order_id missing'], 422);
        }

        $order = Order::where('biteship_order_id', $biteshipOrderId)->first();
        if (! $order) {
            Log::warning('[biteship-webhook] unknown order', ['biteship_id' => $biteshipOrderId]);
            return response()->json(['message' => 'order not found']);
        }

        $patch = ['biteship_raw' => $payload];
        $waybill = $payload['waybill_id'] ?? ($payload['courier']['waybill_id'] ?? null);
        if ($waybill && $waybill !== $order->tracking_number) {
            $patch['tracking_number'] = $waybill;
        }
        $newStatus = (string) ($payload['status'] ?? '');
        if ($newStatus !== '') {
            $patch['biteship_status'] = $newStatus;
            $internal = BiteshipService::mapBiteshipStatus($newStatus);
            if ($internal && $internal !== $order->status) {
                $patch['status'] = $internal;
                // COD → tandai paid_at saat delivered (cermin OrderAdminController::updateStatus)
                if ($internal === Order::STATUS_DELIVERED
                    && ! $order->paid_at
                    && $order->payment_method === Order::PAYMENT_METHOD_COD) {
                    $patch['paid_at'] = now();
                }
            }
        }
        $order->update($patch);

        // Tracking event — pakai note dari payload kalau ada, kalau tidak buat
        // ringkas dari status. Source = webhook supaya frontend bisa bedakan
        // dari aksi admin manual.
        $note = trim((string) ($payload['note'] ?? ''));
        if ($note === '' && $newStatus !== '') {
            $note = match ($newStatus) {
                'pending'      => 'Pesanan menunggu konfirmasi kurir.',
                'confirmed'    => 'Pesanan dikonfirmasi kurir.',
                'allocated'    => 'Kurir ditugaskan untuk pickup.',
                'picking_up'   => 'Kurir dalam perjalanan ke lokasi pickup.',
                'picked'       => 'Paket telah diambil kurir.',
                'dropping_off' => 'Paket dalam perjalanan ke pelanggan.',
                'delivered'    => 'Paket telah diterima pelanggan.',
                'rejected'     => 'Pengiriman ditolak kurir.',
                'cancelled'    => 'Pengiriman dibatalkan.',
                'returned'     => 'Paket dikembalikan ke pengirim.',
                default        => 'Status pengiriman: '.$newStatus,
            };
        }
        if ($note !== '') {
            $existing = $order->trackingEvents->pluck('note')->all();
            if (! in_array($note, $existing, true)) {
                $order->addTrackingEvent(
                    BiteshipService::mapBiteshipStatus($newStatus),
                    $note,
                    OrderTrackingEvent::SOURCE_WEBHOOK,
                );
            }
        }

        return response()->json(['message' => 'ok']);
    }
}
