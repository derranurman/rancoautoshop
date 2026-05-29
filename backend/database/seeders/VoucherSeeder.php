<?php

namespace Database\Seeders;

use App\Models\Voucher;
use Illuminate\Database\Seeder;

class VoucherSeeder extends Seeder
{
    public function run(): void
    {
        Voucher::updateOrCreate(
            ['code' => 'RANCO10'],
            [
                'type'         => Voucher::TYPE_PERCENT,
                'value'        => 10,
                'min_purchase' => 300000,
                'max_discount' => 100000,
                'usage_limit'  => 100,
                'is_active'    => true,
                'starts_at'    => now()->subDay(),
                'ends_at'      => now()->addMonths(3),
            ]
        );

        Voucher::updateOrCreate(
            ['code' => 'HEMAT50K'],
            [
                'type'         => Voucher::TYPE_FIXED,
                'value'        => 50000,
                'min_purchase' => 500000,
                'usage_limit'  => 50,
                'is_active'    => true,
                'starts_at'    => now()->subDay(),
                'ends_at'      => now()->addMonths(1),
            ]
        );
    }
}
