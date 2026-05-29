<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            // Persen biaya operasional default untuk semua produk di kategori ini
            // (mis. 8.00 = 8%). Saat admin membuat / mengedit produk dan tidak
            // mengisi biaya operasional manual, biaya ops dihitung otomatis:
            //   operational_cost = round(price * operational_cost_percent / 100)
            $table->decimal('operational_cost_percent', 5, 2)->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn('operational_cost_percent');
        });
    }
};
