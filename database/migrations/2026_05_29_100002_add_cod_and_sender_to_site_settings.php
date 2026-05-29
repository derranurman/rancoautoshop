<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Konfigurasi COD + identitas pengirim untuk label pengiriman + threshold global stok.
 *
 * - cod_enabled       : master switch COD di checkout.
 * - cod_min/max_total : batasan nominal COD (opsional). Banyak kurir Indonesia
 *                       membatasi COD ke Rp 50.000 - Rp 5.000.000. Admin bisa
 *                       override sesuai partner kurirnya.
 * - cod_extra_fee     : biaya tambahan COD (mis. 4% dari total). Disimpan flat
 *                       supaya simple — admin bisa hitung manual atau geser nanti.
 * - sender_*          : alamat pengirim untuk label pengiriman PDF. Wajib ada
 *                       supaya admin tidak perlu ngetik ulang setiap label.
 * - low_stock_threshold : default global untuk badge stok di storefront.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('site_settings', function (Blueprint $table) {
            $table->boolean('cod_enabled')->default(false)->after('bank_extra_note');
            $table->unsignedInteger('cod_min_total')->default(0)->after('cod_enabled');
            $table->unsignedInteger('cod_max_total')->nullable()->after('cod_min_total');
            $table->unsignedInteger('cod_extra_fee')->default(0)->after('cod_max_total');
            $table->text('cod_extra_note')->nullable()->after('cod_extra_fee');

            $table->string('sender_name', 120)->nullable()->after('cod_extra_note');
            $table->string('sender_phone', 30)->nullable()->after('sender_name');
            $table->text('sender_address')->nullable()->after('sender_phone');
            $table->string('sender_city', 120)->nullable()->after('sender_address');
            $table->string('sender_postal_code', 10)->nullable()->after('sender_city');

            $table->unsignedInteger('low_stock_threshold')->default(5)->after('sender_postal_code');
        });
    }

    public function down(): void
    {
        Schema::table('site_settings', function (Blueprint $table) {
            $table->dropColumn([
                'cod_enabled', 'cod_min_total', 'cod_max_total', 'cod_extra_fee', 'cod_extra_note',
                'sender_name', 'sender_phone', 'sender_address', 'sender_city', 'sender_postal_code',
                'low_stock_threshold',
            ]);
        });
    }
};
