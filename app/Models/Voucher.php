<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Voucher extends Model
{
    use HasFactory;

    public const TYPE_PERCENT = 'percent';
    public const TYPE_FIXED   = 'fixed';

    protected $fillable = [
        'code',
        'type',
        'value',
        'min_purchase',
        'max_discount',
        'usage_limit',
        'used_count',
        'starts_at',
        'ends_at',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'value'        => 'integer',
            'min_purchase' => 'integer',
            'max_discount' => 'integer',
            'usage_limit'  => 'integer',
            'used_count'   => 'integer',
            'starts_at'    => 'datetime',
            'ends_at'      => 'datetime',
            'is_active'    => 'boolean',
        ];
    }

    public function isUsable(?int $subtotal = null): bool
    {
        if (! $this->is_active) {
            return false;
        }
        $now = now();
        if ($this->starts_at && $now->lt($this->starts_at)) return false;
        if ($this->ends_at   && $now->gt($this->ends_at))   return false;
        if ($this->usage_limit && $this->used_count >= $this->usage_limit) return false;
        if ($subtotal !== null && $this->min_purchase && $subtotal < $this->min_purchase) return false;
        return true;
    }

    public function computeDiscount(int $subtotal): int
    {
        $discount = $this->type === self::TYPE_PERCENT
            ? (int) round($subtotal * ($this->value / 100))
            : (int) $this->value;

        if ($this->max_discount && $discount > $this->max_discount) {
            $discount = (int) $this->max_discount;
        }
        return min($discount, $subtotal);
    }
}
