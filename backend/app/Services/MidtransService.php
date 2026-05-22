<?php

namespace App\Services;

use App\Models\Order;
use Illuminate\Support\Facades\Http;

/**
 * Midtrans Snap integration.
 * Docs: https://docs.midtrans.com/docs/snap-snap-integration-guide
 */
class MidtransService
{
    protected ?string $serverKey;
    protected bool $isProduction;

    public function __construct()
    {
        $this->serverKey    = config('services.midtrans.server_key');
        $this->isProduction = (bool) config('services.midtrans.is_production', false);
    }

    public function enabled(): bool
    {
        return ! empty($this->serverKey);
    }

    protected function baseUrl(): string
    {
        return $this->isProduction
            ? 'https://app.midtrans.com/snap/v1/transactions'
            : 'https://app.sandbox.midtrans.com/snap/v1/transactions';
    }

    protected function notificationBaseUrl(): string
    {
        return $this->isProduction
            ? 'https://api.midtrans.com/v2'
            : 'https://api.sandbox.midtrans.com/v2';
    }

    /**
     * Create a Snap token for the given order. Returns array with 'token' & 'redirect_url'.
     * In dev without keys, returns a stub token so UI flow can be tested.
     */
    public function createSnapToken(Order $order): array
    {
        $payload = [
            'transaction_details' => [
                'order_id'     => $order->order_number,
                'gross_amount' => $order->total,
            ],
            'customer_details' => [
                'first_name' => $order->recipient_name,
                'phone'      => $order->recipient_phone,
                'email'      => $order->user?->email,
            ],
            'item_details' => $order->items->map(fn ($i) => [
                'id'       => (string) $i->product_id,
                'price'    => $i->price_snapshot + $i->operational_cost_snapshot,
                'quantity' => $i->quantity,
                'name'     => mb_substr($i->product_name, 0, 50),
            ])->all(),
            'callbacks' => [
                'finish' => rtrim(env('FRONTEND_URL', 'http://localhost:3000'), '/').'/orders/'.$order->order_number,
            ],
            // Tampilkan semua metode pembayaran utama di popup Snap. Kalau ada
            // yang belum aktif di dashboard Midtrans, otomatis tidak muncul.
            // Hapus key ini bila kamu mau Snap pakai default-nya saja.
            'enabled_payments' => [
                // Virtual Account (transfer bank)
                'bca_va', 'bni_va', 'bri_va', 'permata_va', 'echannel', 'cimb_va', 'other_va',
                // E-wallet
                'gopay', 'shopeepay', 'qris',
                // Convenience store
                'indomaret', 'alfamart',
                // Kartu kredit / cicilan
                'credit_card',
                // Cardless / paylater
                'akulaku', 'kredivo',
                // Direct debit
                'bca_klikpay', 'bca_klikbca', 'bri_epay', 'cimb_clicks', 'danamon_online',
            ],
            // QRIS langsung tampil (bisa di-scan dari OVO, DANA, LinkAja, dll).
            'credit_card' => ['secure' => true],
        ];

        // Append shipping as an item so totals match.
        if ($order->shipping_cost > 0) {
            $payload['item_details'][] = [
                'id' => 'SHIP', 'price' => $order->shipping_cost, 'quantity' => 1, 'name' => 'Ongkir',
            ];
        }
        if ($order->discount > 0) {
            $payload['item_details'][] = [
                'id' => 'DISC', 'price' => -1 * $order->discount, 'quantity' => 1, 'name' => 'Diskon',
            ];
        }

        if (! $this->enabled()) {
            return [
                'token'        => 'dev-'.bin2hex(random_bytes(12)),
                'redirect_url' => null,
                'mock'         => true,
            ];
        }

        $res = Http::withBasicAuth($this->serverKey, '')
            ->acceptJson()
            ->post($this->baseUrl(), $payload)
            ->throw();

        return [
            'token'        => $res->json('token'),
            'redirect_url' => $res->json('redirect_url'),
        ];
    }

    /** Verify Midtrans signature key from notification payload. */
    public function verifySignature(array $payload): bool
    {
        if (! $this->enabled()) return true; // dev mode

        $expected = hash('sha512',
            $payload['order_id']
            . $payload['status_code']
            . $payload['gross_amount']
            . $this->serverKey
        );
        return hash_equals($expected, (string) ($payload['signature_key'] ?? ''));
    }

    public function fetchStatus(string $orderId): array
    {
        if (! $this->enabled()) return ['transaction_status' => 'settlement'];
        return Http::withBasicAuth($this->serverKey, '')
            ->acceptJson()
            ->get($this->notificationBaseUrl()."/{$orderId}/status")
            ->json() ?? [];
    }
}
