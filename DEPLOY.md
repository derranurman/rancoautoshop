# Deploy Ranco Autoshop ke Hosting

Panduan praktis untuk publish toko ke internet **tanpa mengganti** kunci Midtrans/RajaOngkir
sandbox yang sudah dipakai. Saat siap go-live nanti, perubahannya cuma 4 baris di file `.env`
backend + 1 di Vercel — lihat bagian [Go-live ke Production](#9-saat-siap-go-live-ke-production-beneran).

> Kalau cuma butuh contekan cepat, ada juga:
> - `backend/.env.production.example` — template `.env` untuk hosting backend
> - `frontend/.env.production.example` — template env vars untuk Vercel
> - `backend/deploy.sh` — script optimize/migrate yang dijalankan tiap habis deploy

---

## Daftar isi

1. [Pilih kombinasi hosting](#1-pilih-kombinasi-hosting)
2. [Persiapan domain & subdomain](#2-persiapan-domain--subdomain)
3. [Deploy backend Laravel](#3-deploy-backend-laravel)
4. [Deploy frontend Next.js (Vercel)](#4-deploy-frontend-nextjs-vercel)
5. [Setup webhook Midtrans](#5-setup-webhook-midtrans)
6. [Smoke test setelah deploy](#6-smoke-test-setelah-deploy)
7. [Storage & upload gambar (logo, produk)](#7-storage--upload-gambar)
8. [Catatan keamanan & operasional](#8-catatan-keamanan--operasional)
9. [Saat siap go-live ke production beneran](#9-saat-siap-go-live-ke-production-beneran)
10. [Troubleshooting umum](#10-troubleshooting-umum)

---

## 1. Pilih kombinasi hosting

| Skenario | Backend (Laravel) | Frontend (Next.js) | DB |
|---|---|---|---|
| **Termurah & familiar** | Niagahoster / Hostinger Cloud Hosting | Vercel (free tier) | MySQL bawaan hosting |
| **Modern, auto-deploy dari Git** | Railway / Render | Vercel | Postgres atau MySQL managed |
| **Full kontrol** | DigitalOcean / Contabo VPS + Nginx + PHP-FPM | Vercel atau PM2 di VPS | MySQL/MariaDB di VPS |

Rekomendasi awal: **Niagahoster Cloud Hosting** + **Vercel**. Murah, support PHP 8.2 + MySQL,
Vercel auto-deploy dari GitHub setiap push. Domain `.com`/`.id` bisa beli sekalian di
Niagahoster.

---

## 2. Persiapan domain & subdomain

Pakai dua subdomain biar bersih:

| Subdomain | Tujuan | Contoh |
|---|---|---|
| `api.rancoautoshop.com` | Laravel backend | A record → IP cloud hosting |
| `rancoautoshop.com` | Next.js frontend | CNAME → cname.vercel-dns.com |
| `www.rancoautoshop.com` | Alias frontend | CNAME → cname.vercel-dns.com |

Aktifkan **HTTPS** di kedua-duanya (Niagahoster & Vercel sudah otomatis Let's Encrypt). Sanctum
dan cookie session **tidak akan jalan kalau salah satu masih HTTP**.

---

## 3. Deploy backend Laravel

### 3.1. Siapkan database MySQL

Di panel hosting:
1. Buat database baru, mis. `rancoautoshop_prod` dengan charset `utf8mb4`.
2. Catat host, port, user, password.

> Jangan pakai SQLite di production. File DB-nya bisa hilang waktu redeploy dan locking-nya
> tidak cocok untuk concurrent request.

### 3.2. Upload kode

Pilihan A — **Git deploy** (Niagahoster Cloud / Railway / Render):
- Connect ke repo GitHub `derranurman/rancoautoshop`.
- Set "build path" / "root" ke `backend/`.
- Set deploy branch ke `feat/ecommerce-scaffold` (atau `main` kalau sudah dipindah).

Pilihan B — **Manual upload** via File Manager / SFTP:
- Upload isi folder `backend/` ke `/home/<user>/public_html/api/` (atau path yang document
  root-nya akan diarahkan ke `backend/public`).

### 3.3. Document root

Webserver **harus** mengarah ke `backend/public`, bukan ke `backend/` langsung. Ini bukan opsi.
Kalau dipanel hosting tidak bisa dipindah, pilihan praktisnya:
- pakai file `.htaccess` redirect, atau
- pindah isi `backend/public/` ke document root, lalu edit `index.php` agar require ke
  `__DIR__.'/../<folder backend>/vendor/autoload.php'`.

Cara terbersih: pakai cPanel **"Set Document Root"** atau buat subdomain dengan target folder
`backend/public`.

### 3.4. Buat `.env` produksi

Salin `backend/.env.production.example` → `backend/.env`, lalu isi:

- `APP_KEY` — generate dengan `php artisan key:generate` (atau `php -r 'echo "base64:".base64_encode(random_bytes(32));'`).
- `APP_URL` — domain backend, mis. `https://api.rancoautoshop.com`.
- `FRONTEND_URL`, `SANCTUM_STATEFUL_DOMAINS`, `CORS_ALLOWED_ORIGINS` — domain frontend.
- `SESSION_DOMAIN` — diawali titik, mis. `.rancoautoshop.com`, supaya cookie shared antar subdomain.
- `DB_*` — kredensial MySQL di langkah 3.1.
- `MIDTRANS_*` & `RAJAONGKIR_*` — **biarkan sandbox sesuai sekarang**. Tidak perlu diubah saat
  pertama kali launch ke staging/UAT.

> **RajaOngkir tidak punya sandbox**. Kunci `starter` yang sekarang dipakai sudah API
> production tier gratis — tinggal pakai. Quota terbatas, jadi caching kita di `CACHE_STORE=database`
> wajib aktif (sudah default di template).

### 3.5. Install dependency & bootstrap aplikasi

SSH ke hosting, lalu:

```bash
cd <path-ke-backend>
composer install --no-dev --optimize-autoloader
php artisan key:generate         # kalau APP_KEY belum diisi manual
php artisan migrate --seed --force
php artisan storage:link
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

Atau jalankan helper script yang sudah disediakan:

```bash
bash deploy.sh
```

### 3.6. Permission folder

Pastikan webserver punya akses tulis ke:

```
storage/                    chmod -R 775
bootstrap/cache/            chmod -R 775
```

Owner biasanya `www-data` (Ubuntu/Nginx) atau user cPanel kamu. Salah permission = error 500
acak saat upload logo.

---

## 4. Deploy frontend Next.js (Vercel)

1. Login ke [vercel.com](https://vercel.com) → **Add New Project** → import repo
   `derranurman/rancoautoshop`.
2. **Root Directory**: pilih `frontend/`. Vercel auto-detect Next.js.
3. **Production Branch**: `feat/ecommerce-scaffold` (atau ganti sesuai branch produksi nantinya).
4. **Environment Variables** — copy dari `frontend/.env.production.example`:

   | Key | Value (sandbox) |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://api.rancoautoshop.com` |
   | `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | `SB-Mid-client-xxxxxxxx` |
   | `NEXT_PUBLIC_MIDTRANS_SNAP_URL` | `https://app.sandbox.midtrans.com/snap/snap.js` |

5. **Domains**: tambahkan `rancoautoshop.com` dan `www.rancoautoshop.com`. Vercel kasih
   instruksi DNS (CNAME ke `cname.vercel-dns.com`). Set di registrar domain.
6. **Deploy**. Setiap push ke production branch akan trigger build otomatis.

> Vercel akan menjalankan `npm install` lalu `npm run build`. Dependency `xlsx` (untuk Export
> Excel) dan SheetJS akan otomatis ke-install.

---

## 5. Setup webhook Midtrans

Login ke [Midtrans Dashboard Sandbox](https://dashboard.sandbox.midtrans.com) →
**Settings → Configuration**:

| Field | Isi |
|---|---|
| **Payment Notification URL** | `https://api.rancoautoshop.com/api/payments/midtrans/notification` |
| **Finish Redirect URL** | `https://rancoautoshop.com/orders` |
| **Unfinish Redirect URL** | `https://rancoautoshop.com/orders` |
| **Error Redirect URL** | `https://rancoautoshop.com/orders` |

Tanpa Notification URL yang benar, status pesanan **tidak akan auto-update** ke `paid` setelah
pembeli bayar — admin harus manual klik sync.

---

## 6. Smoke test setelah deploy

Cek satu-satu:

- [ ] `https://api.rancoautoshop.com/api/health` mengembalikan `{"ok":true,...}`
- [ ] `https://api.rancoautoshop.com/api/site-settings` mengembalikan JSON pengaturan default
- [ ] `https://rancoautoshop.com` tampil dengan hero banner
- [ ] Login customer di `/login` → sukses & navbar berubah
- [ ] Login admin di `/admin/login` pakai `admin@rancoautoshop.local` / `admin12345` → masuk ke
      `/admin/dashboard`. **Segera ubah password admin** di menu Profil Admin.
- [ ] Admin → Tampilan → upload logo → reload storefront → logo muncul di navbar
- [ ] Tambah produk ke keranjang → Checkout → pilih kurir (ongkir muncul) → klik Bayar → popup
      Snap sandbox tampil → bayar dengan kartu uji Midtrans `4811 1111 1111 1114`
- [ ] Status order di `/admin/orders/<id>` berubah ke `paid` (artinya webhook jalan)
- [ ] Widget WhatsApp (kalau diaktifkan di menu Tampilan) muncul di pojok kanan-bawah

---

## 7. Storage & upload gambar

`php artisan storage:link` membuat symlink dari `backend/public/storage` →
`backend/storage/app/public`. Tanpa ini:

- Foto produk yang di-upload admin → **404**
- Logo & favicon dari menu Tampilan → **404**

Cek dengan: `ls -la backend/public/storage`. Harusnya muncul sebagai symlink.

URL `/storage/branding/<file>` di frontend di-rewrite oleh Vercel ke
`https://api.rancoautoshop.com/storage/branding/<file>`. Mekanisme ini sudah otomatis lewat
`next.config.mjs`.

---

## 8. Catatan keamanan & operasional

| Hal | Yang harus dilakukan |
|---|---|
| Password admin default | **Wajib** ganti setelah deploy pertama. Default `admin12345` cuma untuk dev. |
| `APP_DEBUG` | Set `false` di production. Stack trace di prod = vector serangan. |
| `.env` | Jangan commit. Pastikan `.env.production` juga tidak ke-push (sudah di `.gitignore`). |
| HTTPS | Wajib. Sanctum cookie pakai `Secure` flag — tidak ada HTTPS = tidak login. |
| Backup DB | Jadwalkan backup harian di panel hosting (atau cron `mysqldump`). |
| Log | Cek `storage/logs/laravel.log` setiap kali ada laporan bug — webhook Midtrans/RajaOngkir error tercatat di sini. |
| Rate limiting | Tambahkan throttle untuk `/auth/login` & `/auth/otp/request` saat traffic mulai naik. |

---

## 9. Saat siap go-live ke production beneran

Apply for [Midtrans Production](https://dashboard.midtrans.com) (perlu verifikasi NPWP / KTP
PIC), tunggu approval, lalu cuma ubah ini:

### Backend `.env`

```env
MIDTRANS_SERVER_KEY=Mid-server-xxxxxxxx       # tanpa prefix SB-
MIDTRANS_CLIENT_KEY=Mid-client-xxxxxxxx
MIDTRANS_IS_PRODUCTION=true
MIDTRANS_SNAP_URL=https://app.midtrans.com/snap/snap.js
```

Lalu di hosting:

```bash
php artisan config:clear && php artisan config:cache
```

### Vercel env vars

```env
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY=Mid-client-xxxxxxxx
NEXT_PUBLIC_MIDTRANS_SNAP_URL=https://app.midtrans.com/snap/snap.js
```

Klik **Redeploy** di Vercel.

### Webhook

Daftarkan ulang Notification URL di [Midtrans Dashboard Production](https://dashboard.midtrans.com):

```
https://api.rancoautoshop.com/api/payments/midtrans/notification
```

Selesai. Tidak ada perubahan di RajaOngkir karena memang hanya satu mode.

---

## 10. Troubleshooting umum

| Gejala | Kemungkinan penyebab | Cara cek |
|---|---|---|
| Login admin sukses tapi reload langsung balik ke /admin/login | `SESSION_DOMAIN` salah / tidak diawali titik | Pastikan `.rancoautoshop.com` (titik di depan) |
| `/api/...` di browser kena CORS | Domain frontend belum ada di `CORS_ALLOWED_ORIGINS` | Tambahkan, jalankan `config:cache` |
| Logo upload sukses tapi gambar 404 | Belum `php artisan storage:link` | Jalankan ulang, atau bikin symlink manual |
| Status pesanan tetap `pending` setelah bayar sandbox | Webhook URL salah / belum HTTPS | Cek log Midtrans Dashboard → Transactions → klik order → tab Notification |
| Filter ongkir di checkout error 500 | Cache table belum di-migrate | `php artisan migrate --force` |
| Tombol Export Excel tidak muncul / TypeScript error setelah pull | Lupa `npm install` di frontend | Vercel auto handle. Lokal: `npm install` |
| Hero gradient tidak berubah meski sudah di-save | Browser nge-cache localStorage settings | Buka DevTools → Application → Local Storage → hapus key `ranco.siteSettings` lalu reload |

---

Selesai. Kalau ada error yang nggak ada di atas, kirim isi `storage/logs/laravel.log` (10 baris
terakhir) dan response dari `/api/health` saat panggil dari browser.
