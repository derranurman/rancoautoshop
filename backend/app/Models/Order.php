<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Order extends Model
{
    use HasFactory;

    public const STATUS_PENDING   = 'pending';     // menunggu pembayaran
    public const STATUS_PAID      = 'paid';        // sudah dibayar
    public const STATUS_PACKED    = 'packed';      // sedang dikemas admin
    public const STATUS_SHIPPED   = 'shipped';     // dikirim via kurir
    public const STATUS_DELIVERED = 'delivered';   // diterima
    public const STATUS_CANCELLED = 'cancelled';

    protected $fillable = [
        'order_number',
        'user_id',
        'status',
        'subtotal',
        'operational_cost',
        'shipping_cost',
        'discount',
        'total',
        'voucher_code',
        'courier',
        'courier_service',
        'tracking_number',
        'recipient_name',
        'recipient_phone',
        'shipping_address',
        'midtrans_snap_token',
        'midtrans_order_id',
        'paid_at',
    ];

    protected function casts(): array
    {
        return [
            'subtotal'         => 'integer',
            'operational_cost' => 'integer',
            'shipping_cost'    => 'integer',
            'discount'         => 'integer',
            'total'            => 'integer',
            'paid_at'          => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }
}
