'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import type { Order } from '@/lib/types';
import { OrderTimeline } from '@/components/OrderTimeline';

const NEXT_STATUS: Record<string, string[]> = {
  pending:   ['paid', 'cancelled'],
  paid:      ['packed', 'cancelled'],
  packed:    ['shipped'],
  shipped:   ['delivered'],
  delivered: [],
  cancelled: [],
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu Pembayaran', paid: 'Dibayar', packed: 'Dikemas',
  shipped: 'Dikirim', delivered: 'Selesai', cancelled: 'Dibatalkan',
};

export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [tracking, setTracking] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [statusLocation, setStatusLocation] = useState('');
  const [eventNote, setEventNote] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api.get(`/admin/orders/${id}`);
    setOrder(r.data.data);
    setTracking(r.data.data.tracking_number ?? '');
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function update(status: string) {
    setBusy(true);
    try {
      const r = await api.patch(`/admin/orders/${id}/status`, {
        status,
        tracking_number: tracking || null,
        note: statusNote || null,
        location: statusLocation || null,
      });
      setOrder(r.data.data);
      setStatusNote('');
      setStatusLocation('');
      toast.success('Status diperbarui');
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  }

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!eventNote.trim()) return;
    setBusy(true);
    try {
      const r = await api.post(`/admin/orders/${id}/tracking`, {
        note: eventNote.trim(),
        location: eventLocation || null,
      });
      setOrder(r.data.data);
      setEventNote('');
      setEventLocation('');
      toast.success('Catatan pelacakan ditambahkan');
    } catch (err) {
      toast.error(apiError(err));
    } finally { setBusy(false); }
  }

  if (!order) return <div className="text-gray-500">Memuat...</div>;

  const transitions = NEXT_STATUS[order.status] ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Order {order.order_number}</h1>

      <div className="card p-4 text-sm space-y-1">
        <div className="flex justify-between"><span>Status saat ini</span><b>{STATUS_LABEL[order.status] ?? order.status}</b></div>
        <div className="flex justify-between"><span>Penerima</span><span>{order.recipient_name} — {order.recipient_phone}</span></div>
        <div className="whitespace-pre-line text-gray-600">{order.shipping_address}</div>
        {order.tracking_number && (
          <div className="pt-1">Resi: <span className="font-mono">{order.tracking_number}</span> ({order.courier?.toUpperCase()} {order.courier_service})</div>
        )}
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Riwayat Pelacakan</h2>
          <button onClick={load} className="text-xs text-brand hover:underline">Refresh</button>
        </div>
        <OrderTimeline events={order.timeline ?? order.tracking_events} />
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
          <input className="input" placeholder="Masukkan no resi kurir" value={tracking}
                 onChange={(e) => setTracking(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Catatan untuk pelanggan (opsional)</label>
            <input className="input" placeholder="Contoh: Pesanan dikirim via JNE REG"
                   value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
          </div>
          <div>
            <label className="label">Lokasi (opsional)</label>
            <input className="input" placeholder="Contoh: Gudang Jakarta"
                   value={statusLocation} onChange={(e) => setStatusLocation(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {transitions.map((s) => (
            <button key={s} className="btn-primary disabled:opacity-50"
                    disabled={busy} onClick={() => update(s)}>
              Set {STATUS_LABEL[s] ?? s}
            </button>
          ))}
          {transitions.length === 0 && (
            <span className="text-sm text-gray-500">Tidak ada transisi tersedia.</span>
          )}
        </div>
      </div>

      <form onSubmit={addEvent} className="card p-4 space-y-3">
        <h2 className="font-semibold">Tambah Catatan Pelacakan</h2>
        <p className="text-xs text-gray-500">
          Gunakan untuk update tanpa mengubah status pesanan, mis. &ldquo;Paket transit di Cikarang&rdquo;
          atau &ldquo;Kurir mencoba pengiriman, alamat kosong&rdquo;.
        </p>
        <div>
          <label className="label">Catatan</label>
          <textarea className="input min-h-[80px]" required value={eventNote}
                    onChange={(e) => setEventNote(e.target.value)} />
        </div>
        <div>
          <label className="label">Lokasi (opsional)</label>
          <input className="input" placeholder="Contoh: Hub Bandung"
                 value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary disabled:opacity-50" disabled={busy || !eventNote.trim()}>
          Tambahkan ke Riwayat
        </button>
      </form>
    </div>
  );
}
