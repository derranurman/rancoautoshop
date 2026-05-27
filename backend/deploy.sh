#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Ranco Autoshop — script deploy backend.
#
# Jalankan setiap kali habis pull/upload kode baru ke hosting:
#     bash deploy.sh
#
# Script ini idempotent: aman dijalankan berkali-kali. Yang dilakukan:
#   1. Install dependency Composer (production-only).
#   2. Generate APP_KEY kalau belum ada.
#   3. Bersihkan cache lama (config/route/view).
#   4. Migrate + seed (--force, biar tidak prompt).
#   5. Buat symlink storage publik (kalau belum).
#   6. Optimize: re-cache config/route/view.
#
# Kalau ada langkah yang gagal, script langsung berhenti (set -e) supaya tidak
# men-deploy kondisi setengah-jadi.
# -----------------------------------------------------------------------------

set -euo pipefail

cd "$(dirname "$0")"

echo "==> 1/6 composer install"
composer install --no-dev --optimize-autoloader --no-interaction

if ! grep -qE '^APP_KEY=base64:' .env 2>/dev/null; then
  echo "==> 2/6 php artisan key:generate (APP_KEY belum diisi)"
  php artisan key:generate --force
else
  echo "==> 2/6 APP_KEY sudah ada, skip"
fi

echo "==> 3/6 clear cache lama"
php artisan optimize:clear

echo "==> 4/6 migrate + seed (idempotent, tabel yang sudah ada di-skip)"
php artisan migrate --force
# Seeder hanya men-create kalau row belum ada (lihat AdminUserSeeder, dst.).
# Aman dijalankan ulang.
php artisan db:seed --force || true

echo "==> 5/6 storage:link"
php artisan storage:link || true   # symlink yang sudah ada akan menyebabkan exit !=0; abaikan.

echo "==> 6/6 cache config/route/view (production)"
php artisan config:cache
php artisan route:cache
php artisan view:cache

echo
echo "Deploy selesai. Cek: $(php -r 'echo getenv("APP_URL") ?: "APP_URL belum diset";')/api/health"
