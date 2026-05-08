<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->string('order_number')->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('status')->default('pending');
            $table->unsignedInteger('subtotal')->default(0);
            $table->unsignedInteger('operational_cost')->default(0);
            $table->unsignedInteger('shipping_cost')->default(0);
            $table->unsignedInteger('discount')->default(0);
            $table->unsignedInteger('total')->default(0);
            $table->string('voucher_code')->nullable();
            $table->string('courier')->nullable();          // jne / pos / tiki
            $table->string('courier_service')->nullable();  // REG / YES / OKE
            $table->string('tracking_number')->nullable();
            $table->string('recipient_name');
            $table->string('recipient_phone');
            $table->text('shipping_address');
            $table->string('midtrans_snap_token')->nullable();
            $table->string('midtrans_order_id')->nullable()->index();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
        });

        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->nullable()->constrained()->nullOnDelete();
            $table->string('product_name');
            $table->unsignedInteger('price_snapshot');
            $table->unsignedInteger('operational_cost_snapshot')->default(0);
            $table->unsignedInteger('quantity');
            $table->unsignedInteger('subtotal');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_items');
        Schema::dropIfExists('orders');
    }
};
