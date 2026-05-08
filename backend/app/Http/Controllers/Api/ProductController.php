<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    /** Public catalog listing with filter & search. */
    public function index(Request $request): JsonResponse
    {
        $q = Product::query()
            ->where('is_active', true)
            ->with('category:id,name,slug');

        if ($search = $request->string('search')->trim()->value()) {
            $q->where('name', 'like', "%{$search}%");
        }
        if ($categorySlug = $request->string('category')->trim()->value()) {
            $q->whereHas('category', fn ($c) => $c->where('slug', $categorySlug));
        }
        if ($request->filled('min_price')) $q->where('price', '>=', (int) $request->input('min_price'));
        if ($request->filled('max_price')) $q->where('price', '<=', (int) $request->input('max_price'));

        $sort = $request->input('sort', 'newest');
        match ($sort) {
            'price_asc'  => $q->orderBy('price', 'asc'),
            'price_desc' => $q->orderBy('price', 'desc'),
            'name'       => $q->orderBy('name'),
            default      => $q->latest(),
        };

        return response()->json(
            $q->paginate($request->integer('per_page', 12))
                ->through(fn (Product $p) => $this->transform($p))
        );
    }

    /** Public product detail by slug. */
    public function show(string $slug): JsonResponse
    {
        $product = Product::where('slug', $slug)->where('is_active', true)
            ->with('category:id,name,slug')->firstOrFail();
        return response()->json(['data' => $this->transform($product, withDescription: true)]);
    }

    protected function transform(Product $p, bool $withDescription = false): array
    {
        $out = [
            'id'               => $p->id,
            'slug'             => $p->slug,
            'name'             => $p->name,
            'price'            => $p->price,
            'operational_cost' => $p->operational_cost,
            'selling_price'    => $p->selling_price, // harga yang ditampilkan (price + operational)
            'stock'            => $p->stock,
            'weight'           => $p->weight,
            'images'           => $p->images ?: [],
            'category'         => $p->category ? ['id' => $p->category->id, 'name' => $p->category->name, 'slug' => $p->category->slug] : null,
        ];
        if ($withDescription) {
            $out['description'] = $p->description;
        }
        return $out;
    }
}
