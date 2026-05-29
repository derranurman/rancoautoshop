<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    use HasFactory;

    protected $fillable = [
        'category_id',
        'name',
        'slug',
        'description',
        'price',
        'operational_cost',
        'stock',
        'weight',
        'images',
        'is_active',
    ];

    /**
     * Always serialize selling_price (price + operational_cost) so any client
     * — admin product table, customer storefront, cart, etc. — gets the
     * "harga jual ke user" without each endpoint having to compute it
     * manually. Shipping is added on top at checkout, not here.
     */
    protected $appends = ['selling_price'];

    protected function casts(): array
    {
        return [
            'images'           => 'array',
            'price'            => 'integer',
            'operational_cost' => 'integer',
            'stock'            => 'integer',
            'weight'           => 'integer',
            'is_active'        => 'boolean',
        ];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    /**
     * Varian produk (warna, ukuran, dsb.). Kalau kosong, produk dianggap tunggal —
     * harga & stok diambil langsung dari kolom produk.
     */
    public function variants(): HasMany
    {
        return $this->hasMany(ProductVariant::class)->orderBy('sort_order')->orderBy('id');
    }

    /** True kalau produk punya minimal satu varian aktif. */
    public function hasVariants(): bool
    {
        return $this->variants()->where('is_active', true)->exists();
    }

    /**
     * Selling price shown to the user (price + operational cost, WITHOUT shipping).
     * Shipping is computed at checkout and added on top.
     *
     * Catatan: kalau produk punya varian, harga ini hanya jadi "harga awal".
     * Frontend yang akan menampilkan harga sesuai varian terpilih.
     */
    public function getSellingPriceAttribute(): int
    {
        return (int) $this->price + (int) $this->operational_cost;
    }
}
