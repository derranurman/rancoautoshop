<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Address extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'label',
        'recipient_name',
        'phone',
        'province',
        'city',
        'city_id',         // RajaOngkir city id
        'subdistrict',     // Free-form kecamatan name (label dipakai di alamat cetak).
        'subdistrict_id',  // RajaOngkir subdistrict id (opsional — null kalau kota itu belum punya data kecamatan).
        'postal_code',
        'address_line',
        'is_default',
    ];

    protected function casts(): array
    {
        return ['is_default' => 'boolean'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
