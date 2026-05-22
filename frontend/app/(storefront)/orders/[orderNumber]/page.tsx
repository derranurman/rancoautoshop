'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import { paySnap } from '@/lib/midtrans';
import type { Order } from '@/lib/types';
import { OrderTimeline } from '@/components/OrderTimeline';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu Pembayaran', paid: 'Dibayar', packed: 'Dikemas',
  shipped: 'Dikirim', delivered: 'Selesai', cancelled: 'Dibatalkan',
};

export default function OrderDetailPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [paying, setPaying] = useState(false);

  async function load() {
    const r = await api.get(`/orders/${orderNumber}`);
    setOrder(r.data.data);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderNumber]);

  async function cancel() {
    if (!confirm('Batalkan pesanan ini?')) return;
    try {
      const r = await api.post(`/orders/${orderNumber}/cancel`);
      setOrder(r.data.data);
      toast.success('Pesanan dibatalkan');
    } catch (e) { toast.error(apiError(e)); }
  }

  /**
   * Open the Midtrans Snap popup so the customer can pick a payment method
   * (BCA / Mandiri / BNI / Permata VA, GoPay, ShopeePay, OVO, DANA, QRIS,
   * Indomaret, Alfamart, kartu kredit, Akulaku, Kredivo, ...).
   * We always ask the backend for a fresh token via /repay to avoid expired ones.
   */
  async function payNow() {
    if (paying) return;
    setPaying(true);
    try {
      const r = await api.post(`/orders/${orderNumber}/repay`);
      const token: string | null = r.data.snap_token ?? null;
      const isMock: boolean = !!r.data.mock;

      if (!token) {
        toast.error('Token pembayaran tidak tersedia.');
        return;
      }

      if (isMock) {
        toast(
          'Mode demo: Midtrans belum dikonfigurasi. Set MIDTRANS_SERVER_KEY & '
          + 'NEXT_PUBLIC_MIDTRANS_CLIENT_KEY untuk popup pembayaran asli.',
          { duration: 6000 },
        );
        await load();
        return;
      }

      await paySnap(token, {
        onSuccess: async () => { toast.success('Pembayaran berhasil'); await load(); },
        onPending: async () => { toast('Menunggu konfirmasi pembayaran...'); await load(); },
        onError:   () => toast.error('Pembayaran gagal'),
        onClose:   async () => { await load(); },
      });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setPaying(false);
    }
  }

  if (!order) return <div className="max-w-3xl mx-auto px-4 py-10 text-gray-500">Memuat...</div>;

  const isPending = order.status === 'pending';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="card p-4">
        <div className="flex justify-between">
          <div>
            <div className="text-xs text-gray-500">No. Pesanan</div>
            <div className="font-bold">{order.order_number}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Status</div>
            <div className="font-semibold text-brand">{STATUS_LABEL[order.status]}</div>
          </div>
        </div>
        {order.tracking_number && (
          <div className="mt-3 text-sm">
            Resi: <span className="font-mono">{order.tracking_number}</span>{' '}
            ({order.courier?.toUpperCase()} {order.courier_service})
          </div>
        )}
      </div>

      {/* Big call-to-action so customers don't get stuck on "Menunggu Pembayaran".
          Picks BCA/Mandiri/BNI/Permata VA, GoPay/ShopeePay/OVO/DANA, QRIS, etc. */}
      {isPending && (
        <div className="card p-4 border-brand bg-brand/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Selesaikan pembayaranmu</div>
              <div className="text-sm text-gray-600">
                Pilih metode pembayaran: Transfer Bank (BCA, BNI, BRI, Mandiri, Permata),
                E-wallet (GoPay, ShopeePay, OVO, DANA), QRIS, Indomaret/Alfamart, kartu kredit,
                atau cicilan (Akulaku, Kredivo).
              </div>
            </div>
            <button onClick={payNow} disabled={paying}
                    className="btn-primary whitespace-nowrap disabled:opacity-50">
              {paying ? 'Memuat...' : 'Bayar Sekarang'}
            </button>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Total yang harus dibayar: <b>{formatRupiah(order.total)}</b>
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Lacak Pesanan</h2>
          <button onClick={load} className="text-xs text-brand hover:underline">Refresh</button>
        </div>
        <OrderTimeline events={order.timeline ?? order.tracking_events} />
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-2">Barang</h2>
        <div className="divide-y divide-gray-100">
          {order.items?.map((it) => (
            <div key={it.id} className="py-2 flex justify-between">
              <div>
                <div className="font-medium">{it.product_name}</div>
                <div className="text-xs text-gray-500">{it.quantity} × {formatRupiah(it.price_snapshot + it.operational_cost_snapshot)}</div>
              </div>
              <div>{formatRupiah(it.subtotal)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4 text-sm space-y-1">
        <div className="flex justify-between"><span>Subtotal</span><span>{formatRupiah(order.subtotal + order.operational_cost)}</span></div>
        <div className="flex justify-between"><span>Diskon</span><span>- {formatRupiah(order.discount)}</span></div>
        <div className="flex justify-between"><span>Ongkir</span><span>{formatRupiah(order.shipping_cost)}</span></div>
        <div className="flex justify-between font-bold border-t border-gray-100 pt-2 mt-2"><span>Total</span><span>{formatRupiah(order.total)}</span></div>
      </div>

      <div className="card p-4 text-sm">
        <h2 className="font-semibold mb-2">Alamat Pengiriman</h2>
        <div>{order.recipient_name} — {order.recipient_phone}</div>
        <div className="text-gray-600 whitespace-pre-line">{order.shipping_address}</div>
      </div>

      {isPending && (
        <button onClick={cancel} className="btn-outline text-red-600 border-red-300 w-full">
          Batalkan Pesanan
        </button>
      )}
    </div>
  );
}
