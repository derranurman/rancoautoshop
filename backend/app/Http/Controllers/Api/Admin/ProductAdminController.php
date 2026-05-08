<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class ProductAdminController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Product::query()->with('category:id,name,slug');
        if ($s = $request->string('search')->trim()->value()) {
            $q->where('name', 'like', "%{$s}%");
        }
        return response()->json($q->latest()->paginate($request->integer('per_page', 20)));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $data['slug'] = $this->uniqueSlug($data['name']);
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
        $product->update($data);
        return response()->json(['data' => $product->fresh('category')]);
    }

    public function destroy(Product $product): JsonResponse
    {
        $product->delete();
        return response()->json(['message' => 'deleted']);
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
            'images.*'         => ['string'],
            'is_active'        => ['boolean'],
        ]);
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
}
