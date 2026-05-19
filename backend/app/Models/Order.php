<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Casts\Attribute;
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

    /** Human-readable Indonesian label per status. */
    public const STATUS_LABELS = [
        self::STATUS_PENDING   => 'Menunggu Pembayaran',
        self::STATUS_PAID      => 'Pembayaran Diterima',
        self::STATUS_PACKED    => 'Sedang Dikemas',
        self::STATUS_SHIPPED   => 'Dikirim ke Pelanggan',
        self::STATUS_DELIVERED => 'Pesanan Selesai',
        self::STATUS_CANCELLED => 'Pesanan Dibatalkan',
    ];

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

    /** Always include the synthesized timeline when serialised to JSON. */
    protected $appends = ['timeline'];

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

    public function trackingEvents(): HasMany
    {
        return $this->hasMany(OrderTrackingEvent::class)->orderBy('created_at')->orderBy('id');
    }

    /**
     * Append a tracking event. Safe to call without changing order status.
     */
    public function addTrackingEvent(?string $status, ?string $note = null, string $source = OrderTrackingEvent::SOURCE_ADMIN, ?string $location = null): OrderTrackingEvent
    {
        return $this->trackingEvents()->create([
            'status'   => $status,
            'note'     => $note,
            'source'   => $source,
            'location' => $location,
        ]);
    }

    /**
     * Timeline of tracking events for the customer / admin UI.
     *
     * Returns real persisted events when present. For legacy orders that were
     * created before tracking existed, returns a synthesized timeline based on
     * the order's current status so the UI is never empty.
     */
    protected function timeline(): Attribute
    {
        return Attribute::make(get: function () {
            $events = $this->relationLoaded('trackingEvents')
                ? $this->trackingEvents
                : $this->trackingEvents()->get();

            if ($events->isNotEmpty()) {
                return $events->map(fn (OrderTrackingEvent $e) => [
                    'id'         => $e->id,
                    'status'     => $e->status,
                    'label'      => $e->status ? (self::STATUS_LABELS[$e->status] ?? $e->status) : 'Catatan',
                    'note'       => $e->note,
                    'location'   => $e->location,
                    'source'     => $e->source,
                    'created_at' => $e->created_at?->toIso8601String(),
                ])->values();
            }

            // Synthesize from current state (legacy orders).
            $synth = [];
            $synth[] = [
                'id'         => null,
                'status'     => self::STATUS_PENDING,
                'label'      => self::STATUS_LABELS[self::STATUS_PENDING],
                'note'       => 'Pesanan dibuat, menunggu pembayaran.',
                'location'   => null,
                'source'     => OrderTrackingEvent::SOURCE_SYSTEM,
                'created_at' => $this->created_at?->toIso8601String(),
            ];

            if ($this->paid_at) {
                $synth[] = [
                    'id'         => null,
                    'status'     => self::STATUS_PAID,
                    'label'      => self::STATUS_LABELS[self::STATUS_PAID],
                    'note'       => 'Pembayaran telah dikonfirmasi.',
                    'location'   => null,
                    'source'     => OrderTrackingEvent::SOURCE_WEBHOOK,
                    'created_at' => $this->paid_at?->toIso8601String(),
                ];
            }

            // If current status is further along than what we have above,
            // append a single event for the current state using updated_at.
            $reached = collect($synth)->pluck('status')->all();
            if (! in_array($this->status, $reached, true) && isset(self::STATUS_LABELS[$this->status])) {
                $synth[] = [
                    'id'         => null,
                    'status'     => $this->status,
                    'label'      => self::STATUS_LABELS[$this->status],
                    'note'       => $this->status === self::STATUS_SHIPPED && $this->tracking_number
                        ? "Paket diserahkan ke kurir. Resi: {$this->tracking_number}"
                        : null,
                    'location'   => null,
                    'source'     => OrderTrackingEvent::SOURCE_SYSTEM,
                    'created_at' => $this->updated_at?->toIso8601String(),
                ];
            }

            return collect($synth);
        });
    }
}
