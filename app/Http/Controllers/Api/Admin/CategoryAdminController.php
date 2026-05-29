<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CategoryAdminController extends Controller
{
    public function index(): JsonResponse
    {
        // Include product count so admin can see at a glance which categories
        // are non-empty (relevant for delete confirmation).
        return response()->json([
            'data' => Category::withCount('products')->orderBy('name')->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'                     => ['required', 'string', 'max:120'],
            'description'              => ['nullable', 'string', 'max:500'],
            'operational_cost_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
        ]);
        $data['slug'] = Str::slug($data['name']);
        $data['operational_cost_percent'] = $data['operational_cost_percent'] ?? 0;
        return response()->json(['data' => Category::create($data)], 201);
    }

    public function update(Request $request, Category $category): JsonResponse
    {
        $data = $request->validate([
            'name'                     => ['required', 'string', 'max:120'],
            'description'              => ['nullable', 'string', 'max:500'],
            'operational_cost_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
        ]);
        $data['slug'] = Str::slug($data['name']);
        $category->update($data);
        return response()->json(['data' => $category->fresh()]);
    }

    public function destroy(Category $category): JsonResponse
    {
        // Detach products from this category instead of cascade-deleting them.
        // Storefront will simply show them with no category until reassigned.
        $category->products()->update(['category_id' => null]);
        $category->delete();
        return response()->json(['message' => 'deleted']);
    }
}
