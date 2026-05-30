<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds Kecamatan (subdistrict) columns to addresses.
 *
 * Why:
 *   RajaOngkir Pro plan exposes per-kecamatan tariffs that differ from the
 *   plain city-level Starter price. Storing the destination kecamatan on
 *   each address (as both a free-form name and the RajaOngkir id when we
 *   know it) lets ongkir calculation pick the more granular tariff and lets
 *   the printed shipping label include "Kec. X" without re-querying the
 *   API every time.
 *
 * Both columns are nullable so existing rows / addresses created before
 * the kecamatan dropdown shipped continue to work — the cost endpoint just
 * falls back to city-level pricing in that case.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('addresses', function (Blueprint $table) {
            $table->string('subdistrict')->nullable()->after('city_id');
            $table->string('subdistrict_id')->nullable()->after('subdistrict');
        });
    }

    public function down(): void
    {
        Schema::table('addresses', function (Blueprint $table) {
            $table->dropColumn(['subdistrict', 'subdistrict_id']);
        });
    }
};
