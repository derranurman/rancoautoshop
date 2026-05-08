<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
     * Selling price shown to the user (price + operational cost, WITHOUT shipping).
     * Shipping is computed at checkout and added on top.
     */
    public function getSellingPriceAttribute(): int
    {
        return (int) $this->price + (int) $this->operational_cost;
    }
}
