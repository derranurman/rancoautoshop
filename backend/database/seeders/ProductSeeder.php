<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class ProductSeeder extends Seeder
{
    public function run(): void
    {
        $catBySlug = Category::pluck('id', 'slug');

        $placeholder = 'https://placehold.co/600x600/111827/ffffff?text=Ranco+Autoshop';

        $products = [
            [
                'category' => 'stir-kemudi',
                'name' => 'Stir Skeleton Racing 14 Inch',
                'price' => 450000, 'operational_cost' => 75000,
                'stock' => 20, 'weight' => 2500,
                'description' => 'Stir skeleton racing 14 inch bahan aluminium + kulit sintetis. Grip nyaman, cocok untuk mobil sedan & hatchback.',
            ],
            [
                'category' => 'stir-kemudi',
                'name' => 'Boss Kit Universal',
                'price' => 180000, 'operational_cost' => 30000,
                'stock' => 30, 'weight' => 800,
                'description' => 'Boss kit universal kompatibel untuk berbagai merk mobil.',
            ],
            [
                'category' => 'velg-ban',
                'name' => 'Velg Racing 17 Inch Ring 4x100',
                'price' => 2750000, 'operational_cost' => 250000,
                'stock' => 8, 'weight' => 9000,
                'description' => 'Velg racing 17" PCD 4x100, cocok untuk Avanza, Xenia, Jazz, City.',
            ],
            [
                'category' => 'lampu-elektrikal',
                'name' => 'Lampu LED Headlamp H4 120W',
                'price' => 320000, 'operational_cost' => 50000,
                'stock' => 40, 'weight' => 600,
                'description' => 'LED Headlamp H4 120W, terang 12000 lumens, plug & play.',
            ],
            [
                'category' => 'lampu-elektrikal',
                'name' => 'Klakson Keong Denso',
                'price' => 150000, 'operational_cost' => 25000,
                'stock' => 25, 'weight' => 900,
                'description' => 'Klakson keong Denso suara nyaring, original Japan spec.',
            ],
            [
                'category' => 'interior',
                'name' => 'Sarung Jok Semi Kulit (Full Set)',
                'price' => 850000, 'operational_cost' => 100000,
                'stock' => 12, 'weight' => 4000,
                'description' => 'Sarung jok semi kulit full set 3 baris, custom potong sesuai tipe mobil.',
            ],
            [
                'category' => 'interior',
                'name' => 'Karpet Dasar Mobil 5D Premium',
                'price' => 650000, 'operational_cost' => 75000,
                'stock' => 15, 'weight' => 6000,
                'description' => 'Karpet dasar 5D premium bahan PVC + EVA, anti air, mudah dibersihkan.',
            ],
            [
                'category' => 'eksterior',
                'name' => 'Spoiler Belakang Carbon Look',
                'price' => 480000, 'operational_cost' => 60000,
                'stock' => 10, 'weight' => 1800,
                'description' => 'Spoiler belakang motif carbon, double tape 3M, universal.',
            ],
            [
                'category' => 'oli-perawatan',
                'name' => 'Oli Mesin Shell Helix HX7 5W-30 4L',
                'price' => 385000, 'operational_cost' => 30000,
                'stock' => 50, 'weight' => 4200,
                'description' => 'Oli mesin sintetis Shell Helix HX7 5W-30, kemasan 4 liter.',
            ],
            [
                'category' => 'oli-perawatan',
                'name' => 'Kit Pewangi Mobil Ambi Pur',
                'price' => 75000, 'operational_cost' => 10000,
                'stock' => 100, 'weight' => 150,
                'description' => 'Pewangi mobil Ambi Pur, wangi tahan hingga 30 hari.',
            ],
        ];

        foreach ($products as $p) {
            Product::updateOrCreate(
                ['slug' => Str::slug($p['name'])],
                [
                    'category_id'      => $catBySlug[$p['category']] ?? null,
                    'name'             => $p['name'],
                    'description'      => $p['description'],
                    'price'            => $p['price'],
                    'operational_cost' => $p['operational_cost'],
                    'stock'            => $p['stock'],
                    'weight'           => $p['weight'],
                    'images'           => [$placeholder],
                    'is_active'        => true,
                ]
            );
        }
    }
}
