<?php

namespace Database\Seeders;

use App\Models\Category;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class CategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            ['name' => 'Stir & Kemudi',        'description' => 'Stir racing, stir skeleton, boss kit.'],
            ['name' => 'Velg & Ban',           'description' => 'Velg racing, ban mobil, dop velg.'],
            ['name' => 'Lampu & Elektrikal',   'description' => 'Lampu LED, HID, aksesoris kelistrikan.'],
            ['name' => 'Interior',             'description' => 'Sarung jok, karpet, aksesoris interior.'],
            ['name' => 'Eksterior',            'description' => 'Body kit, spoiler, emblem, stiker.'],
            ['name' => 'Oli & Perawatan',      'description' => 'Oli mesin, cairan pembersih, pewangi.'],
        ];

        foreach ($categories as $c) {
            Category::updateOrCreate(
                ['slug' => Str::slug($c['name'])],
                ['name' => $c['name'], 'description' => $c['description']]
            );
        }
    }
}
