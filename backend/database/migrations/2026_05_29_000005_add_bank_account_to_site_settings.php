<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Field rekening bank untuk pembayaran transfer manual.
 *
 * Disimpan di site_settings (single row) supaya admin bisa mengatur dari halaman
 * admin tanpa migrasi tambahan saat rekening berubah.
 *
 * `manual_transfer_enabled` = master switch. Kalau false, opsi "Transfer Manual"
 * tidak muncul di checkout — toko hanya menerima Midtrans.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('site_settings', function (Blueprint $table) {
            $table->boolean('manual_transfer_enabled')->default(false)->after('whatsapp_prefilled_text');
            $table->string('bank_name', 80)->nullable()->after('manual_transfer_enabled');
            $table->string('bank_account_number', 60)->nullable()->after('bank_name');
            $table->string('bank_account_holder', 120)->nullable()->after('bank_account_number');
            $table->string('bank_branch', 120)->nullable()->after('bank_account_holder');
            $table->text('bank_extra_note')->nullable()->after('bank_branch');
        });
    }

    public function down(): void
    {
        Schema::table('site_settings', function (Blueprint $table) {
            $table->dropColumn([
                'manual_transfer_enabled',
                'bank_name',
                'bank_account_number',
                'bank_account_holder',
                'bank_branch',
                'bank_extra_note',
            ]);
        });
    }
};
