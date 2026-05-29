<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_tracking_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            // Status snapshot at the time of the event (matches Order::STATUS_*).
            // Null means it's an informational note that does not change order status.
            $table->string('status')->nullable();
            $table->string('location')->nullable();   // e.g. "Gudang Jakarta"
            $table->text('note')->nullable();         // free text shown to user
            $table->string('source')->default('admin'); // admin | system | webhook | customer
            $table->timestamps();

            $table->index(['order_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_tracking_events');
    }
};
