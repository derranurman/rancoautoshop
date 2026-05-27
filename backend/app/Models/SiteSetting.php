<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Single-row settings model untuk konfigurasi tampilan storefront
 * (logo, hero, footer, widget WhatsApp). Diatur dari menu admin "Tampilan".
 *
 * Pakai pola singleton:
 *   SiteSetting::current() -> selalu mengembalikan row yang sama (id=1),
 *   dibuat otomatis kalau belum ada (defensive fallback bila migration
 *   seeder belum membuat row).
 */
class SiteSetting extends Model
{
    protected $fillable = [
        'app_name',
        'logo_url',
        'favicon_url',
        'hero_title',
        'hero_subtitle',
        'hero_search_placeholder',
        'hero_gradient_from',
        'hero_gradient_to',
        'footer_text',
        'whatsapp_enabled',
        'whatsapp_number',
        'whatsapp_label',
        'whatsapp_greeting',
        'whatsapp_prefilled_text',
    ];

    protected $appends = [
        'whatsapp_number_normalized',
        'whatsapp_link',
    ];

    protected function casts(): array
    {
        return [
            'whatsapp_enabled' => 'boolean',
        ];
    }

    public static function current(): self
    {
        return static::query()->firstOrCreate(['id' => 1]);
    }

    /**
     * Subset of fields yang aman dikirim ke storefront publik (tanpa auth).
     * Sengaja eksplisit supaya kalau nanti ada field internal tidak ikut bocor.
     */
    public function publicArray(): array
    {
        return [
            'app_name'                => $this->app_name,
            'logo_url'                => $this->logo_url,
            'favicon_url'             => $this->favicon_url,
            'hero_title'              => $this->hero_title,
            'hero_subtitle'           => $this->hero_subtitle,
            'hero_search_placeholder' => $this->hero_search_placeholder,
            'hero_gradient_from'      => $this->hero_gradient_from,
            'hero_gradient_to'        => $this->hero_gradient_to,
            'footer_text'             => $this->footer_text,
            'whatsapp_enabled'        => (bool) $this->whatsapp_enabled,
            'whatsapp_number'         => $this->whatsapp_number_normalized,
            'whatsapp_label'          => $this->whatsapp_label,
            'whatsapp_greeting'       => $this->whatsapp_greeting,
            'whatsapp_prefilled_text' => $this->whatsapp_prefilled_text,
            'whatsapp_link'           => $this->whatsapp_link,
        ];
    }

    /**
     * Normalisasi nomor WA ke format internasional digit-only:
     *  - "0812..."     -> "62812..."
     *  - "+62812..."   -> "62812..."
     *  - "62 812-345"  -> "62812345"
     * Mengembalikan null kalau kosong/invalid.
     */
    public function getWhatsappNumberNormalizedAttribute(): ?string
    {
        $raw = trim((string) $this->whatsapp_number);
        if ($raw === '') return null;

        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        if ($digits === '') return null;

        // Awalan "0" → ganti jadi "62" (asumsi nomor Indonesia).
        if (str_starts_with($digits, '0')) {
            $digits = '62'.substr($digits, 1);
        }
        // Awalan "+" sudah hilang oleh preg_replace, pastikan tetap valid panjangnya.
        if (strlen($digits) < 8) return null;
        return $digits;
    }

    /** Link siap-pakai untuk floating widget. Null kalau widget tidak siap dipakai. */
    public function getWhatsappLinkAttribute(): ?string
    {
        $num = $this->whatsapp_number_normalized;
        if (! $num) return null;
        $text = (string) ($this->whatsapp_prefilled_text ?? '');
        return 'https://wa.me/'.$num.($text !== '' ? '?text='.rawurlencode($text) : '');
    }
}
