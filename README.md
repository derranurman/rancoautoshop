# Ranco Autoshop

Toko online aksesoris, sparepart, dan perlengkapan mobil. Proyek ini adalah **monorepo** dengan dua bagian:

- **`backend/`** — REST API dibangun dengan **Laravel 11** + **Sanctum** (MySQL / SQLite)
- **`frontend/`** — Storefront & Admin Panel dibangun dengan **Next.js 14 (App Router)** + **TypeScript** + **Tailwind**

Fitur MVP yang sudah termasuk di Fase 1:

- Autentikasi pelanggan: **email/password**, **Google Sign-In**, dan **WhatsApp OTP** (Twilio)
- **Halaman login admin terpisah** di `/admin/login` — admin & pelanggan memakai tabel `users` yang sama tapi dibedakan lewat kolom `role`
- Katalog produk + kategori, detail produk, keranjang, checkout
- **Harga tampil** = harga dasar + biaya operasional per produk (di-set admin). **Ongkir ditanggung pembeli** dan dihitung di checkout lewat **RajaOngkir**
- Pembayaran via **Midtrans Snap** (sandbox)
- Voucher diskon (persen / nominal, minimum belanja, limit pakai)
- Dashboard admin: produk, pesanan (status pending → paid → packed → shipped → delivered), pelanggan (suspend), voucher, laporan penjualan harian 30 hari terakhir

---

## Kredensial default

Di-seed otomatis saat `php artisan db:seed`:

| Peran | Email | Password |
|---|---|---|
| Admin | `admin@rancoautoshop.local` | `admin12345` |
| Customer demo | `customer@rancoautoshop.local` | `customer12345` |

Ubah di `backend/.env` (variabel `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`) sebelum seeding untuk production.

---

## Arsitektur singkat

```
Next.js (port 3000) ──►  Laravel API (port 8000)  ──►  MySQL / SQLite
       │                          │
       │                          ├──► Midtrans (payment gateway)
       │                          ├──► RajaOngkir (ongkir real-time)
       │                          ├──► Twilio (WhatsApp OTP)
       │                          └──► Google OAuth (via Socialite)
       │
       └── /api/* di-proxy ke Laravel via next.config rewrites
```

URL terpisah untuk admin & pelanggan di frontend:

- Storefront (pelanggan): `/`, `/login`, `/register`, `/cart`, `/checkout`, `/orders`
- Admin panel: `/admin/login`, `/admin/dashboard`, `/admin/products`, `/admin/orders`, `/admin/users`, `/admin/vouchers`, `/admin/reports`

---

## Jalanin di lokal

### Prasyarat

- **PHP 8.2+** dengan ekstensi `pdo_sqlite` (atau `pdo_mysql` jika pakai MySQL), `mbstring`, `openssl`, `xml`, `curl`, `gd`, `bcmath`
- **Composer 2.x**
- **Node.js 18+** dan **npm** (atau pnpm/yarn)
- (opsional) **MySQL 8**. Default project ini pakai SQLite biar cepat jalan.

### 1) Backend (Laravel)

```bash
cd backend

# Instal dependency
composer install

# Salin file env & generate key
cp .env.example .env
php artisan key:generate

# (opsional) Jika pakai SQLite, bikin file DB nya:
touch database/database.sqlite

# Migrasi + seed (bikin admin, kategori, 10 produk dummy, 2 voucher)
php artisan migrate --seed

# Buat symlink supaya foto produk yang di-upload admin bisa diakses publik
# (cuma perlu sekali per environment)
php artisan storage:link

# Jalankan API di http://localhost:8000
php artisan serve
```

#### Konfigurasi opsional (isi kalau sudah punya kunci)

Edit `backend/.env`:

```env
# Google Sign-In
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback

# Twilio WhatsApp OTP
TWILIO_ACCOUNT_SID=xxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886    # default Twilio sandbox

# Midtrans
MIDTRANS_SERVER_KEY=xxxx
MIDTRANS_CLIENT_KEY=xxxx
MIDTRANS_IS_PRODUCTION=false

# RajaOngkir (paket starter sudah cukup buat JNE/POS/TIKI)
RAJAONGKIR_API_KEY=xxxx
RAJAONGKIR_ORIGIN_CITY_ID=152    # 152 = Jakarta Pusat
```

> **Dev mode tanpa API key**: kalau kunci eksternal dibiarkan kosong, service akan otomatis fallback ke mock:
> - Twilio → OTP di-log ke `storage/logs/laravel.log` (cari baris `[DEV OTP]`)
> - Midtrans → Snap token dummy (alur UI tetap bisa dicoba, tapi tanpa popup pembayaran beneran)
> - RajaOngkir → daftar provinsi/kota/ongkir hard-coded untuk beberapa kota besar

### 2) Frontend (Next.js)

```bash
cd frontend

# Install dependency
npm install

# Salin env
cp .env.local.example .env.local
# Isi NEXT_PUBLIC_MIDTRANS_CLIENT_KEY kalau sudah punya akun Midtrans

# Jalankan
npm run dev
# Frontend jalan di http://localhost:3000
```

### 3) Login & pakai

1. Buka `http://localhost:3000`
2. Login sebagai pelanggan di `/login` pakai `customer@rancoautoshop.local` / `customer12345`, atau daftar akun baru di `/register`
3. Tambahkan produk ke keranjang → Checkout → bayar lewat Snap (sandbox)
4. Untuk admin, buka `http://localhost:3000/admin/login` pakai `admin@rancoautoshop.local` / `admin12345`

---

## Beralih ke MySQL

Di `backend/.env`:

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=rancoautoshop
DB_USERNAME=root
DB_PASSWORD=secret
```

Lalu:

```bash
mysql -u root -p -e "CREATE DATABASE rancoautoshop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
php artisan migrate:fresh --seed
```

---

## Endpoint API (ringkas)

Semua endpoint diawali `/api`.

### Publik

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET   | `/products` | List katalog (filter `search`, `category`, `sort`, paginasi) |
| GET   | `/products/{slug}` | Detail produk |
| GET   | `/categories` | List kategori |
| GET   | `/shipping/provinces` | List provinsi (RajaOngkir) |
| GET   | `/shipping/cities?province_id=` | List kota |
| POST  | `/shipping/cost` | `{ destination, weight, courier }` → daftar ongkir |
| POST  | `/vouchers/check` | `{ code, subtotal }` → valid? + diskon |
| POST  | `/auth/register` | Register pelanggan |
| POST  | `/auth/login` | Login pelanggan |
| POST  | `/auth/admin/login` | **Login admin (terpisah)** |
| POST  | `/auth/otp/request` | Kirim OTP WA |
| POST  | `/auth/otp/verify` | Verifikasi OTP → token |
| GET   | `/auth/google/redirect` | Mulai OAuth Google |
| GET   | `/auth/google/callback` | Redirect balik Google |
| POST  | `/payments/midtrans/notification` | **Webhook Midtrans** |

### Pelanggan (token Sanctum, `role = customer`)

`/cart`, `/cart/items`, `/cart/items/{id}`, `/addresses`, `/orders`, `/orders/checkout`, `/orders/{no}`, `/orders/{no}/cancel`.

### Admin (token Sanctum, `role = admin`)

Di bawah prefix `/admin`: `dashboard`, `reports/sales`, `products`, `categories`, `vouchers`, `orders`, `orders/{id}/status`, `users`, `users/{id}/toggle-suspend`.

---

## Setup Midtrans webhook (untuk notifikasi pembayaran)

Di dashboard Midtrans → Settings → Payment Notification URL, set:

```
https://<domain-kamu>/api/payments/midtrans/notification
```

Saat testing di lokal, pakai tunneling seperti [ngrok](https://ngrok.com/): `ngrok http 8000` lalu tempel URL-nya.

---

## Struktur folder (ringkas)

```
rancoautoshop/
├── backend/
│   ├── app/
│   │   ├── Http/Controllers/Api/           ← API controllers
│   │   │   └── Admin/                       ← Endpoint khusus admin
│   │   ├── Http/Middleware/EnsureAdmin.php  ← Middleware role admin
│   │   ├── Http/Middleware/EnsureCustomer.php
│   │   ├── Models/                          ← Eloquent models
│   │   └── Services/                        ← Midtrans, RajaOngkir, Twilio
│   ├── database/
│   │   ├── migrations/
│   │   └── seeders/                         ← AdminUser, Category, Product, Voucher
│   ├── routes/api.php                       ← Definisi semua endpoint
│   └── .env.example
│
└── frontend/
    ├── app/
    │   ├── (storefront)/                    ← Route group pelanggan
    │   │   ├── page.tsx                     ← Katalog
    │   │   ├── product/[slug]/
    │   │   ├── cart/
    │   │   ├── checkout/
    │   │   ├── orders/ dan orders/[no]/
    │   │   ├── login/
    │   │   └── register/
    │   └── admin/                            ← Admin panel terpisah
    │       ├── login/                        ← Form login admin
    │       └── (dashboard)/                  ← Dashboard, produk, pesanan, pelanggan, voucher, laporan
    ├── components/
    │   ├── Navbar.tsx, Footer.tsx, ProductCard.tsx
    │   └── admin/ProductForm.tsx
    ├── lib/
    │   ├── api.ts                           ← Axios + token interceptor (auto admin vs customer)
    │   ├── stores.ts                        ← Zustand stores (useAuth, useAdminAuth, useCart)
    │   └── types.ts
    └── next.config.mjs                      ← Proxy /api/* ke Laravel
```

---

## Rencana lanjutan (di luar Fase 1)

- Notifikasi email/WA saat status pesanan berubah
- Auto-tracking resi (webhook kurir)
- Print label pengiriman (PDF) dari halaman admin
- Review & rating produk
- Rate limiter untuk OTP & login
- Unit & integration tests

---

## Lisensi

Proyek internal Ranco Autoshop.
