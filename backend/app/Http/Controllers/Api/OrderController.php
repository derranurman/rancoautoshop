<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\OrderTrackingEvent;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SiteSetting;
use App\Models\Voucher;
use App\Services\MidtransService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
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
        return response()->json([
            'data'         => $order,
            // Sertakan info bank dari SiteSetting kalau order ini pakai transfer manual,
            // supaya frontend tidak perlu request endpoint terpisah.
            'bank_account' => $order->payment_method === Order::PAYMENT_METHOD_MANUAL_TRANSFER
                ? $this->bankInfo()
                : null,
        ]);
    }

    /**
     * Create order from current user's cart + snap token for payment.
     *
     * Two modes are supported:
     *   1. Normal cart checkout — pulls items from `Cart` and clears it on success.
     *   2. "Buy Now" checkout — caller passes `buy_now: { product_id, variant_id?, quantity }`.
     *      The cart is intentionally NOT touched.
     *
     * Payment methods:
     *   - 'midtrans' (default) → buat Snap token seperti biasa.
     *   - 'manual_transfer'    → skip Snap, kembalikan info rekening bank di response.
     *                            Customer akan upload bukti transfer dari halaman order.
     */
    public function checkout(Request $request, MidtransService $mt): JsonResponse
    {
        $data = $request->validate([
            'recipient_name'        => ['required', 'string', 'max:120'],
            'recipient_phone'       => ['required', 'string', 'max:20'],
            'shipping_address'      => ['required', 'string'],
            'courier'               => ['required', 'string', 'in:jne,jnt,pos,tiki'],
            'courier_service'       => ['required', 'string'],
            'shipping_cost'         => ['required', 'integer', 'min:0'],
            'voucher_code'          => ['nullable', 'string', 'max:40'],
            'payment_method'        => ['nullable', 'string', 'in:midtrans,manual_transfer,cod'],
            'shipping_provider'     => ['nullable', 'string', 'in:rajaongkir,biteship,manual'],
            'biteship_courier_code' => ['nullable', 'string', 'max:50'],
            'biteship_courier_service_code' => ['nullable', 'string', 'max:50'],
            'buy_now'               => ['nullable', 'array'],
            'buy_now.product_id'    => ['required_with:buy_now', 'integer'],
            'buy_now.variant_id'    => ['nullable', 'integer'],
            'buy_now.quantity'      => ['required_with:buy_now', 'integer', 'min:1'],
        ]);

        $user           = $request->user();
        $buyNow         = $data['buy_now'] ?? null;
        $paymentMethod  = $data['payment_method'] ?? Order::PAYMENT_METHOD_MIDTRANS;

        // Kalau admin belum mengaktifkan transfer manual, blokir di server.
        if ($paymentMethod === Order::PAYMENT_METHOD_MANUAL_TRANSFER) {
            $settings = SiteSetting::current();
            abort_unless(
                $settings->manual_transfer_enabled
                    && $settings->bank_account_number,
                422,
                'Pembayaran transfer manual belum diaktifkan oleh admin.'
            );
        }

        // COD: validasi sama — admin harus enable + total order harus dalam
        // rentang min/max yang diatur. Validasi nominal akan re-cek setelah
        // total dihitung di transaction (di dalamnya).
        if ($paymentMethod === Order::PAYMENT_METHOD_COD) {
            $settings = SiteSetting::current();
            abort_unless(
                $settings->cod_enabled,
                422,
                'Bayar di Tempat (COD) belum diaktifkan oleh admin.'
            );
        }

        // Build daftar (product, variant?, quantity, unit price snapshot).
        if ($buyNow) {
            /** @var Product $product */
            $product = Product::with('variants')->find($buyNow['product_id']);
            abort_if(! $product || ! $product->is_active, 422, 'Produk tidak tersedia.');

            $variant = null;
            $hasActiveVariants = $product->variants->where('is_active', true)->isNotEmpty();
            if (! empty($buyNow['variant_id'])) {
                /** @var ProductVariant|null $variant */
                $variant = $product->variants->firstWhere('id', $buyNow['variant_id']);
                abort_if(! $variant || ! $variant->is_active, 422, 'Varian tidak tersedia.');
            } elseif ($hasActiveVariants) {
                abort(422, 'Produk ini memiliki varian — silakan pilih dulu.');
            }

            $qty = (int) $buyNow['quantity'];
            $availableStock = $variant ? (int) $variant->stock : (int) $product->stock;
            abort_if($qty > $availableStock, 422, "Stok {$product->name} kurang.");

            $sources = [(object) [
                'product'  => $product,
                'variant'  => $variant,
                'quantity' => $qty,
            ]];
            $cart = null;
        } else {
            $cart = Cart::where('user_id', $user->id)
                ->with(['items.product.variants', 'items.variant'])
                ->first();
            abort_if(! $cart || $cart->items->isEmpty(), 422, 'Keranjang kosong.');
            $sources = [];
            foreach ($cart->items as $ci) {
                /** @var Product $p */
                $p = $ci->product;
                abort_if(! $p || ! $p->is_active, 422, 'Produk tidak tersedia.');
                $v = $ci->variant;
                if ($ci->variant_id) {
                    abort_if(! $v || ! $v->is_active, 422, 'Varian tidak tersedia.');
                }
                $stock = $v ? (int) $v->stock : (int) $p->stock;
                abort_if($ci->quantity > $stock, 422, "Stok {$p->name} kurang.");
                $sources[] = (object) [
                    'product'  => $p,
                    'variant'  => $v,
                    'quantity' => $ci->quantity,
                ];
            }
        }

        return DB::transaction(function () use ($user, $cart, $sources, $data, $mt, $buyNow, $paymentMethod) {
            $subtotal  = 0;
            $opCost    = 0;
            $itemsData = [];

            foreach ($sources as $s) {
                /** @var Product $p */
                $p = $s->product;
                /** @var ProductVariant|null $v */
                $v = $s->variant;

                // Harga unit produk (TANPA operational cost).
                $unitPrice = $v
                    ? (int) ($v->price_override ?? $p->price)
                    : (int) $p->price;

                $lineSub  = ($unitPrice + (int) $p->operational_cost) * $s->quantity;
                $subtotal += $unitPrice * $s->quantity;
                $opCost   += (int) $p->operational_cost * $s->quantity;

                $itemsData[] = [
                    'product_id'                => $p->id,
                    'variant_id'                => $v?->id,
                    'product_name'              => $p->name,
                    'variant_name'              => $v?->name,
                    'variant_sku'               => $v?->sku,
                    'price_snapshot'            => $unitPrice,
                    'operational_cost_snapshot' => (int) $p->operational_cost,
                    'quantity'                  => $s->quantity,
                    'subtotal'                  => $lineSub,
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

            // Untuk COD, terapkan biaya tambahan & cek rentang nominal di sini —
            // tidak bisa cek di awal karena total tergantung subtotal + ongkir.
            $codFee = 0;
            if ($paymentMethod === Order::PAYMENT_METHOD_COD) {
                $settings = SiteSetting::current();
                $codFee = (int) $settings->cod_extra_fee;
                $total += $codFee;
                if ($settings->cod_min_total > 0 && $total < (int) $settings->cod_min_total) {
                    abort(422, 'Total pesanan dibawah minimum COD: '.number_format((int) $settings->cod_min_total, 0, ',', '.'));
                }
                if ($settings->cod_max_total !== null && $settings->cod_max_total > 0 && $total > (int) $settings->cod_max_total) {
                    abort(422, 'Total pesanan melebihi maksimum COD: '.number_format((int) $settings->cod_max_total, 0, ',', '.'));
                }
            }

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
                'midtrans_order_id' => null, // set after snap (Midtrans only)
                'payment_method'    => $paymentMethod,
                'shipping_provider' => $data['shipping_provider'] ?? Order::SHIPPING_PROVIDER_RAJAONGKIR,
                'biteship_courier_code' => $data['biteship_courier_code'] ?? null,
                'biteship_courier_service_code' => $data['biteship_courier_service_code'] ?? null,
            ]);

            foreach ($itemsData as $d) {
                $d['order_id'] = $order->id;
                OrderItem::create($d);
            }

            // Decrement stock per source (varian kalau ada, kalau tidak produk).
            foreach ($sources as $s) {
                if ($s->variant) {
                    ProductVariant::where('id', $s->variant->id)->decrement('stock', $s->quantity);
                    // Mirror total stok ke produk supaya badge listing tetap akurat.
                    $newTotal = (int) ProductVariant::where('product_id', $s->product->id)
                        ->where('is_active', true)->sum('stock');
                    Product::where('id', $s->product->id)->update(['stock' => $newTotal]);
                } else {
                    Product::where('id', $s->product->id)->decrement('stock', $s->quantity);
                }
            }

            if ($voucher) $voucher->increment('used_count');

            // Only clear the cart for normal checkouts. "Beli Sekarang" must
            // leave the existing cart untouched.
            if (! $buyNow && $cart) {
                $cart->items()->delete();
            }

            // Branching pembayaran.
            $snap = null;
            if ($paymentMethod === Order::PAYMENT_METHOD_MIDTRANS) {
                $snap = $mt->createSnapToken($order->load('items', 'user'));
                $order->update([
                    'midtrans_snap_token' => $snap['token'] ?? null,
                    'midtrans_order_id'   => $order->order_number,
                ]);

                $order->addTrackingEvent(
                    Order::STATUS_PENDING,
                    'Pesanan dibuat. Menunggu pembayaran melalui Midtrans.',
                    OrderTrackingEvent::SOURCE_SYSTEM,
                );
            } elseif ($paymentMethod === Order::PAYMENT_METHOD_COD) {
                $order->addTrackingEvent(
                    Order::STATUS_PENDING,
                    'Pesanan dibuat dengan metode Bayar di Tempat (COD). '
                    . 'Menunggu admin memproses pengiriman.'
                    . ($codFee > 0 ? ' Termasuk biaya COD Rp '.number_format($codFee, 0, ',', '.').'.' : ''),
                    OrderTrackingEvent::SOURCE_SYSTEM,
                );
            } else {
                $order->addTrackingEvent(
                    Order::STATUS_PENDING,
                    'Pesanan dibuat. Silakan transfer ke rekening yang tertera lalu unggah bukti.',
                    OrderTrackingEvent::SOURCE_SYSTEM,
                );
            }

            return response()->json([
                'order'        => $order->fresh(['items', 'trackingEvents']),
                'snap_token'   => $snap['token'] ?? null,
                'redirect_url' => $snap['redirect_url'] ?? null,
                'mock'         => $snap['mock'] ?? false,
                'bank_account' => $paymentMethod === Order::PAYMENT_METHOD_MANUAL_TRANSFER
                    ? $this->bankInfo()
                    : null,
                'cod_fee'      => $codFee,
            ], 201);
        });
    }

    public function cancel(Request $request, string $orderNumber): JsonResponse
    {
        $order = Order::where('order_number', $orderNumber)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        // Customer boleh cancel saat masih pending atau setelah upload bukti tapi
        // belum diverifikasi (mungkin salah transfer).
        abort_unless(
            in_array($order->status, [Order::STATUS_PENDING, Order::STATUS_AWAITING_VERIFICATION], true),
            422,
            'Pesanan tidak bisa dibatalkan.'
        );

        DB::transaction(function () use ($order) {
            // Return stock — kalau ada variant_id, kembalikan ke varian; kalau
            // tidak ada, kembalikan ke produk seperti perilaku lama.
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
     * Upload bukti transfer manual.
     *
     * Hanya boleh saat pesanan masih `pending` ATAU `awaiting_verification`
     * (kalau admin pernah reject lalu customer mau upload ulang).
     */
    public function uploadPaymentProof(Request $request, string $orderNumber): JsonResponse
    {
        $order = Order::where('order_number', $orderNumber)
            ->where('user_id', $request->user()->id)
            ->firstOrFail();

        abort_unless(
            $order->payment_method === Order::PAYMENT_METHOD_MANUAL_TRANSFER,
            422,
            'Pesanan ini bukan pembayaran transfer manual.'
        );
        abort_unless(
            in_array($order->status, [Order::STATUS_PENDING, Order::STATUS_AWAITING_VERIFICATION], true),
            422,
            'Bukti transfer tidak bisa diunggah pada status pesanan ini.'
        );

        $request->validate([
            'image' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:4096'], // 4 MB
        ]);

        // Hapus bukti sebelumnya (kalau pernah upload tapi di-reject) supaya
        // disk tidak menumpuk file orphan.
        if ($order->payment_proof_url) {
            $oldPath = $this->relativeStoragePath($order->payment_proof_url);
            if ($oldPath) Storage::disk('public')->delete($oldPath);
        }

        $file = $request->file('image');
        $name = Str::uuid()->toString().'.'.strtolower($file->getClientOriginalExtension() ?: $file->extension());
        $path = $file->storeAs('payments', $name, 'public'); // payments/<uuid>.jpg

        $order->update([
            'status'                    => Order::STATUS_AWAITING_VERIFICATION,
            'payment_proof_url'         => '/storage/'.$path,
            'payment_proof_uploaded_at' => now(),
            'payment_rejection_reason'  => null,
        ]);

        $order->addTrackingEvent(
            Order::STATUS_AWAITING_VERIFICATION,
            'Bukti transfer diunggah pelanggan. Menunggu verifikasi admin.',
            OrderTrackingEvent::SOURCE_CUSTOMER,
        );

        return response()->json([
            'data' => $order->fresh(['items', 'trackingEvents']),
        ]);
    }

    /**
     * Re-issue (or return existing) Midtrans Snap token.
     * Hanya untuk order Midtrans yang masih pending.
     */
    public function repay(Request $request, string $orderNumber, MidtransService $mt): JsonResponse
    {
        $order = Order::where('order_number', $orderNumber)
            ->where('user_id', $request->user()->id)
            ->with(['items', 'user'])
            ->firstOrFail();

        abort_if($order->status !== Order::STATUS_PENDING, 422, 'Pesanan ini tidak bisa dibayar lagi.');
        abort_unless(
            $order->payment_method === Order::PAYMENT_METHOD_MIDTRANS,
            422,
            'Pesanan ini menggunakan transfer manual.'
        );

        // Always rotate the Midtrans order id before requesting a new token,
        // so that any prior Snap session under the old id no longer blocks us.
        $order->midtrans_order_id = $order->order_number . '-R' . strtoupper(Str::random(4));
        $order->save();

        $snap = $mt->createSnapToken($order);
        $order->update([
            'midtrans_snap_token' => $snap['token'] ?? null,
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
     * Pull the latest payment status from Midtrans. Hanya untuk order Midtrans pending.
     * Order transfer manual tidak perlu sync — verifikasi dilakukan admin.
     */
    public function syncStatus(Request $request, string $orderNumber, MidtransService $mt): JsonResponse
    {
        $order = Order::where('order_number', $orderNumber)
            ->where('user_id', $request->user()->id)
            ->with(['items', 'trackingEvents'])
            ->firstOrFail();

        if ($order->status !== Order::STATUS_PENDING
            || $order->payment_method !== Order::PAYMENT_METHOD_MIDTRANS) {
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

    /** Rangkuman info rekening untuk respons API. */
    protected function bankInfo(): array
    {
        $s = SiteSetting::current();
        return [
            'enabled'        => (bool) $s->manual_transfer_enabled,
            'bank_name'      => $s->bank_name,
            'account_number' => $s->bank_account_number,
            'account_holder' => $s->bank_account_holder,
            'branch'         => $s->bank_branch,
            'note'           => $s->bank_extra_note,
        ];
    }

    /** Konversi URL `/storage/...` → path relatif disk public. */
    protected function relativeStoragePath(?string $url): ?string
    {
        if (! $url) return null;
        $appUrl = rtrim((string) config('app.url'), '/');
        if ($appUrl && str_starts_with($url, $appUrl)) {
            $url = substr($url, strlen($appUrl));
        }
        if (str_starts_with($url, '/storage/')) {
            return substr($url, strlen('/storage/'));
        }
        return null;
    }
}
