<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Tabel varian produk.
 *
 * Konsep:
 *   - Sebuah produk OPSIONAL boleh punya banyak varian (mis. warna merah, biru, hitam).
 *   - Kalau produk tidak punya varian apapun, alur lama (harga & stok di level produk)
 *     tetap bekerja — kolom `products.price` & `products.stock` jadi sumber kebenaran.
 *   - Kalau produk punya >=1 varian, harga & stok per varian yang dipakai. Kolom
 *     `products.stock` di-mirror jadi total stok semua varian (untuk badge "stok habis"
 *     di listing tetap akurat) tapi keputusan add-to-cart selalu mengacu ke varian.
 *
 * `price_override` nullable: kalau null, varian pakai harga produk induk. Kalau diisi,
 * varian punya harga sendiri. Ini supaya kasus paling umum (semua warna harganya sama)
 * tidak memaksa admin mengisi harga berulang-ulang.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_variants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);          // contoh: "Merah", "Biru", "Hitam"
            $table->string('sku', 80)->nullable(); // optional internal code
            $table->unsignedInteger('stock')->default(0);
            $table->unsignedInteger('price_override')->nullable();   // null = ikut harga produk
            $table->unsignedInteger('weight_override')->nullable();  // null = ikut berat produk
            $table->string('image')->nullable();   // /storage/products/<file> (opsional)
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['product_id', 'name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_variants');
    }
};
