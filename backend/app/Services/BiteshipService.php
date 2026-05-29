<?php

namespace App\Services;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\SiteSetting;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Biteship API integration.
 *
 * Docs: https://biteship.com/en/docs
 *
 * Key/sandbox/live ditentukan oleh ENV:
 *   - BITESHIP_API_KEY (string, mandatory kalau mau dipakai)
 *   - BITESHIP_BASE_URL (default https://api.biteship.com)
 *   - BITESHIP_WEBHOOK_SECRET (untuk verifikasi signature webhook)
 *
 * Catatan:
 *   - Test mode di Biteship dibedakan oleh API KEY (toggle "Mode Testing"
 *     di dashboard menghasilkan key terpisah). Base URL-nya sama persis,
 *     jadi kita tidak perlu cabang URL di sini.
 *   - Order API di sandbox di-SIMULASIKAN — request berhasil, dapat AWB
 *     dummy, tapi tidak ada pickup beneran & saldo tidak berkurang.
 *   - Rates/Tracking di sandbox PAKAI DATA NYATA dan tetap berbayar.
 */
class BiteshipService
{
    protected ?string $apiKey;
    protected string $baseUrl;
    protected ?string $webhookSecret;

    public function __construct()
    {
        $this->apiKey        = config('services.biteship.api_key');
        $this->baseUrl       = rtrim((string) config('services.biteship.base_url', 'https://api.biteship.com'), '/');
        $this->webhookSecret = config('services.biteship.webhook_secret');
    }

    public function enabled(): bool
    {
        // Toggle dashboard-level (admin matikan tanpa menghapus key) +
        // sanity check key benar-benar terisi.
        if (! $this->apiKey) return false;
        return (bool) (SiteSetting::current()->biteship_enabled ?? false);
    }

    public function configured(): bool
    {
        return ! empty($this->apiKey);
    }

    protected function http()
    {
        return Http::withHeaders([
                'Authorization' => $this->apiKey ?? '',
                'Accept'        => 'application/json',
                'Content-Type'  => 'application/json',
            ])
            ->timeout(15)
            ->baseUrl($this->baseUrl);
    }

    /**
     * GET pricing untuk kombinasi origin → destination → items.
     *
     * Biteship menerima origin/destination by:
     *   - postal code (paling simpel, kita pakai ini),
     *   - area_id (lebih akurat, perlu lookup terpisah),
     *   - coordinate (paling akurat, butuh geocoder).
     *
     * Untuk MVP, kita pakai postal_code. Customer mengisi alamat (sudah punya
     * postal_code), site settings menyimpan postal pengirim.
     *
     * @param  array  $items  array of [name, value, weight (gram), quantity]
     * @return array  [pricing[], errors[]]
     */
    public function rates(int $originPostal, int $destinationPostal, array $items, ?string $couriersCsv = null): array
    {
        if (! $this->apiKey) {
            return ['pricing' => [], 'mock' => true, 'error' => 'BITESHIP_API_KEY belum di-set di .env'];
        }
        $payload = [
            'origin_postal_code'      => $originPostal,
            'destination_postal_code' => $destinationPostal,
            'couriers'                => $couriersCsv ?? 'jne,jnt,sicepat,anteraja,pos,tiki,ide,ninja,gojek,grab',
            'items'                   => array_map(fn ($i) => [
                'name'     => (string) ($i['name'] ?? 'Item'),
                'value'    => (int) ($i['value'] ?? 0),
                'weight'   => max(1, (int) ($i['weight'] ?? 1000)),
                'quantity' => max(1, (int) ($i['quantity'] ?? 1)),
            ], $items),
        ];

        try {
            $r = $this->http()->post('/v1/rates/couriers', $payload);
            if (! $r->ok()) {
                Log::warning('[biteship] rates failed', ['status' => $r->status(), 'body' => $r->body()]);
                return ['pricing' => [], 'error' => $r->json('message') ?? 'Gagal mengambil tarif Biteship.'];
            }
            return ['pricing' => $r->json('pricing') ?? []];
        } catch (\Throwable $e) {
            Log::error('[biteship] rates exception', ['msg' => $e->getMessage()]);
            return ['pricing' => [], 'error' => $e->getMessage()];
        }
    }

    /**
     * Buat order ke Biteship → Biteship akan menjadwalkan pickup ke kurir.
     *
     * Response menyertakan `courier.waybill_id` yang langsung jadi AWB
     * pelanggan untuk kurir yang support "instant waybill" (mis. JNE, J&T
     * untuk sebagian layanan). Untuk yang tidak instant, waybill_id muncul
     * belakangan via webhook → kita tetap simpan order_id supaya bisa
     * polling / tracking.
     *
     * @return array [order, error?]
     */
    public function createOrder(Order $order): array
    {
        if (! $this->apiKey) {
            return ['order' => null, 'error' => 'BITESHIP_API_KEY belum di-set.'];
        }

        $settings = SiteSetting::current();
        if (! $settings->sender_name || ! $settings->sender_address || ! $settings->sender_postal_code) {
            return ['order' => null, 'error' => 'Lengkapi identitas pengirim (nama, alamat, kode pos) di Pengaturan Tampilan dulu.'];
        }
        if (! $order->biteship_courier_code || ! $order->biteship_courier_service_code) {
            return ['order' => null, 'error' => 'Order ini tidak menyimpan kode kurir Biteship — kemungkinan dibuat sebelum Biteship diaktifkan.'];
        }

        // Customer postal code — ambil dari shipping_address (free-text). Kita
        // simpan di kolom terpisah belum tersedia, jadi parsing manual: cari
        // 5 digit pertama di alamat. Fallback ke 0 yang akan ditolak Biteship.
        $destPostal = (int) (preg_match('/\b(\d{5})\b/', (string) $order->shipping_address, $m) ? $m[1] : 0);

        $items = $order->items->map(function (OrderItem $i) {
            return [
                'name'     => mb_substr($i->product_name . ($i->variant_name ? ' - '.$i->variant_name : ''), 0, 100),
                'value'    => (int) ($i->price_snapshot + $i->operational_cost_snapshot),
                'quantity' => (int) $i->quantity,
                'weight'   => 1000, // approx — order_items belum simpan berat per item
            ];
        })->all();

        $payload = [
            'shipper_contact_name'   => $settings->sender_name,
            'shipper_contact_phone'  => $settings->sender_phone ?? $settings->whatsapp_number_normalized ?? '0000000000',
            'shipper_organization'   => $settings->app_name ?? 'Toko',
            'origin_contact_name'    => $settings->sender_name,
            'origin_contact_phone'   => $settings->sender_phone ?? $settings->whatsapp_number_normalized ?? '0000000000',
            'origin_address'         => $settings->sender_address,
            'origin_postal_code'     => (int) $settings->sender_postal_code,
            'destination_contact_name'  => $order->recipient_name,
            'destination_contact_phone' => $order->recipient_phone,
            'destination_address'    => $order->shipping_address,
            'destination_postal_code'=> $destPostal,
            'courier_company'        => $order->biteship_courier_code,
            'courier_type'           => $order->biteship_courier_service_code,
            'courier_insurance'      => 0,
            'delivery_type'          => 'now',
            'items'                  => $items,
            'order_note'             => 'Order #' . $order->order_number,
        ];
        // COD: kalau metode order adalah COD, set Biteship cash_on_delivery
        // amount = total order. Note: tidak semua kurir support COD, kalau
        // tidak support Biteship akan return error & admin bisa fallback.
        if ($order->payment_method === Order::PAYMENT_METHOD_COD) {
            $payload['cash_on_delivery'] = ['amount' => (int) $order->total];
        }

        try {
            $r = $this->http()->post('/v1/orders', $payload);
            if (! $r->ok()) {
                Log::warning('[biteship] createOrder failed', ['status' => $r->status(), 'body' => $r->body()]);
                return ['order' => null, 'error' => $r->json('message') ?? 'Gagal membuat order Biteship.'];
            }
            return ['order' => $r->json()];
        } catch (\Throwable $e) {
            Log::error('[biteship] createOrder exception', ['msg' => $e->getMessage()]);
            return ['order' => null, 'error' => $e->getMessage()];
        }
    }

    /** Ambil status & tracking events dari Biteship untuk order tertentu. */
    public function tracking(string $biteshipOrderId): array
    {
        if (! $this->apiKey) return ['error' => 'BITESHIP_API_KEY belum di-set.'];
        try {
            $r = $this->http()->get('/v1/trackings/'.$biteshipOrderId);
            if (! $r->ok()) {
                return ['error' => $r->json('message') ?? 'Gagal mengambil tracking.'];
            }
            return $r->json();
        } catch (\Throwable $e) {
            return ['error' => $e->getMessage()];
        }
    }

    /** Cancel order Biteship — return error string atau null. */
    public function cancelOrder(string $biteshipOrderId, ?string $reason = null): ?string
    {
        if (! $this->apiKey) return 'BITESHIP_API_KEY belum di-set.';
        try {
            $r = $this->http()->delete('/v1/orders/'.$biteshipOrderId, [
                'cancellation_reason' => $reason ?? 'Order dibatalkan oleh admin.',
            ]);
            if (! $r->ok()) {
                return $r->json('message') ?? 'Gagal cancel Biteship order.';
            }
            return null;
        } catch (\Throwable $e) {
            return $e->getMessage();
        }
    }

    /**
     * Verifikasi signature webhook.
     *
     * Biteship mengirim header `signature` (atau `x-biteship-signature` di
     * beberapa versi) yang berisi HMAC-SHA256 dari body, dengan key =
     * webhook secret yang admin atur di dashboard.
     *
     * Kalau secret tidak di-set di .env, kita SKIP verifikasi (mode dev).
     * JANGAN deploy ke production tanpa secret terisi.
     */
    public function verifyWebhookSignature(string $rawBody, ?string $signature): bool
    {
        if (! $this->webhookSecret) return true; // dev mode
        if (! $signature) return false;
        $expected = hash_hmac('sha256', $rawBody, $this->webhookSecret);
        return hash_equals($expected, $signature);
    }

    /**
     * Mapping status Biteship → status order internal.
     * Biteship punya banyak status; kita reduksi ke status yang dipahami app:
     *   pending|confirmed|allocated|picking_up    → STATUS_PACKED (siap kirim)
     *   picked|dropping_off|on_hold|return_in_transit → STATUS_SHIPPED
     *   delivered                                  → STATUS_DELIVERED
     *   rejected|cancelled|courier_not_found       → STATUS_CANCELLED
     *   returned|disposed                          → STATUS_CANCELLED (refund flow harus manual)
     */
    public static function mapBiteshipStatus(string $biteshipStatus): ?string
    {
        return match ($biteshipStatus) {
            'pending', 'confirmed', 'allocated', 'picking_up' => Order::STATUS_PACKED,
            'picked', 'dropping_off', 'on_hold', 'return_in_transit' => Order::STATUS_SHIPPED,
            'delivered' => Order::STATUS_DELIVERED,
            'rejected', 'cancelled', 'courier_not_found', 'returned', 'disposed' => Order::STATUS_CANCELLED,
            default => null, // unknown → biarkan status app tidak berubah
        };
    }
}
