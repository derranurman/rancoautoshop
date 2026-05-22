<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderTrackingEvent;
use App\Models\Product;
use App\Models\Voucher;
use App\Services\MidtransService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $orders = Order::where('user_id', $request->user()->id)
            ->with('items')
            ->latest()
            ->paginate(15);

        return response()->json($orders);
    }

    public function show(Request $request, string $orderNumber): JsonResponse
    {
        $order = Order::where('order_number', $orderNumber)
            ->where('user_id', $request->user()->id)
            ->with(['items', 'trackingEvents'])
            ->firstOrFail();
        return response()->json(['data' => $order]);
    }

    /**
     * Create order from current user's cart + snap token for payment.
     */
    public function checkout(Request $request, MidtransService $mt): JsonResponse
    {
        $data = $request->validate([
            'recipient_name'   => ['required', 'string', 'max:120'],
            'recipient_phone'  => ['required', 'string', 'max:20'],
            'shipping_address' => ['required', 'string'],
            'courier'          => ['required', 'string', 'in:jne,pos,tiki'],
            'courier_service'  => ['required', 'string'],
            'shipping_cost'    => ['required', 'integer', 'min:0'],
            'voucher_code'     => ['nullable', 'string', 'max:40'],
        ]);

        $user = $request->user();
        $cart = Cart::where('user_id', $user->id)->with('items.product')->first();
        abort_if(! $cart || $cart->items->isEmpty(), 422, 'Keranjang kosong.');

        return DB::transaction(function () use ($user, $cart, $data, $mt) {
            $subtotal   = 0;
            $opCost     = 0;
            $itemsData  = [];

            foreach ($cart->items as $ci) {
                /** @var Product $p */
                $p = $ci->product;
                abort_if(! $p || ! $p->is_active, 422, 'Produk tidak tersedia.');
                abort_if($ci->quantity > $p->stock, 422, "Stok {$p->name} kurang.");

                $lineSub = ($p->price + $p->operational_cost) * $ci->quantity;
                $subtotal += $p->price * $ci->quantity;
                $opCost   += $p->operational_cost * $ci->quantity;

                $itemsData[] = [
                    'product_id' => $p->id,
                    'product_name' => $p->name,
                    'price_snapshot' => $p->price,
                    'operational_cost_snapshot' => $p->operational_cost,
                    'quantity' => $ci->quantity,
                    'subtotal' => $lineSub,
                ];
            }

            // Apply voucher
            $discount = 0;
            $voucher  = null;
            if (! empty($data['voucher_code'])) {
                $voucher = Voucher::where('code', $data['voucher_code'])->first();
                if ($voucher && $voucher->isUsable($subtotal + $opCost)) {
                    $discount = $voucher->computeDiscount($subtotal + $opCost);
                }
            }

            $shipping = (int) $data['shipping_cost'];
            $total    = max(0, $subtotal + $opCost - $discount + $shipping);

            $order = Order::create([
                'order_number'      => 'RANCO-'.strtoupper(Str::random(10)),
                'user_id'           => $user->id,
                'status'            => Order::STATUS_PENDING,
                'subtotal'          => $subtotal,
                'operational_cost'  => $opCost,
                'shipping_cost'     => $shipping,
                'discount'          => $discount,
                'total'             => $total,
                'voucher_code'      => $voucher?->code,
                'courier'           => $data['courier'],
                'courier_service'   => $data['courier_service'],
                'recipient_name'    => $data['recipient_name'],
                'recipient_phone'   => $data['recipient_phone'],
                'shipping_address'  => $data['shipping_address'],
                'midtrans_order_id' => null, // set after snap
            ]);

            foreach ($itemsData as $d) {
                $d['order_id'] = $order->id;
                OrderItem::create($d);
            }

            // Decrement stock
            foreach ($cart->items as $ci) {
                $ci->product->decrement('stock', $ci->quantity);
            }

            if ($voucher) $voucher->increment('used_count');

            // Clear cart
            $cart->items()->delete();

            $snap = $mt->createSnapToken($order->load('items', 'user'));
            $order->update([
                'midtrans_snap_token' => $snap['token'] ?? null,
                'midtrans_order_id'   => $order->order_number,
            ]);

            // Initial tracking event
            $order->addTrackingEvent(
                Order::STATUS_PENDING,
                'Pesanan dibuat. Menunggu pembayaran melalui Midtrans.',
                OrderTrackingEvent::SOURCE_SYSTEM,
            );

            return response()->json([
                'order'        => $order->fresh(['items', 'trackingEvents']),
                'snap_token'   => $snap['token'] ?? null,
                'redirect_url' => $snap['redirect_url'] ?? null,
                'mock'         => $snap['mock'] ?? false,
            ], 201);
        });
    }

    public function cancel(Request $request, string $orderNumber): JsonResponse
    {
        $order = Order::where('order_number', $orderNumber)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        abort_if($order->status !== Order::STATUS_PENDING, 422, 'Pesanan tidak bisa dibatalkan.');

        DB::transaction(function () use ($order) {
            // Return stock
            foreach ($order->items as $item) {
                if ($item->product_id) {
                    Product::where('id', $item->product_id)->increment('stock', $item->quantity);
                }
            }
            $order->update(['status' => Order::STATUS_CANCELLED]);
            $order->addTrackingEvent(
                Order::STATUS_CANCELLED,
                'Pesanan dibatalkan oleh pelanggan.',
                OrderTrackingEvent::SOURCE_CUSTOMER,
            );
        });

        return response()->json(['data' => $order->fresh(['items', 'trackingEvents'])]);
    }

    /**
     * Re-issue (or return existing) Midtrans Snap token so the customer can
     * resume payment from the order detail page if they closed the popup or
     * came back later. Only works while the order is still pending.
     */
    public function repay(Request $request, string $orderNumber, MidtransService $mt): JsonResponse
    {
        $order = Order::where('order_number', $orderNumber)
            ->where('user_id', $request->user()->id)
            ->with(['items', 'user'])
            ->firstOrFail();

        abort_if($order->status !== Order::STATUS_PENDING, 422, 'Pesanan ini tidak bisa dibayar lagi.');

        // Always request a fresh token; old ones may have expired (Snap tokens
        // last ~24h on sandbox). The Midtrans service handles the dev mock.
        $snap = $mt->createSnapToken($order);
        $order->update([
            'midtrans_snap_token' => $snap['token'] ?? null,
            'midtrans_order_id'   => $order->order_number,
        ]);

        return response()->json([
            'order'        => $order->fresh(['items', 'trackingEvents']),
            'snap_token'   => $snap['token'] ?? null,
            'redirect_url' => $snap['redirect_url'] ?? null,
            'mock'         => $snap['mock'] ?? false,
            'client_key'   => config('services.midtrans.client_key'),
            'snap_url'     => config('services.midtrans.snap_url'),
        ]);
    }

    /**
     * Pull the latest payment status straight from Midtrans (no webhook needed).
     * This is what we call from the frontend right after Snap returns success,
     * and also from the order detail page on mount + polling while pending —
     * so during local development (where Midtrans cannot reach localhost
     * webhook) the order still flips to PAID immediately after the customer
     * actually pays.
     */
    public function syncStatus(Request $request, string $orderNumber, MidtransService $mt): JsonResponse
    {
        $order = Order::where('order_number', $orderNumber)
            ->where('user_id', $request->user()->id)
            ->with(['items', 'trackingEvents'])
            ->firstOrFail();

        // Only sync while still pending; once final, just return the order.
        if ($order->status !== Order::STATUS_PENDING) {
            return response()->json([
                'data'            => $order,
                'midtrans_status' => null,
                'changed'         => false,
            ]);
        }

        $resp = $mt->fetchStatus($order->midtrans_order_id ?: $order->order_number);
        $status = $resp['transaction_status'] ?? null;
        $fraud  = $resp['fraud_status'] ?? null;
        $changed = false;

        if (in_array($status, ['capture', 'settlement'], true) && $fraud !== 'deny') {
            $order->update([
                'status'  => Order::STATUS_PAID,
                'paid_at' => now(),
            ]);
            $order->addTrackingEvent(
                Order::STATUS_PAID,
                'Pembayaran dikonfirmasi via Midtrans (' . ($resp['payment_type'] ?? 'unknown') . ').',
                OrderTrackingEvent::SOURCE_WEBHOOK,
            );
            $changed = true;
        } elseif (in_array($status, ['cancel', 'expire', 'deny'], true)) {
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
            $changed = true;
        }

        return response()->json([
            'data'            => $order->fresh(['items', 'trackingEvents']),
            'midtrans_status' => $status,
            'changed'         => $changed,
        ]);
    }
}
