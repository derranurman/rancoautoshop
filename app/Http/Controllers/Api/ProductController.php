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
            ->with('category:id,name,slug', 'variants');

        if ($search = $request->string('search')->trim()->value()) {
            $this->applySearch($q, $search);
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

    /**
     * Endpoint ringan untuk autocomplete pencarian di Navbar.
     * Kembalikan max 8 hasil dengan field minimal supaya respons cepat.
     */
    public function suggest(Request $request): JsonResponse
    {
        $term = $request->string('q')->trim()->value();
        if (strlen($term) < 2) {
            return response()->json(['data' => []]);
        }

        $q = Product::query()
            ->where('is_active', true)
            ->with('category:id,name,slug');
        $this->applySearch($q, $term);

        $results = $q->limit(8)->get()->map(fn (Product $p) => [
            'id'            => $p->id,
            'slug'          => $p->slug,
            'name'          => $p->name,
            'selling_price' => $p->selling_price,
            'image'         => $p->images[0] ?? null,
            'category'      => $p->category?->name,
            'in_stock'      => (int) $p->stock > 0,
        ]);

        return response()->json(['data' => $results]);
    }

    /**
     * Apply pencarian multi-kolom: nama, deskripsi, slug, kategori, dan SKU varian.
     * Tiap kata di query dipotong & masing-masing harus muncul di salah satu kolom
     * (AND across words, OR across columns) — meniru perilaku search engine ringan
     * supaya pencarian "stir merah 14" yang nyebar di name + variant + description
     * tetap ke-match.
     */
    protected function applySearch($q, string $term): void
    {
        $words = preg_split('/\s+/', trim($term)) ?: [];
        $words = array_values(array_filter(array_unique($words), fn ($w) => $w !== ''));
        if (empty($words)) return;

        foreach ($words as $w) {
            $like = '%'.$w.'%';
            $q->where(function ($qq) use ($like) {
                $qq->where('name', 'like', $like)
                   ->orWhere('description', 'like', $like)
                   ->orWhere('slug', 'like', $like)
                   ->orWhereHas('category', fn ($c) => $c->where('name', 'like', $like))
                   ->orWhereHas('variants', fn ($v) => $v->where('name', 'like', $like)->orWhere('sku', 'like', $like));
            });
        }
    }

    /** Public product detail by slug. */
    public function show(string $slug): JsonResponse
    {
        $product = Product::where('slug', $slug)->where('is_active', true)
            ->with('category:id,name,slug', 'variants')
            ->firstOrFail();
        return response()->json(['data' => $this->transform($product, withDescription: true)]);
    }

    protected function transform(Product $p, bool $withDescription = false): array
    {
        // Hanya tampilkan varian aktif ke publik. Total stok efektif:
        // - kalau punya varian aktif → sum stok semua varian
        // - kalau tidak               → kolom stock di produk
        $activeVariants = $p->relationLoaded('variants')
            ? $p->variants->where('is_active', true)->values()
            : collect();
        $hasVariants = $activeVariants->isNotEmpty();
        $effectiveStock = $hasVariants ? (int) $activeVariants->sum('stock') : (int) $p->stock;

        $out = [
            'id'               => $p->id,
            'slug'             => $p->slug,
            'name'             => $p->name,
            'price'            => $p->price,
            'operational_cost' => $p->operational_cost,
            'selling_price'    => $p->selling_price,
            'stock'            => $effectiveStock,
            'low_stock_threshold' => $p->low_stock_threshold,
            'weight'           => $p->weight,
            'images'           => $p->images ?: [],
            'category'         => $p->category ? ['id' => $p->category->id, 'name' => $p->category->name, 'slug' => $p->category->slug] : null,
            'has_variants'     => $hasVariants,
            'variants'         => $activeVariants->map(fn ($v) => [
                'id'             => $v->id,
                'name'           => $v->name,
                'sku'            => $v->sku,
                'stock'          => (int) $v->stock,
                'price_override' => $v->price_override,
                'effective_price' => $v->effective_price,
                'selling_price'  => $v->selling_price,
                'weight'         => $v->effective_weight,
                'image'          => $v->image,
            ])->values(),
        ];
        if ($withDescription) {
            $out['description'] = $p->description;
        }
        return $out;
    }
}
