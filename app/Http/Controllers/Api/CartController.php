<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\CartItem;
use App\Models\Product;
use App\Models\ProductVariant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CartController extends Controller
{
    protected function cartOf(Request $request): Cart
    {
        return Cart::firstOrCreate(['user_id' => $request->user()->id]);
    }

    public function show(Request $request): JsonResponse
    {
        $cart = $this->cartOf($request)->load('items.product', 'items.variant');
        return response()->json($this->serialize($cart));
    }

    public function add(Request $request): JsonResponse
    {
        $data = $request->validate([
            'product_id' => ['required', 'integer', 'exists:products,id'],
            'variant_id' => ['nullable', 'integer', 'exists:product_variants,id'],
            'quantity'   => ['required', 'integer', 'min:1', 'max:99'],
        ]);

        /** @var Product $product */
        $product = Product::with('variants')->findOrFail($data['product_id']);
        abort_unless($product->is_active, 404);

        // Resolve varian (kalau diminta) dan tegakkan invariannya:
        //   - Kalau produk punya varian aktif, customer WAJIB memilih varian.
        //   - Kalau produk tanpa varian, customer TIDAK boleh kirim variant_id.
        $variant = null;
        $hasActiveVariants = $product->variants->where('is_active', true)->isNotEmpty();
        if (! empty($data['variant_id'])) {
            /** @var ProductVariant|null $variant */
            $variant = $product->variants->firstWhere('id', $data['variant_id']);
            abort_if(! $variant || ! $variant->is_active, 422, 'Varian tidak tersedia.');
        } elseif ($hasActiveVariants) {
            abort(422, 'Produk ini punya beberapa varian — silakan pilih dulu.');
        }

        $availableStock = $variant ? (int) $variant->stock : (int) $product->stock;

        $cart = $this->cartOf($request);

        $item = CartItem::firstOrNew([
            'cart_id'    => $cart->id,
            'product_id' => $product->id,
            'variant_id' => $variant?->id,
        ]);
        $newQty = ($item->quantity ?? 0) + $data['quantity'];
        abort_if($newQty > $availableStock, 422, "Stok hanya {$availableStock}");
        $item->quantity = $newQty;
        $item->save();

        return response()->json($this->serialize($cart->load('items.product', 'items.variant')));
    }

    public function updateItem(Request $request, CartItem $item): JsonResponse
    {
        abort_unless($item->cart->user_id === $request->user()->id, 403);
        $data = $request->validate(['quantity' => ['required', 'integer', 'min:1', 'max:99']]);

        $stock = $item->variant_id && $item->variant
            ? (int) $item->variant->stock
            : (int) ($item->product->stock ?? 0);
        abort_if($data['quantity'] > $stock, 422, "Stok hanya {$stock}");
        $item->update(['quantity' => $data['quantity']]);

        return response()->json($this->serialize($item->cart->load('items.product', 'items.variant')));
    }

    public function removeItem(Request $request, CartItem $item): JsonResponse
    {
        abort_unless($item->cart->user_id === $request->user()->id, 403);
        $cart = $item->cart;
        $item->delete();
        return response()->json($this->serialize($cart->load('items.product', 'items.variant')));
    }

    public function clear(Request $request): JsonResponse
    {
        $cart = $this->cartOf($request);
        $cart->items()->delete();
        return response()->json($this->serialize($cart->load('items.product', 'items.variant')));
    }

    protected function serialize(Cart $cart): array
    {
        $items = $cart->items->map(function (CartItem $i) {
            $p = $i->product;
            $v = $i->variant;
            // Harga unit: kalau ada varian, pakai varian (override or fallback) +
            // operational_cost produk. Tanpa varian: kolom produk seperti biasa.
            $basePrice = $v
                ? (int) ($v->price_override ?? ($p?->price ?? 0))
                : (int) ($p?->price ?? 0);
            $opCost = (int) ($p?->operational_cost ?? 0);
            $unit = $basePrice + $opCost;

            $weight = $v
                ? (int) ($v->weight_override ?? ($p?->weight ?? 0))
                : (int) ($p?->weight ?? 0);

            $stock = $v ? (int) $v->stock : (int) ($p?->stock ?? 0);

            return [
                'id'             => $i->id,
                'product_id'     => $i->product_id,
                'variant_id'     => $i->variant_id,
                'name'           => $p?->name,
                'slug'           => $p?->slug,
                'image'          => $v?->image ?: ($p?->images[0] ?? null),
                'price'          => $basePrice,
                'operational_cost' => $opCost,
                'selling_price'  => $unit,
                'quantity'       => $i->quantity,
                'subtotal'       => $unit * $i->quantity,
                'stock'          => $stock,
                'weight'         => $weight,
                'variant_name'   => $v?->name,
                'variant_sku'    => $v?->sku,
            ];
        });

        $subtotal = (int) $items->sum('subtotal');
        $totalWeight = (int) $items->sum('weight') > 0
            ? (int) $cart->items->sum(function (CartItem $i) {
                $w = $i->variant_id && $i->variant
                    ? (int) ($i->variant->weight_override ?? ($i->product?->weight ?? 0))
                    : (int) ($i->product?->weight ?? 0);
                return $w * $i->quantity;
            })
            : 0;

        return [
            'id'           => $cart->id,
            'items'        => $items,
            'total_items'  => (int) $items->sum('quantity'),
            'subtotal'     => $subtotal,
            'total_weight' => $totalWeight,
        ];
    }
}
