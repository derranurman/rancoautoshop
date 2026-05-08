'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import type { Order } from '@/lib/types';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu Pembayaran', paid: 'Dibayar', packed: 'Dikemas',
  shipped: 'Dikirim', delivered: 'Selesai', cancelled: 'Dibatalkan',
};

export default function OrderDetailPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    api.get(`/orders/${orderNumber}`).then((r) => setOrder(r.data.data));
  }, [orderNumber]);

  async function cancel() {
    if (!confirm('Batalkan pesanan ini?')) return;
    try {
      const r = await api.post(`/orders/${orderNumber}/cancel`);
      setOrder(r.data.data);
      toast.success('Pesanan dibatalkan');
    } catch (e) { toast.error(apiError(e)); }
  }

  if (!order) return <div className="max-w-3xl mx-auto px-4 py-10 text-gray-500">Memuat...</div>;

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
          <div className="mt-3 text-sm">Resi: <span className="font-mono">{order.tracking_number}</span> ({order.courier?.toUpperCase()} {order.courier_service})</div>
        )}
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

      {order.status === 'pending' && (
        <button onClick={cancel} className="btn-outline text-red-600 border-red-300 w-full">
          Batalkan Pesanan
        </button>
      )}
    </div>
  );
}
