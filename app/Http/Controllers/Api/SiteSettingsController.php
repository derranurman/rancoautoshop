<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SiteSetting;
use Illuminate\Http\JsonResponse;

/**
 * Endpoint publik untuk membaca konfigurasi tampilan toko.
 * Dipanggil oleh storefront (Navbar, hero, footer, widget WhatsApp) saat
 * halaman pertama dimuat. Jangan menambahkan field sensitif di sini —
 * gunakan {@see SiteSetting::publicArray()} untuk filter eksplisit.
 */
class SiteSettingsController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json([
            'data' => SiteSetting::current()->publicArray(),
        ]);
    }
}
