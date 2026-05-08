<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Cart;
use App\Models\CartItem;
use App\Models\Product;
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
        $cart = $this->cartOf($request)->load('items.product');
        return response()->json($this->serialize($cart));
    }

    public function add(Request $request): JsonResponse
    {
        $data = $request->validate([
            'product_id' => ['required', 'integer', 'exists:products,id'],
            'quantity'   => ['required', 'integer', 'min:1', 'max:99'],
        ]);

        $product = Product::findOrFail($data['product_id']);
        abort_unless($product->is_active, 404);

        $cart = $this->cartOf($request);

        $item = CartItem::firstOrNew(['cart_id' => $cart->id, 'product_id' => $product->id]);
        $newQty = ($item->quantity ?? 0) + $data['quantity'];
        abort_if($newQty > $product->stock, 422, "Stok hanya {$product->stock}");
        $item->quantity = $newQty;
        $item->save();

        return response()->json($this->serialize($cart->load('items.product')));
    }

    public function updateItem(Request $request, CartItem $item): JsonResponse
    {
        abort_unless($item->cart->user_id === $request->user()->id, 403);
        $data = $request->validate(['quantity' => ['required', 'integer', 'min:1', 'max:99']]);

        abort_if($data['quantity'] > $item->product->stock, 422, "Stok hanya {$item->product->stock}");
        $item->update(['quantity' => $data['quantity']]);

        return response()->json($this->serialize($item->cart->load('items.product')));
    }

    public function removeItem(Request $request, CartItem $item): JsonResponse
    {
        abort_unless($item->cart->user_id === $request->user()->id, 403);
        $cart = $item->cart;
        $item->delete();
        return response()->json($this->serialize($cart->load('items.product')));
    }

    public function clear(Request $request): JsonResponse
    {
        $cart = $this->cartOf($request);
        $cart->items()->delete();
        return response()->json($this->serialize($cart->load('items.product')));
    }

    protected function serialize(Cart $cart): array
    {
        $items = $cart->items->map(function (CartItem $i) {
            $p = $i->product;
            $unit = (int) ($p?->price ?? 0) + (int) ($p?->operational_cost ?? 0);
            return [
                'id'            => $i->id,
                'product_id'    => $i->product_id,
                'name'          => $p?->name,
                'slug'          => $p?->slug,
                'image'         => $p?->images[0] ?? null,
                'price'         => (int) ($p?->price ?? 0),
                'operational_cost' => (int) ($p?->operational_cost ?? 0),
                'selling_price' => $unit,
                'quantity'      => $i->quantity,
                'subtotal'      => $unit * $i->quantity,
                'stock'         => (int) ($p?->stock ?? 0),
                'weight'        => (int) ($p?->weight ?? 0),
            ];
        });

        $subtotal = (int) $items->sum('subtotal');
        $totalWeight = (int) $cart->items->sum(fn ($i) => ($i->product?->weight ?? 0) * $i->quantity);

        return [
            'id'           => $cart->id,
            'items'        => $items,
            'total_items'  => (int) $items->sum('quantity'),
            'subtotal'     => $subtotal,
            'total_weight' => $totalWeight,
        ];
    }
}
