<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrderTrackingEvent extends Model
{
    use HasFactory;

    public const SOURCE_ADMIN    = 'admin';
    public const SOURCE_SYSTEM   = 'system';
    public const SOURCE_WEBHOOK  = 'webhook';
    public const SOURCE_CUSTOMER = 'customer';

    protected $fillable = [
        'order_id',
        'status',
        'location',
        'note',
        'source',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
