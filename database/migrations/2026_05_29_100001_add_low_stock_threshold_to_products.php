<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Threshold per-produk untuk indikator "stok hampir habis".
 * Nullable: kalau null, frontend pakai default global dari SiteSetting
 * (`low_stock_threshold`). Ini supaya admin bisa override per produk
 * yang punya pola turnover berbeda (mis. parts cepat habis vs aksesoris).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->unsignedInteger('low_stock_threshold')->nullable()->after('stock');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('low_stock_threshold');
        });
    }
};
