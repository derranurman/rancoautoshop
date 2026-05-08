'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import type { Order } from '@/lib/types';

const NEXT_STATUS: Record<string, string[]> = {
  pending:   ['paid', 'cancelled'],
  paid:      ['packed', 'cancelled'],
  packed:    ['shipped'],
  shipped:   ['delivered'],
  delivered: [],
  cancelled: [],
};

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [tracking, setTracking] = useState('');

  async function load() {
    const r = await api.get(`/admin/orders/${id}`);
    setOrder(r.data.data);
    setTracking(r.data.data.tracking_number ?? '');
  }
  useEffect(() => { load(); }, [id]);

  async function update(status: string) {
    try {
      await api.patch(`/admin/orders/${id}/status`, { status, tracking_number: tracking || null });
      toast.success('Status diperbarui'); load();
    } catch (e) { toast.error(apiError(e)); }
  }

  if (!order) return <div className="text-gray-500">Memuat...</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Order {order.order_number}</h1>
      <div className="card p-4 text-sm space-y-1">
        <div className="flex justify-between"><span>Status saat ini</span><b>{order.status}</b></div>
        <div className="flex justify-between"><span>Penerima</span><span>{order.recipient_name} — {order.recipient_phone}</span></div>
        <div className="whitespace-pre-line text-gray-600">{order.shipping_address}</div>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-2">Barang</h2>
        <div className="divide-y divide-gray-100">
          {order.items?.map((it) => (
            <div key={it.id} className="py-2 flex justify-between text-sm">
              <span>{it.product_name} × {it.quantity}</span>
              <span>{formatRupiah(it.subtotal)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between font-bold">
          <span>Total</span><span>{formatRupiah(order.total)}</span>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <h2 className="font-semibold">Update Status</h2>
        <div>
          <label className="label">Nomor Resi ({order.courier?.toUpperCase()} {order.courier_service})</label>
          <input className="input" placeholder="Masukkan no resi kurir" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(NEXT_STATUS[order.status] ?? []).map((s) => (
            <button key={s} className="btn-primary" onClick={() => update(s)}>
              Set {s}
            </button>
          ))}
          {(NEXT_STATUS[order.status]?.length ?? 0) === 0 && <span className="text-sm text-gray-500">Tidak ada transisi tersedia.</span>}
        </div>
      </div>
    </div>
  );
}
