<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ProductAdminController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Product::query()->with('category:id,name,slug');
        if ($s = $request->string('search')->trim()->value()) {
            $q->where('name', 'like', "%{$s}%");
        }
        if ($categoryId = $request->integer('category_id')) {
            $q->where('category_id', $categoryId);
        }
        return response()->json($q->latest()->paginate($request->integer('per_page', 20)));
    }

    /**
     * Bulk-set operational_cost as a percentage of each product's price.
     *
     * Body:
     *   percent     : float (0..100) — e.g. 8 means 8% of price
     *   category_id : optional int — limit to a single category
     *   product_ids : optional int[] — limit to a specific subset
     *
     * If neither category_id nor product_ids is provided, applies to ALL
     * products. Returns the number of rows updated. Each product gets
     * operational_cost = round(price * percent / 100).
     */
    public function bulkOperationalCost(Request $request): JsonResponse
    {
        $data = $request->validate([
            'percent'       => ['required', 'numeric', 'min:0', 'max:100'],
            'category_id'   => ['nullable', 'integer', 'exists:categories,id'],
            'product_ids'   => ['nullable', 'array'],
            'product_ids.*' => ['integer', 'exists:products,id'],
        ]);

        $q = Product::query();
        if (! empty($data['category_id'])) {
            $q->where('category_id', $data['category_id']);
        }
        if (! empty($data['product_ids'])) {
            $q->whereIn('id', $data['product_ids']);
        }

        $percent = (float) $data['percent'];
        $updated = 0;

        // Loop through one-by-one so the calculation is per-product (price varies).
        $q->chunkById(200, function ($products) use ($percent, &$updated) {
            foreach ($products as $p) {
                $p->operational_cost = (int) round($p->price * $percent / 100);
                $p->save();
                $updated++;
            }
        });

        return response()->json([
            'updated' => $updated,
            'percent' => $percent,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $data['slug'] = $this->uniqueSlug($data['name']);
        $data['operational_cost'] = $this->resolveOperationalCost($data, null);
        $product = Product::create($data);
        return response()->json(['data' => $product], 201);
    }

    public function show(Product $product): JsonResponse
    {
        return response()->json(['data' => $product->load('category')]);
    }

    public function update(Request $request, Product $product): JsonResponse
    {
        $data = $this->validated($request, $product->id);
        if (isset($data['name']) && $data['name'] !== $product->name) {
            $data['slug'] = $this->uniqueSlug($data['name'], $product->id);
        }
        $data['operational_cost'] = $this->resolveOperationalCost($data, $product);

        // Best-effort cleanup: delete files for images that were dropped.
        if (array_key_exists('images', $data)) {
            $kept = collect($data['images'] ?? [])->map(fn ($u) => $this->relativeStoragePath($u))->filter()->values();
            $oldPaths = collect($product->images ?? [])->map(fn ($u) => $this->relativeStoragePath($u))->filter()->values();
            $toDelete = $oldPaths->diff($kept);
            foreach ($toDelete as $p) {
                Storage::disk('public')->delete($p);
            }
        }

        $product->update($data);
        return response()->json(['data' => $product->fresh('category')]);
    }

    public function destroy(Product $product): JsonResponse
    {
        // Delete uploaded files if any.
        foreach ((array) ($product->images ?? []) as $img) {
            $p = $this->relativeStoragePath($img);
            if ($p) Storage::disk('public')->delete($p);
        }
        $product->delete();
        return response()->json(['message' => 'deleted']);
    }

    /**
     * Upload a single product image and return the URL the form should store.
     *
     * Returns an origin-relative URL (`/storage/products/<file>`) so the
     * Next.js dev rewrite can proxy it transparently.
     */
    public function uploadImage(Request $request): JsonResponse
    {
        $request->validate([
            'image' => ['required', 'image', 'mimes:jpg,jpeg,png,webp,gif', 'max:5120'], // 5 MB
        ]);

        $file = $request->file('image');
        $name = Str::uuid()->toString().'.'.strtolower($file->getClientOriginalExtension() ?: $file->extension());
        $path = $file->storeAs('products', $name, 'public'); // products/<uuid>.jpg

        return response()->json([
            'path' => $path,
            'url'  => '/storage/'.$path,                       // for frontend (relative)
            'absolute_url' => Storage::disk('public')->url($path),
        ], 201);
    }

    protected function validated(Request $request, ?int $ignoreId = null): array
    {
        return $request->validate([
            'category_id'      => ['nullable', 'integer', 'exists:categories,id'],
            'name'             => ['required', 'string', 'max:180'],
            'description'      => ['nullable', 'string'],
            'price'            => ['required', 'integer', 'min:0'],
            'operational_cost' => ['nullable', 'integer', 'min:0'],
            'stock'            => ['required', 'integer', 'min:0'],
            'weight'           => ['required', 'integer', 'min:1'],
            'images'           => ['nullable', 'array'],
            'images.*'         => ['string'], // either /storage/... path or full URL
            'is_active'        => ['boolean'],
        ]);
    }

    /**
     * Decide what operational_cost to persist for a product.
     *
     * Behaviour:
     *  - If the request explicitly sent an `operational_cost` value (even 0),
     *    use it as-is — that's the admin's manual override.
     *  - If the field is missing/null, auto-compute from the chosen category's
     *    `operational_cost_percent`:
     *        operational_cost = round(price * percent / 100)
     *  - If no category is set or its percent is 0, falls back to 0 on create
     *    or keeps the existing value on update.
     *
     * The admin's intent ("auto" vs "manual") is conveyed by simply omitting
     * the field in the request body, so the API doesn't need a separate flag.
     */
    protected function resolveOperationalCost(array $data, ?Product $existing): int
    {
        // Admin sent an explicit number → manual override, respect it.
        if (array_key_exists('operational_cost', $data) && $data['operational_cost'] !== null) {
            return (int) $data['operational_cost'];
        }

        // Auto from category percent, if any.
        $price = (int) ($data['price'] ?? $existing?->price ?? 0);
        $categoryId = $data['category_id'] ?? $existing?->category_id ?? null;
        if ($categoryId) {
            $cat = \App\Models\Category::find($categoryId);
            if ($cat && (float) $cat->operational_cost_percent > 0) {
                return (int) round($price * ((float) $cat->operational_cost_percent) / 100);
            }
        }

        // No useful info — keep existing on update, default 0 on create.
        return (int) ($existing?->operational_cost ?? 0);
    }

    protected function uniqueSlug(string $name, ?int $ignoreId = null): string
    {
        $base = Str::slug($name);
        $slug = $base;
        $i = 2;
        while (Product::where('slug', $slug)->when($ignoreId, fn ($q) => $q->where('id', '!=', $ignoreId))->exists()) {
            $slug = $base.'-'.$i++;
        }
        return $slug;
    }

    /**
     * Convert a stored image string into a public-disk relative path
     * (e.g. "products/abc.jpg") if it points to our own storage; otherwise null.
     */
    protected function relativeStoragePath(?string $url): ?string
    {
        if (! $url) return null;

        // Strip absolute APP_URL prefix if present so we can detect /storage/.
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
