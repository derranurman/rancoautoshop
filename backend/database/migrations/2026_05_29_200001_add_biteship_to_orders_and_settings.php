<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dukungan Biteship — paralel dengan RajaOngkir.
 *
 * Strategi:
 *   - Tetap pakai kolom `courier`, `courier_service`, `tracking_number` yang sudah ada
 *     supaya semua UI existing (label, halaman customer, admin) tetap bekerja.
 *   - `shipping_provider` menentukan dari mana data berasal (rajaongkir | biteship | manual)
 *   - `biteship_order_id` dipakai untuk call API tracking & cancel
 *   - `biteship_courier_code` & `biteship_courier_service_code` simpan kode internal Biteship
 *     yang kadang beda dari kode RajaOngkir (mis. "jt" vs "jnt"), supaya tidak ambigu.
 *   - Site settings: toggle aktif/non-aktif (api key sendiri di .env supaya aman).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('shipping_provider', 30)->default('rajaongkir')->after('courier_service');
            $table->string('biteship_order_id', 100)->nullable()->after('shipping_provider');
            $table->string('biteship_courier_code', 50)->nullable()->after('biteship_order_id');
            $table->string('biteship_courier_service_code', 50)->nullable()->after('biteship_courier_code');
            $table->string('biteship_status', 50)->nullable()->after('biteship_courier_service_code');
            $table->json('biteship_raw')->nullable()->after('biteship_status');

            $table->index('biteship_order_id');
        });

        Schema::table('site_settings', function (Blueprint $table) {
            $table->boolean('biteship_enabled')->default(false)->after('low_stock_threshold');
            // Default provider yang DIPILIH di dropdown checkout. Customer tetap bisa
            // ganti, tapi ini menentukan opsi yang muncul duluan.
            $table->string('default_shipping_provider', 30)->default('rajaongkir')->after('biteship_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['biteship_order_id']);
            $table->dropColumn([
                'shipping_provider',
                'biteship_order_id',
                'biteship_courier_code',
                'biteship_courier_service_code',
                'biteship_status',
                'biteship_raw',
            ]);
        });
        Schema::table('site_settings', function (Blueprint $table) {
            $table->dropColumn(['biteship_enabled', 'default_shipping_provider']);
        });
    }
};
