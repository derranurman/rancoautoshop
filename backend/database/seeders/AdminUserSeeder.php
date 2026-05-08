<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $email    = env('ADMIN_EMAIL', 'admin@rancoautoshop.local');
        $password = env('ADMIN_PASSWORD', 'admin12345');
        $name     = env('ADMIN_NAME', 'Ranco Admin');

        User::updateOrCreate(
            ['email' => $email],
            [
                'name'              => $name,
                'password'          => Hash::make($password),
                'role'              => User::ROLE_ADMIN,
                'is_active'         => true,
                'email_verified_at' => now(),
            ]
        );

        // A demo customer too
        User::updateOrCreate(
            ['email' => 'customer@rancoautoshop.local'],
            [
                'name'              => 'Demo Customer',
                'password'          => Hash::make('customer12345'),
                'role'              => User::ROLE_CUSTOMER,
                'is_active'         => true,
                'email_verified_at' => now(),
            ]
        );

        $this->command?->info("Admin: {$email} / {$password}");
    }
}
