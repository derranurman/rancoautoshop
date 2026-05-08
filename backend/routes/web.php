<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'app'      => config('app.name'),
        'message'  => 'Ranco Autoshop API is running. Hit /api/health or /api/products.',
        'frontend' => env('FRONTEND_URL', 'http://localhost:3000'),
    ]);
});
