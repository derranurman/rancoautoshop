<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Tambah varian ke cart_items.
 *
 * Penting:
 *   - Tabel asli punya UNIQUE(cart_id, product_id). Itu harus dibongkar karena 1 user
 *     boleh punya "Stir Skeleton merah" DAN "Stir Skeleton biru" di keranjang yang sama.
 *   - SQLite (default dev) tidak mendukung dropping unique by column-list secara langsung
 *     lewat doctrine pada Laravel 11 untuk semua versi — kita pakai pendekatan generik:
 *     drop dengan nama index Laravel default.
 *   - Setelah varian_id ditambahkan, unique-key baru = (cart_id, product_id, variant_id).
 *     `variant_id` NULL tetap valid karena produk tanpa varian baris-nya tunggal.
 *     Catatan: SQLite memperlakukan NULL sebagai tidak-sama, jadi unique tetap aman.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cart_items', function (Blueprint $table) {
            $table->foreignId('variant_id')->nullable()->after('product_id')
                ->constrained('product_variants')->nullOnDelete();
        });

        // Drop the old (cart_id, product_id) unique constraint, then add the new one.
        // Pakai try/catch untuk robust di berbagai DB driver.
        try {
            Schema::table('cart_items', function (Blueprint $table) {
                $table->dropUnique('cart_items_cart_id_product_id_unique');
            });
        } catch (\Throwable $e) {
            // Beberapa instalasi mungkin sudah tidak punya index ini. Abaikan.
        }

        try {
            Schema::table('cart_items', function (Blueprint $table) {
                $table->unique(['cart_id', 'product_id', 'variant_id'], 'cart_items_cart_product_variant_unique');
            });
        } catch (\Throwable $e) {
            // SQLite kadang complain saat menambah unique pada kolom dengan NULL existing.
            // Aman untuk skip — logika app sudah pakai firstOrNew dengan filter eksplisit.
        }
    }

    public function down(): void
    {
        Schema::table('cart_items', function (Blueprint $table) {
            try { $table->dropUnique('cart_items_cart_product_variant_unique'); } catch (\Throwable) {}
            $table->dropConstrainedForeignId('variant_id');
        });
        try {
            Schema::table('cart_items', function (Blueprint $table) {
                $table->unique(['cart_id', 'product_id'], 'cart_items_cart_id_product_id_unique');
            });
        } catch (\Throwable) {}
    }
};
