<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Varian produk (mis. warna: merah/biru/hitam).
 *
 * Harga & berat menggunakan pola "override":
 *   - Kolom `*_override` NULL  → ikut produk induk.
 *   - Kolom `*_override` diisi → varian punya nilainya sendiri.
 *
 * Selling price akhir untuk customer = (harga efektif varian) + operational_cost produk.
 * Operational cost SENGAJA tetap di level produk supaya admin tidak perlu mengisi
 * margin per-varian — biasanya margin sama untuk semua warna/ukuran.
 */
class ProductVariant extends Model
{
    use HasFactory;

    protected $fillable = [
        'product_id',
        'name',
        'sku',
        'stock',
        'price_override',
        'weight_override',
        'image',
        'is_active',
        'sort_order',
    ];

    protected $appends = ['effective_price', 'effective_weight', 'selling_price'];

    protected function casts(): array
    {
        return [
            'stock'           => 'integer',
            'price_override'  => 'integer',
            'weight_override' => 'integer',
            'sort_order'      => 'integer',
            'is_active'       => 'boolean',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /** Harga dasar efektif (varian override jika ada, kalau tidak fallback produk). */
    public function getEffectivePriceAttribute(): int
    {
        if ($this->price_override !== null) {
            return (int) $this->price_override;
        }
        return (int) ($this->product?->price ?? 0);
    }

    /** Berat efektif untuk RajaOngkir (gram). */
    public function getEffectiveWeightAttribute(): int
    {
        if ($this->weight_override !== null) {
            return (int) $this->weight_override;
        }
        return (int) ($this->product?->weight ?? 0);
    }

    /** Harga jual akhir = harga efektif + operational_cost dari produk induk. */
    public function getSellingPriceAttribute(): int
    {
        return $this->effective_price + (int) ($this->product?->operational_cost ?? 0);
    }
}
