<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Single-row "site_settings" table — stores branding & widget config
     * yang bisa diatur dari menu admin "Tampilan". Modelnya sengaja key-tipped
     * (kolom-kolom konkret) bukan key/value JSON supaya validasi & query
     * mudah, dan kalau nanti ada field baru tinggal migrate add column.
     */
    public function up(): void
    {
        Schema::create('site_settings', function (Blueprint $table) {
            $table->id();

            // Branding umum
            $table->string('app_name', 80)->default('Ranco Autoshop');
            $table->string('logo_url')->nullable();             // /storage/branding/<file> atau URL eksternal
            $table->string('favicon_url')->nullable();

            // Hero (banner besar di homepage)
            $table->string('hero_title', 120)->default('Ranco Autoshop');
            $table->string('hero_subtitle', 240)->default('Aksesoris, sparepart, & perlengkapan mobil dengan harga bersahabat.');
            $table->string('hero_search_placeholder', 160)->default('Cari produk... misal: stir skeleton, velg, oli');
            // Warna gradient hero — disimpan sebagai hex string. Kalau null,
            // storefront pakai warna brand default dari Tailwind.
            $table->string('hero_gradient_from', 20)->nullable();
            $table->string('hero_gradient_to', 20)->nullable();

            // Footer
            $table->string('footer_text', 240)->nullable();

            // WhatsApp floating widget
            $table->boolean('whatsapp_enabled')->default(false);
            // Disimpan apa adanya saat input, dinormalisasi (digit-only +62...)
            // di model accessor sebelum dipakai untuk link wa.me.
            $table->string('whatsapp_number', 30)->nullable();
            $table->string('whatsapp_label', 80)->default('Chat Admin Ranco');
            $table->string('whatsapp_greeting', 240)->default('Halo! Ada yang bisa kami bantu seputar produk Ranco Autoshop?');
            $table->string('whatsapp_prefilled_text', 240)->default('Halo Admin Ranco, saya ingin bertanya tentang produk.');

            $table->timestamps();
        });

        // Pastikan selalu ada satu row supaya storefront punya defaults
        // tanpa perlu null-check di banyak tempat.
        \Illuminate\Support\Facades\DB::table('site_settings')->insert([
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('site_settings');
    }
};
