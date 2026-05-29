<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dukungan pembayaran transfer manual.
 *
 * Strategi:
 *   - Tambah kolom `payment_method` ('midtrans' default, 'manual_transfer').
 *   - Bukti transfer disimpan sebagai URL relatif ke disk public.
 *   - Saat customer mengupload bukti, status pesanan pindah ke 'awaiting_verification'.
 *     Status ini dipetakan dari `Order::STATUS_AWAITING_VERIFICATION`.
 *   - Admin lalu approve (status → paid) atau reject (status balik → pending,
 *     `payment_rejection_reason` diisi, file bukti dibersihkan).
 *
 * Tidak menyentuh `paid_at`, `midtrans_*`, atau status lain di model — supaya
 * kompatibel mundur dengan order Midtrans yang sudah ada di database.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('payment_method', 30)->default('midtrans')->after('total');
            $table->string('payment_proof_url')->nullable()->after('payment_method');
            $table->timestamp('payment_proof_uploaded_at')->nullable()->after('payment_proof_url');
            $table->foreignId('payment_verified_by')->nullable()->after('payment_proof_uploaded_at')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('payment_verified_at')->nullable()->after('payment_verified_by');
            $table->string('payment_rejection_reason', 500)->nullable()->after('payment_verified_at');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('payment_verified_by');
            $table->dropColumn([
                'payment_method',
                'payment_proof_url',
                'payment_proof_uploaded_at',
                'payment_verified_at',
                'payment_rejection_reason',
            ]);
        });
    }
};
