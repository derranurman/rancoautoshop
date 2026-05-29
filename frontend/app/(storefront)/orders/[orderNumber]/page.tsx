'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import { paySnap } from '@/lib/midtrans';
import type { BankAccountInfo, Order } from '@/lib/types';
import { OrderTimeline } from '@/components/OrderTimeline';
import { PackageTracker } from '@/components/PackageTracker';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Menunggu Pembayaran',
  awaiting_verification: 'Menunggu Verifikasi Admin',
  paid: 'Dibayar', packed: 'Dikemas',
  shipped: 'Dikirim', delivered: 'Selesai', cancelled: 'Dibatalkan',
};

const ACCEPTED_PROOF = 'image/jpeg,image/png,image/webp';
const MAX_PROOF_BYTES = 4 * 1024 * 1024; // 4 MB — must match backend

export default function OrderDetailPage() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [bankInfo, setBankInfo] = useState<BankAccountInfo | null>(null);
  const [paying, setPaying] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const proofInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const r = await api.get(`/orders/${orderNumber}`);
    setOrder(r.data.data);
    setBankInfo((r.data.bank_account ?? null) as BankAccountInfo | null);
    return r.data.data as Order;
  }

  /**
   * Pull the latest payment status from Midtrans into our backend, then
   * refresh the local UI. Hanya untuk order Midtrans — order transfer manual
   * tidak akan menelpon endpoint ini supaya kita tidak buang-buang request.
   */
  async function sync(): Promise<Order | null> {
    try {
      const r = await api.post(`/orders/${orderNumber}/sync-status`);
      const fresh = r.data?.data as Order | undefined;
      if (fresh) {
        setOrder(fresh);
        if (r.data?.changed && fresh.status === 'paid') {
          toast.success('Pembayaran terkonfirmasi');
        }
        return fresh;
      }
    } catch {
      /* ignore — sync is best-effort */
    }
    return null;
  }

  // Initial load + sync once on mount (Midtrans only).
  useEffect(() => {
    (async () => {
      const o = await load();
      if (o.status === 'pending'
          && o.payment_method !== 'manual_transfer'
          && o.payment_method !== 'cod') {
        await sync();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  // Polling: hanya untuk order Midtrans yang masih pending.
  // Order manual_transfer ditangani admin manual → tidak perlu polling.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const isMidtransPending = order
      && order.status === 'pending'
      && order.payment_method !== 'manual_transfer'
      && order.payment_method !== 'cod';
    if (!isMidtransPending) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    let ticks = 0;
    pollRef.current = setInterval(async () => {
      ticks += 1;
      const fresh = await sync();
      if ((fresh && fresh.status !== 'pending') || ticks >= 24) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 5000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status, order?.payment_method]);

  async function cancel() {
    if (!confirm('Batalkan pesanan ini?')) return;
    try {
      const r = await api.post(`/orders/${orderNumber}/cancel`);
      setOrder(r.data.data);
      toast.success('Pesanan dibatalkan');
    } catch (e) { toast.error(apiError(e)); }
  }

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
        onSuccess: async () => { await sync(); },
        onPending: async () => {
          toast('Menunggu konfirmasi pembayaran...');
          await sync();
        },
        onError:   () => toast.error('Pembayaran gagal'),
        onClose:   async () => { await sync(); },
      });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setPaying(false);
    }
  }

  /** Upload bukti transfer manual. */
  async function uploadProof(file: File) {
    if (!ACCEPTED_PROOF.split(',').includes(file.type)) {
      toast.error('Format harus JPG/PNG/WEBP');
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      toast.error('Ukuran maks. 4 MB');
      return;
    }
    setUploadingProof(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await api.post(`/orders/${orderNumber}/payment-proof`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setOrder(r.data.data as Order);
      toast.success('Bukti transfer terkirim. Menunggu verifikasi admin.');
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setUploadingProof(false);
    }
  }

  function pickProof() {
    proofInputRef.current?.click();
  }
  function copyToClipboard(text: string, label: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => toast.success(`${label} disalin`))
        .catch(() => toast.error('Gagal menyalin'));
    }
  }

  if (!order) return <div className="max-w-3xl mx-auto px-4 py-10 text-gray-500">Memuat...</div>;

  const isManualTransfer = order.payment_method === 'manual_transfer';
  const isCOD = order.payment_method === 'cod';
  const isPending = order.status === 'pending';
  const isAwaitingVerification = order.status === 'awaiting_verification';
  const canCancel = isPending || isAwaitingVerification;

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
            <div className="font-semibold text-brand">{STATUS_LABEL[order.status] ?? order.status}</div>
          </div>
        </div>
        {order.tracking_number && (
          <div className="mt-3 text-sm">
            Resi: <span className="font-mono">{order.tracking_number}</span>{' '}
            ({order.courier?.toUpperCase()} {order.courier_service})
          </div>
        )}
      </div>

      <PackageTracker
        courier={order.courier}
        service={order.courier_service}
        trackingNumber={order.tracking_number}
      />

      {/* -------- Midtrans CTA (hanya untuk order pembayaran online) -------- */}
      {!isManualTransfer && !isCOD && isPending && (
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
            <div className="flex gap-2 whitespace-nowrap">
              <button onClick={() => sync()} className="btn-outline disabled:opacity-50" disabled={paying}>
                Cek Status
              </button>
              <button onClick={payNow} disabled={paying} className="btn-primary disabled:opacity-50">
                {paying ? 'Memuat...' : 'Bayar Sekarang'}
              </button>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Total yang harus dibayar: <b>{formatRupiah(order.total)}</b>
            <span className="ml-2">· Status diperiksa otomatis tiap 5 detik.</span>
          </div>
        </div>
      )}

      {/* -------- COD: info & ekspektasi pembayaran -------- */}
      {isCOD && isPending && (
        <div className="card p-4 border-amber-300 bg-amber-50 space-y-2">
          <div>
            <div className="font-semibold text-amber-900">Pesanan Bayar di Tempat (COD)</div>
            <div className="text-sm text-amber-800">
              Pembayaran tunai sebesar <b>{formatRupiah(order.total)}</b> dilakukan
              langsung ke kurir saat barang sampai. Tidak perlu transfer.
            </div>
          </div>
          <div className="text-xs text-amber-800/80 bg-white/60 rounded p-2">
            Pastikan ada penerima di alamat tujuan dan siapkan uang pas. Kalau alamat
            salah atau kurir tidak bisa menemui penerima, pesanan COD dapat
            dibatalkan/dikembalikan oleh kurir.
          </div>
        </div>
      )}

      {/* -------- Manual transfer: info rekening + upload bukti -------- */}
      {isManualTransfer && (isPending || isAwaitingVerification) && (
        <div className="card p-4 border-brand/40 bg-brand/5 space-y-3">
          <div>
            <div className="font-semibold">Pembayaran via Transfer Bank Manual</div>
            <div className="text-sm text-gray-600">
              Total yang harus ditransfer: <b>{formatRupiah(order.total)}</b>
            </div>
          </div>

          {bankInfo?.enabled && bankInfo.account_number ? (
            <div className="rounded-lg bg-white p-3 border border-gray-200 space-y-1">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Transfer ke</div>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-semibold text-lg">{bankInfo.bank_name}</div>
                {bankInfo.branch && (
                  <div className="text-xs text-gray-500">Cabang {bankInfo.branch}</div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xl font-bold tracking-wider">
                  {bankInfo.account_number}
                </span>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => copyToClipboard(bankInfo.account_number ?? '', 'Nomor rekening')}
                >
                  Salin
                </button>
              </div>
              {bankInfo.account_holder && (
                <div className="text-sm text-gray-700">a.n. <b>{bankInfo.account_holder}</b></div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-gray-500">Nominal:</span>
                <span className="font-semibold">{formatRupiah(order.total)}</span>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => copyToClipboard(String(order.total), 'Nominal')}
                >
                  Salin
                </button>
              </div>
              {bankInfo.note && (
                <div className="text-xs text-gray-600 whitespace-pre-line pt-1 border-t border-gray-100 mt-2">
                  {bankInfo.note}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
              Info rekening tidak tersedia. Silakan hubungi admin untuk konfirmasi.
            </div>
          )}

          {/* Tampilkan alasan reject sebelum upload ulang */}
          {order.payment_rejection_reason && isPending && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              <div className="font-semibold">Bukti sebelumnya ditolak admin</div>
              <div className="mt-1">{order.payment_rejection_reason}</div>
              <div className="text-xs mt-1">Silakan transfer ulang &amp; unggah bukti baru.</div>
            </div>
          )}

          <div>
            {isAwaitingVerification ? (
              <div className="space-y-2">
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                  <div className="font-semibold">Bukti transfer terkirim</div>
                  <div className="mt-1">
                    Menunggu admin memverifikasi pembayaranmu. Kamu akan menerima
                    notifikasi setelah dikonfirmasi (biasanya kurang dari 1 hari kerja).
                  </div>
                </div>
                {order.payment_proof_url && (
                  <a
                    href={order.payment_proof_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={order.payment_proof_url}
                      alt="Bukti transfer"
                      className="max-h-64 rounded-lg border border-gray-200 mx-auto"
                    />
                  </a>
                )}
                <button
                  type="button"
                  onClick={pickProof}
                  disabled={uploadingProof}
                  className="btn-outline w-full disabled:opacity-50"
                >
                  {uploadingProof ? 'Mengunggah...' : 'Unggah Ulang Bukti Transfer'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={pickProof}
                disabled={uploadingProof}
                className="btn-primary w-full disabled:opacity-50"
              >
                {uploadingProof ? 'Mengunggah...' : 'Unggah Bukti Transfer'}
              </button>
            )}
            <input
              ref={proofInputRef}
              type="file"
              accept={ACCEPTED_PROOF}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadProof(f);
                e.target.value = '';
              }}
            />
            <div className="text-xs text-gray-500 mt-1">
              JPG/PNG/WEBP, maks. 4 MB. Pastikan nominal &amp; nomor rekening tujuan terlihat jelas.
            </div>
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
                <div className="font-medium">
                  {it.product_name}
                  {it.variant_name && (
                    <span className="text-gray-500"> — {it.variant_name}</span>
                  )}
                </div>
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

      {canCancel && (
        <button onClick={cancel} className="btn-outline text-red-600 border-red-300 w-full">
          Batalkan Pesanan
        </button>
      )}
    </div>
  );
}
