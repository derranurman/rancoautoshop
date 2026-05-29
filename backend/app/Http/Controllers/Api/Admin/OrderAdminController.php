<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\OrderTrackingEvent;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Services\BiteshipService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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
            'data' => $order->load(['user', 'items.product', 'items.variant', 'trackingEvents']),
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
            // COD: pembayaran terjadi saat barang diterima customer. Begitu admin
            // menandai DELIVERED dan order ini COD belum punya paid_at, set
            // paid_at otomatis supaya laporan omset dihitung benar.
            if ($data['status'] === Order::STATUS_DELIVERED
                && $order->payment_method === Order::PAYMENT_METHOD_COD
                && ! $order->paid_at) {
                $patch['paid_at'] = now();
            }
            // Kalau admin meng-cancel order, kembalikan stok produk/varian
            // (cermin perilaku OrderController::cancel di sisi customer).
            if ($data['status'] === Order::STATUS_CANCELLED && $order->status !== Order::STATUS_CANCELLED) {
                foreach ($order->items as $item) {
                    if ($item->variant_id) {
                        ProductVariant::where('id', $item->variant_id)->increment('stock', $item->quantity);
                        if ($item->product_id) {
                            $newTotal = (int) ProductVariant::where('product_id', $item->product_id)
                                ->where('is_active', true)->sum('stock');
                            Product::where('id', $item->product_id)->update(['stock' => $newTotal]);
                        }
                    } elseif ($item->product_id) {
                        Product::where('id', $item->product_id)->increment('stock', $item->quantity);
                    }
                }
            }
            $order->update($patch);

            // Build a friendly default note based on the new status.
            $note = $data['note'] ?? null;
            if (! $note) {
                $note = match ($data['status']) {
                    Order::STATUS_PAID      => 'Pembayaran dikonfirmasi oleh admin.',
                    Order::STATUS_PACKED    => $order->payment_method === Order::PAYMENT_METHOD_COD
                        ? 'Pesanan COD sedang dikemas di gudang.'
                        : 'Pesanan sedang dikemas di gudang.',
                    Order::STATUS_SHIPPED   => $order->tracking_number
                        ? "Pesanan diserahkan ke kurir ".strtoupper((string) $order->courier).". Resi: {$order->tracking_number}"
                        : 'Pesanan diserahkan ke kurir.',
                    Order::STATUS_DELIVERED => $order->payment_method === Order::PAYMENT_METHOD_COD
                        ? 'Paket COD diterima pelanggan & pembayaran tunai diterima kurir.'
                        : 'Pesanan telah diterima oleh pelanggan.',
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
     * Approve bukti transfer manual: order pindah ke `paid` + paid_at = now.
     * Hanya valid kalau order sedang `awaiting_verification` dengan metode manual.
     */
    public function approvePayment(Request $request, Order $order): JsonResponse
    {
        abort_unless(
            $order->payment_method === Order::PAYMENT_METHOD_MANUAL_TRANSFER,
            422,
            'Pesanan ini bukan pembayaran transfer manual.'
        );
        abort_unless(
            $order->status === Order::STATUS_AWAITING_VERIFICATION,
            422,
            'Status pesanan tidak siap untuk diverifikasi.'
        );
        abort_unless($order->payment_proof_url, 422, 'Bukti transfer belum diunggah.');

        DB::transaction(function () use ($request, $order) {
            $order->update([
                'status'              => Order::STATUS_PAID,
                'paid_at'             => now(),
                'payment_verified_by' => $request->user()->id,
                'payment_verified_at' => now(),
                'payment_rejection_reason' => null,
            ]);
            $order->addTrackingEvent(
                Order::STATUS_PAID,
                'Pembayaran transfer manual diverifikasi oleh admin.',
                OrderTrackingEvent::SOURCE_ADMIN,
            );
        });

        return response()->json([
            'data' => $order->fresh(['items', 'trackingEvents']),
        ]);
    }

    /**
     * Reject bukti transfer: status balik ke `pending`, file bukti dihapus, alasan dicatat.
     * Customer akan melihat alasan + diberi kesempatan upload ulang.
     */
    public function rejectPayment(Request $request, Order $order): JsonResponse
    {
        $data = $request->validate([
            'reason' => ['required', 'string', 'max:500'],
        ]);

        abort_unless(
            $order->payment_method === Order::PAYMENT_METHOD_MANUAL_TRANSFER,
            422,
            'Pesanan ini bukan pembayaran transfer manual.'
        );
        abort_unless(
            $order->status === Order::STATUS_AWAITING_VERIFICATION,
            422,
            'Status pesanan tidak siap untuk ditolak.'
        );

        DB::transaction(function () use ($order, $data) {
            // Hapus file bukti supaya tidak menumpuk dan agar customer harus
            // mengunggah ulang.
            if ($order->payment_proof_url && str_starts_with($order->payment_proof_url, '/storage/')) {
                $rel = substr($order->payment_proof_url, strlen('/storage/'));
                try { Storage::disk('public')->delete($rel); } catch (\Throwable) {}
            }
            $order->update([
                'status'                    => Order::STATUS_PENDING,
                'payment_proof_url'         => null,
                'payment_proof_uploaded_at' => null,
                'payment_rejection_reason'  => $data['reason'],
            ]);
            $order->addTrackingEvent(
                Order::STATUS_PENDING,
                'Bukti transfer ditolak admin: '.$data['reason'],
                OrderTrackingEvent::SOURCE_ADMIN,
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

    /**
     * Buat order Biteship untuk pesanan ini → Biteship menjadwalkan pickup
     * & memberi nomor resi (waybill_id). Resi otomatis tersimpan ke
     * `tracking_number` supaya label, halaman customer, & UI lain tidak
     * perlu cabang khusus untuk Biteship.
     *
     * Hanya valid kalau:
     *   - shipping_provider = biteship
     *   - belum punya biteship_order_id (idempotent: kalau sudah ada, return existing)
     *   - status order: paid / packed (siap kirim)
     */
    public function biteshipCreate(Request $request, Order $order, BiteshipService $biteship): JsonResponse
    {
        abort_unless(
            $order->shipping_provider === Order::SHIPPING_PROVIDER_BITESHIP,
            422,
            'Pesanan ini tidak menggunakan provider Biteship.'
        );
        abort_unless(
            in_array($order->status, [Order::STATUS_PAID, Order::STATUS_PACKED], true),
            422,
            'Order Biteship hanya bisa dibuat saat status PAID atau PACKED.'
        );

        // Idempotent: kalau sudah pernah dibuat, kembalikan order existing
        // tanpa hit API lagi (admin mungkin double-click). Refresh status
        // dari Biteship supaya admin tetap lihat data terbaru.
        if ($order->biteship_order_id) {
            return $this->biteshipRefresh($order, $biteship);
        }

        $r = $biteship->createOrder($order);
        if (!empty($r['error']) || empty($r['order'])) {
            return response()->json([
                'data'  => $order->fresh(['items', 'trackingEvents']),
                'error' => $r['error'] ?? 'Gagal membuat order Biteship.',
            ], 422);
        }

        $bo = $r['order'];
        $waybill = $bo['courier']['waybill_id'] ?? null;
        $statusFromBiteship = $bo['status'] ?? 'confirmed';
        $patch = [
            'biteship_order_id' => (string) ($bo['id'] ?? ''),
            'biteship_status'   => $statusFromBiteship,
            'biteship_raw'      => $bo,
        ];
        // Kalau Biteship langsung kasih AWB (instant waybill), tulis ke
        // tracking_number agar label & halaman customer langsung pakai resi
        // asli. Untuk kurir non-instant, AWB akan masuk via webhook nanti.
        if ($waybill) {
            $patch['tracking_number'] = $waybill;
        }
        $order->update($patch);

        // Tambahkan tracking event sehingga muncul di timeline customer.
        $note = $waybill
            ? 'Pickup terjadwal via Biteship. No. resi: '.$waybill
            : 'Pickup terjadwal via Biteship. Nomor resi akan terbit setelah paket dipick-up kurir.';
        $order->addTrackingEvent(
            Order::STATUS_PACKED,
            $note,
            OrderTrackingEvent::SOURCE_SYSTEM,
        );

        return response()->json([
            'data'    => $order->fresh(['items', 'trackingEvents']),
            'biteship'=> $bo,
        ]);
    }

    /**
     * Polling tracking — admin klik refresh untuk fetch status terbaru +
     * apply ke order kita. Berguna kalau webhook tidak terkirim (network
     * issue, Biteship belum dikonfigurasi webhook secret).
     */
    public function biteshipRefresh(Order $order, BiteshipService $biteship): JsonResponse
    {
        if (!$order->biteship_order_id) {
            return response()->json([
                'data' => $order->fresh(['items', 'trackingEvents']),
                'error'=> 'Order ini belum punya biteship_order_id.',
            ], 422);
        }

        $resp = $biteship->tracking($order->biteship_order_id);
        if (!empty($resp['error'])) {
            return response()->json([
                'data' => $order->fresh(['items', 'trackingEvents']),
                'error'=> $resp['error'],
            ], 422);
        }

        $patch = ['biteship_raw' => $resp];
        $waybill = $resp['waybill_id'] ?? ($resp['courier']['waybill_id'] ?? null);
        if ($waybill && $waybill !== $order->tracking_number) {
            $patch['tracking_number'] = $waybill;
        }
        // Status terbaru — biteship `status` ada di top-level pada response trackings.
        $bs = $resp['status'] ?? ($resp['order']['status'] ?? null);
        if ($bs && $bs !== $order->biteship_status) {
            $patch['biteship_status'] = $bs;
            $internal = BiteshipService::mapBiteshipStatus($bs);
            if ($internal && $internal !== $order->status) {
                $patch['status'] = $internal;
                if ($internal === Order::STATUS_DELIVERED && !$order->paid_at && $order->payment_method === Order::PAYMENT_METHOD_COD) {
                    $patch['paid_at'] = now();
                }
            }
        }
        $order->update($patch);

        // Pull last few history events dari Biteship → tracking_events kita
        // (tetap dedup berdasarkan note untuk menghindari duplikasi saat
        // refresh berulang). History format dari Biteship: `history[]`.
        $history = $resp['history'] ?? [];
        if (is_array($history)) {
            $existingNotes = $order->trackingEvents->pluck('note')->all();
            foreach ($history as $h) {
                $note = trim((string) ($h['note'] ?? $h['status'] ?? ''));
                if ($note === '' || in_array($note, $existingNotes, true)) continue;
                $order->addTrackingEvent(
                    BiteshipService::mapBiteshipStatus((string) ($h['status'] ?? '')),
                    $note,
                    OrderTrackingEvent::SOURCE_WEBHOOK,
                    $h['service_type'] ?? null,
                );
            }
        }

        return response()->json([
            'data'     => $order->fresh(['items', 'trackingEvents']),
            'biteship' => $resp,
        ]);
    }

    /**
     * Cancel order Biteship (mis. salah pilih kurir, atau customer batalkan
     * sebelum pickup). HANYA cancel ke Biteship, tidak otomatis cancel order
     * kita — admin tetap harus klik Cancel manual kalau benar-benar mau
     * meng-cancel order beserta restock-nya.
     */
    public function biteshipCancel(Request $request, Order $order, BiteshipService $biteship): JsonResponse
    {
        $reason = (string) $request->input('reason', '');
        if (!$order->biteship_order_id) {
            return response()->json([
                'data' => $order->fresh(['items', 'trackingEvents']),
                'error'=> 'Order ini tidak terhubung Biteship.',
            ], 422);
        }
        $err = $biteship->cancelOrder($order->biteship_order_id, $reason !== '' ? $reason : null);
        if ($err) {
            return response()->json([
                'data' => $order->fresh(['items', 'trackingEvents']),
                'error'=> $err,
            ], 422);
        }
        $order->update([
            'biteship_status' => 'cancelled',
        ]);
        $order->addTrackingEvent(
            null,
            'Pickup Biteship dibatalkan oleh admin'.($reason !== '' ? ': '.$reason : '.'),
            OrderTrackingEvent::SOURCE_ADMIN,
        );
        return response()->json(['data' => $order->fresh(['items', 'trackingEvents'])]);
    }
}


