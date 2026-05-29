<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\JsonResponse;

class CategoryController extends Controller
{
    public function index(): JsonResponse
    {
        // operational_cost_percent is internal margin info, not exposed publicly.
        return response()->json([
            'data' => Category::orderBy('name')->get(['id', 'name', 'slug', 'description']),
        ]);
    }
}
