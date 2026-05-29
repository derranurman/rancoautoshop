'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import type { Order } from '@/lib/types';
import { OrderTimeline } from '@/components/OrderTimeline';
import { PackageTracker } from '@/components/PackageTracker';
import { courierLabel } from '@/lib/couriers';

const NEXT_STATUS: Record<string, string[]> = {
  // Untuk COD, izinkan pending → packed langsung (admin tidak perlu confirm
  // payment dulu karena pembayaran terjadi saat barang sampai). Frontend pakai
  // `payment_method === 'cod'` untuk men-overlay opsi tambahan ini.
  pending:               ['paid', 'cancelled'],
  awaiting_verification: ['paid', 'pending', 'cancelled'],
  paid:                  ['packed', 'cancelled'],
  packed:                ['shipped'],
  shipped:               ['delivered'],
  delivered:             [],
  cancelled:             [],
};

/** Untuk order COD, transisi pending → packed langsung diizinkan. */
const COD_NEXT_STATUS: Record<string, string[]> = {
  ...NEXT_STATUS,
  pending: ['packed', 'cancelled'],
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu Pembayaran',
  awaiting_verification: 'Menunggu Verifikasi Admin',
  paid: 'Dibayar', packed: 'Dikemas',
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
  // Reject pembayaran manual: kotak alasan + busy state.
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

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

  async function approvePayment() {
    if (!confirm('Setujui pembayaran transfer manual ini? Pesanan akan langsung berstatus DIBAYAR.')) return;
    setBusy(true);
    try {
      const r = await api.post(`/admin/orders/${id}/approve-payment`);
      setOrder(r.data.data);
      toast.success('Pembayaran disetujui.');
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  }

  async function rejectPayment() {
    if (!rejectReason.trim()) {
      toast.error('Isi dulu alasan penolakan supaya pelanggan tahu apa yang harus diperbaiki.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post(`/admin/orders/${id}/reject-payment`, { reason: rejectReason.trim() });
      setOrder(r.data.data);
      setRejectReason('');
      setShowRejectForm(false);
      toast.success('Bukti ditolak. Pelanggan diminta upload ulang.');
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  }

  if (!order) return <div className="text-gray-500">Memuat...</div>;

  const transitions = (order.payment_method === 'cod'
    ? COD_NEXT_STATUS[order.status]
    : NEXT_STATUS[order.status]) ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">Order {order.order_number}</h1>
        <a
          href={`/admin/orders/${id}/label`}
          target="_blank"
          rel="noreferrer"
          className="btn-outline text-sm"
          title="Buka halaman label pengiriman, lalu Cetak (Ctrl/Cmd + P) atau Save as PDF"
        >
          Cetak Label
        </a>
      </div>

      <div className="card p-4 text-sm space-y-1">
        <div className="flex justify-between">
          <span>Status saat ini</span>
          <b>{STATUS_LABEL[order.status] ?? order.status}</b>
        </div>
        <div className="flex justify-between">
          <span>Metode Pembayaran</span>
          <span className={[
            'text-xs font-semibold uppercase tracking-wide rounded px-2 py-0.5',
            order.payment_method === 'cod' ? 'bg-amber-100 text-amber-800' :
            order.payment_method === 'manual_transfer' ? 'bg-blue-100 text-blue-800' :
            'bg-gray-100 text-gray-700',
          ].join(' ')}>
            {order.payment_method === 'cod' ? 'COD'
              : order.payment_method === 'manual_transfer' ? 'Transfer Manual'
              : 'Midtrans'}
          </span>
        </div>
        <div className="flex justify-between"><span>Penerima</span><span>{order.recipient_name} — {order.recipient_phone}</span></div>
        <div className="whitespace-pre-line text-gray-600">{order.shipping_address}</div>
        {order.tracking_number && (
          <div className="pt-1">Resi: <span className="font-mono">{order.tracking_number}</span> ({courierLabel(order.courier)} {order.courier_service})</div>
        )}
      </div>

      {/* Lacak paket — admin pun bisa langsung membuka halaman pelacakan
          kurir dari sini untuk verifikasi resi yang baru dimasukkan. */}
      <PackageTracker
        courier={order.courier}
        service={order.courier_service}
        trackingNumber={order.tracking_number}
      />

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
              <span>
                {it.product_name}
                {it.variant_name && (
                  <span className="text-gray-500"> — {it.variant_name}</span>
                )}
                {it.variant_sku && (
                  <span className="text-xs text-gray-400 ml-1">({it.variant_sku})</span>
                )}
                {' '}× {it.quantity}
              </span>
              <span>{formatRupiah(it.subtotal)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 mt-2 pt-2 flex justify-between font-bold">
          <span>Total</span><span>{formatRupiah(order.total)}</span>
        </div>
      </div>

      {/* -------- Manual transfer: lihat & verifikasi bukti -------- */}
      {order.payment_method === 'manual_transfer' && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold">Pembayaran Transfer Manual</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">
              {order.payment_verified_at
                ? `Diverifikasi ${new Date(order.payment_verified_at).toLocaleString('id-ID')}`
                : order.payment_proof_uploaded_at
                  ? `Bukti masuk ${new Date(order.payment_proof_uploaded_at).toLocaleString('id-ID')}`
                  : 'Menunggu bukti'}
            </span>
          </div>

          {order.payment_rejection_reason && (
            <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-800">
              <b>Alasan penolakan terakhir:</b> {order.payment_rejection_reason}
            </div>
          )}

          {order.payment_proof_url ? (
            <a href={order.payment_proof_url} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={order.payment_proof_url}
                alt="Bukti transfer"
                className="max-h-72 rounded-lg border border-gray-200 mx-auto bg-gray-50"
              />
              <div className="text-center text-xs text-gray-500 mt-1">
                Klik untuk buka di tab baru
              </div>
            </a>
          ) : (
            <div className="text-sm text-gray-500 italic">
              Pelanggan belum mengunggah bukti transfer.
            </div>
          )}

          {order.status === 'awaiting_verification' && order.payment_proof_url && (
            <div className="border-t border-gray-100 pt-3 space-y-2">
              {!showRejectForm ? (
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={approvePayment}
                    disabled={busy}
                    className="btn-primary disabled:opacity-50"
                  >
                    Setujui &amp; Tandai Dibayar
                  </button>
                  <button
                    onClick={() => setShowRejectForm(true)}
                    disabled={busy}
                    className="btn-outline text-red-600 border-red-300"
                  >
                    Tolak Bukti
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="label">Alasan penolakan (akan dilihat pelanggan)</label>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Cth: Nominal kurang Rp 5.000 / Bukti tidak terbaca / Atas nama tidak sesuai"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    maxLength={500}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={rejectPayment}
                      disabled={busy || !rejectReason.trim()}
                      className="btn-primary bg-red-600 disabled:opacity-50"
                    >
                      {busy ? 'Memproses...' : 'Kirim Penolakan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowRejectForm(false); setRejectReason(''); }}
                      className="btn-outline"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card p-4 space-y-3">
        <h2 className="font-semibold">Update Status</h2>
        <div>
          <label className="label">Nomor Resi ({courierLabel(order.courier)} {order.courier_service})</label>
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
