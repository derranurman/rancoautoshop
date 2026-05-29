<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Snapshot varian ke order_items.
 *
 * Tujuan: walaupun nanti varian dihapus admin, riwayat order tetap menampilkan
 * "Stir Skeleton 14 Inch — Merah" + sku saat dibeli.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->foreignId('variant_id')->nullable()->after('product_id')
                ->constrained('product_variants')->nullOnDelete();
            $table->string('variant_name', 120)->nullable()->after('product_name');
            $table->string('variant_sku', 80)->nullable()->after('variant_name');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropConstrainedForeignId('variant_id');
            $table->dropColumn(['variant_name', 'variant_sku']);
        });
    }
};
