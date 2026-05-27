<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\SiteSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Admin CRUD untuk pengaturan tampilan toko (menu "Tampilan").
 *
 * Catatan: kita pakai pola singleton (selalu row id=1), jadi tidak ada
 * "store/destroy". Hanya read & update + endpoint terpisah untuk upload
 * file logo/favicon.
 */
class SiteSettingsAdminController extends Controller
{
    public function show(): JsonResponse
    {
        $s = SiteSetting::current();
        // Untuk admin kita kembalikan field mentah (tanpa filter publicArray)
        // sebagai sumber kebenaran untuk form edit.
        return response()->json([
            'data' => array_merge($s->toArray(), [
                'whatsapp_link'              => $s->whatsapp_link,
                'whatsapp_number_normalized' => $s->whatsapp_number_normalized,
            ]),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'app_name'                => ['sometimes', 'string', 'max:80'],
            'logo_url'                => ['sometimes', 'nullable', 'string', 'max:500'],
            'favicon_url'             => ['sometimes', 'nullable', 'string', 'max:500'],

            'hero_title'              => ['sometimes', 'string', 'max:120'],
            'hero_subtitle'           => ['sometimes', 'string', 'max:240'],
            'hero_search_placeholder' => ['sometimes', 'string', 'max:160'],
            'hero_gradient_from'      => ['sometimes', 'nullable', 'string', 'max:20'],
            'hero_gradient_to'        => ['sometimes', 'nullable', 'string', 'max:20'],

            'footer_text'             => ['sometimes', 'nullable', 'string', 'max:240'],

            'whatsapp_enabled'        => ['sometimes', 'boolean'],
            'whatsapp_number'         => ['sometimes', 'nullable', 'string', 'max:30'],
            'whatsapp_label'          => ['sometimes', 'string', 'max:80'],
            'whatsapp_greeting'       => ['sometimes', 'string', 'max:240'],
            'whatsapp_prefilled_text' => ['sometimes', 'string', 'max:240'],
        ]);

        $s = SiteSetting::current();

        // Bersih-bersih file lama bila admin mengganti / menghapus logo.
        if (array_key_exists('logo_url', $data) && $data['logo_url'] !== $s->logo_url) {
            $this->deleteLocalFileIfOwned($s->logo_url);
        }
        if (array_key_exists('favicon_url', $data) && $data['favicon_url'] !== $s->favicon_url) {
            $this->deleteLocalFileIfOwned($s->favicon_url);
        }

        $s->fill($data)->save();

        return response()->json([
            'data' => array_merge($s->fresh()->toArray(), [
                'whatsapp_link'              => $s->whatsapp_link,
                'whatsapp_number_normalized' => $s->whatsapp_number_normalized,
            ]),
        ]);
    }

    /**
     * Upload file logo/favicon. Body: multipart dengan field "image".
     * Mengembalikan url relatif (`/storage/branding/<file>`) untuk disimpan
     * di `logo_url` / `favicon_url`.
     */
    public function uploadAsset(Request $request): JsonResponse
    {
        $request->validate([
            'image' => ['required', 'image', 'mimes:jpg,jpeg,png,webp,gif,svg', 'max:2048'], // 2 MB cukup untuk logo
        ]);

        $file = $request->file('image');
        $name = Str::uuid()->toString().'.'.strtolower($file->getClientOriginalExtension() ?: $file->extension());
        $path = $file->storeAs('branding', $name, 'public');

        return response()->json([
            'path'         => $path,
            'url'          => '/storage/'.$path,
            'absolute_url' => Storage::disk('public')->url($path),
        ], 201);
    }

    /**
     * Hapus file lokal kalau URL menunjuk ke storage publik kita sendiri.
     * URL eksternal (https://...) dibiarkan saja.
     */
    protected function deleteLocalFileIfOwned(?string $url): void
    {
        if (! $url) return;

        $appUrl = rtrim((string) config('app.url'), '/');
        if ($appUrl && str_starts_with($url, $appUrl)) {
            $url = substr($url, strlen($appUrl));
        }
        if (str_starts_with($url, '/storage/')) {
            $rel = substr($url, strlen('/storage/'));
            try { Storage::disk('public')->delete($rel); } catch (\Throwable) { /* abaikan */ }
        }
    }
}
