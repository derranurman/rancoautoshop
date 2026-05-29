'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, formatRupiah } from '@/lib/api';
import { useAdminAuth } from '@/lib/stores';
import type { Order, SiteSettingsAdmin } from '@/lib/types';
import { AwbBarcode } from '@/components/AwbBarcode';

/** Mapping warna brand kurir untuk box AWB di label. Pakai warna yang dekat
 *  dengan brand asli supaya kurir mudah recognize saat scanning. */
const COURIER_BRAND: Record<string, { bg: string; text: string; label: string }> = {
  jne: { bg: '#d40000', text: '#ffffff', label: 'JNE' },
  jnt: { bg: '#ed1c24', text: '#ffffff', label: 'J&T EXPRESS' },
  pos: { bg: '#f57c00', text: '#ffffff', label: 'POS INDONESIA' },
  tiki:{ bg: '#1d4ed8', text: '#ffffff', label: 'TIKI' },
  sicepat: { bg: '#e11d48', text: '#ffffff', label: 'SICEPAT' },
  anteraja:{ bg: '#0ea5e9', text: '#ffffff', label: 'ANTERAJA' },
};

/**
 * Label pengiriman printable.
 *
 * Diletakkan DI LUAR layout `(dashboard)` (sengaja di route `/admin/orders/[id]/label`,
 * BUKAN `/admin/(dashboard)/orders/...`) supaya tidak terbawa sidebar admin saat
 * dicetak. Halaman ini full-bleed dengan `@media print` rule untuk menyembunyikan
 * tombol kontrol & ringkasan; admin tinggal tekan Ctrl/Cmd+P → Save as PDF.
 *
 * Kita SENGAJA tidak pakai library PDF di backend (mis. dompdf) — pendekatan
 * "browser print-to-PDF" lebih simpel:
 *   - Tidak perlu composer install package baru di production.
 *   - Admin bisa preview persis seperti hasil cetaknya.
 *   - Save as PDF (Chrome/Edge/Firefox) menghasilkan file rapi & bisa dibagi.
 *
 * Format label: ukuran A6 (105×148mm) — standar termal printer & cocok untuk
 * sticker AWB. Konten:
 *   - Pengirim (dari SiteSetting `sender_*`)
 *   - Penerima (dari order)
 *   - Order number, kurir, layanan, no resi, total berat
 *   - Daftar barang (ringkas)
 *   - Badge COD prominent kalau metode pembayaran = cod
 *   - Total bayar + tanda "BAYAR DI TEMPAT" untuk COD
 */
export default function ShippingLabelPage() {
  const { id } = useParams<{ id: string }>();
  const { admin, loading, loadMe } = useAdminAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [settings, setSettings] = useState<SiteSettingsAdmin | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => { loadMe(); }, [loadMe]);

  useEffect(() => {
    if (!admin) return;
    Promise.all([
      api.get(`/admin/orders/${id}`),
      api.get('/admin/site-settings'),
    ])
      .then(([o, s]) => {
        setOrder(o.data.data as Order);
        setSettings(s.data.data as SiteSettingsAdmin);
      })
      .catch((e) => setErrorMsg(e?.response?.data?.message ?? 'Gagal memuat data label.'));
  }, [id, admin]);

  if (loading) return <div className="p-6 text-gray-500">Memuat...</div>;
  if (!admin) return <div className="p-6 text-red-600">Akses ditolak.</div>;
  if (errorMsg) return <div className="p-6 text-red-600">{errorMsg}</div>;
  if (!order || !settings) return <div className="p-6 text-gray-500">Memuat data label...</div>;

  const isCOD = order.payment_method === 'cod';
  const totalWeightGr = (order.items ?? []).reduce(
    (sum, it) => sum + (it.quantity * 1000), // approx — order tidak simpan berat per item
    0,
  );
  const courierKey = (order.courier ?? '').toLowerCase();
  const brand = COURIER_BRAND[courierKey] ?? { bg: '#111827', text: '#ffffff', label: courierKey.toUpperCase() || 'KURIR' };
  const hasResi = !!(order.tracking_number && order.tracking_number.trim().length > 0);
  // Berat per item tidak di-snapshot (hanya order.shipping_cost). Kita pakai
  // kalkulasi konservatif: jumlah qty × 1000g, ATAU kalau ada di product berat
  // sebenarnya, tapi karena kita hanya punya snapshot order_items, pakai default.
  // Admin bisa edit langsung di printout.

  return (
    <>
      {/* Print-only stylesheet. `@page` set ukuran kertas ke A6 supaya hasil
          cetak rapi di printer thermal yang umum dipakai shopee/jne label. */}
      <style jsx global>{`
        @page {
          size: A6;
          margin: 4mm;
        }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .label-page { box-shadow: none !important; margin: 0 !important; }
        }
        .label-page {
          background: white;
        }
      `}</style>

      <div className="min-h-screen bg-gray-100 print:bg-white py-6 print:py-0">
        {/* Toolbar — disembunyikan saat print. */}
        <div className="no-print max-w-2xl mx-auto mb-4 px-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold">Label Pengiriman — {order.order_number}</h1>
            <p className="text-xs text-gray-500">
              Tekan <kbd className="px-1 py-0.5 border border-gray-300 rounded">Ctrl</kbd>+<kbd className="px-1 py-0.5 border border-gray-300 rounded">P</kbd> (atau Cmd+P di Mac), pilih &ldquo;Save as PDF&rdquo;,
              lalu cetak ke printer thermal A6.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-primary"
          >
            Cetak / Save PDF
          </button>
        </div>

        <div className="label-page max-w-2xl mx-auto bg-white shadow border border-gray-200 print:border-0 print:shadow-none rounded-lg overflow-hidden">
          {/* Header */}
          <div className="border-b-2 border-black px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {settings.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.logo_url} alt="" className="h-8 w-8 object-contain" />
              ) : null}
              <div>
                <div className="font-bold text-sm leading-tight">{settings.app_name}</div>
                <div className="text-[10px] text-gray-500 leading-tight">
                  {settings.sender_phone ?? ''}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-xs">{order.order_number}</div>
              <div className="text-[10px] text-gray-500">
                {new Date(order.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            </div>
          </div>

          {/* COD banner — sangat prominent supaya kurir tidak skip pengambilan tunai. */}
          {isCOD && (
            <div className="bg-amber-100 border-b-2 border-amber-500 px-4 py-2 text-center">
              <div className="font-extrabold text-base text-amber-900 tracking-wide">
                COD — BAYAR DI TEMPAT
              </div>
              <div className="text-xs text-amber-900">
                Kurir wajib menerima pembayaran tunai sebesar:
              </div>
              <div className="text-2xl font-extrabold text-amber-900 mt-1 tabular-nums">
                {formatRupiah(order.total)}
              </div>
            </div>
          )}

          {/* Pengirim & Penerima */}
          <div className="grid grid-cols-2 divide-x divide-gray-300">
            <div className="p-3 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Pengirim</div>
              <div className="font-bold mt-1">{settings.sender_name ?? settings.app_name}</div>
              {settings.sender_phone && <div>{settings.sender_phone}</div>}
              {settings.sender_address && (
                <div className="whitespace-pre-line text-gray-700">{settings.sender_address}</div>
              )}
              {(settings.sender_city || settings.sender_postal_code) && (
                <div className="text-gray-700">
                  {settings.sender_city}{settings.sender_postal_code ? ` ${settings.sender_postal_code}` : ''}
                </div>
              )}
              {(!settings.sender_name && !settings.sender_address) && (
                <div className="mt-1 text-[10px] text-amber-700">
                  ⚠ Lengkapi alamat pengirim di Pengaturan Tampilan.
                </div>
              )}
            </div>
            <div className="p-3 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Kepada</div>
              <div className="font-bold mt-1">{order.recipient_name}</div>
              <div>{order.recipient_phone}</div>
              <div className="whitespace-pre-line text-gray-700 leading-snug">
                {order.shipping_address}
              </div>
            </div>
          </div>

          {/* AWB / Resi — section paling prominent, persis seperti label kurir
              asli. Box berwarna brand kurir + barcode Code-128 yang bisa
              di-scan langsung saat sortir di hub kurir. Kalau resi belum
              di-input, banner kuning "BELUM ADA RESI" muncul supaya admin
              tidak tidak sengaja print label kosong. */}
          <div className="border-t-2 border-black">
            {hasResi ? (
              <div className="px-4 py-3" style={{ background: brand.bg, color: brand.text }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] uppercase tracking-widest opacity-80">
                    Air Waybill ({brand.label})
                  </div>
                  <div className="text-[10px] uppercase tracking-wide opacity-80">
                    Layanan: <b>{order.courier_service}</b>
                  </div>
                </div>
                <div className="font-mono font-extrabold tracking-wider text-2xl mt-1 leading-tight">
                  {order.tracking_number}
                </div>
                {/* Barcode di atas background putih supaya scanner bisa baca
                    kontras hitam-putih dengan benar. */}
                <div className="mt-2 bg-white rounded p-2 flex items-center justify-center">
                  <AwbBarcode value={order.tracking_number ?? ''} height={56} fontSize={12} />
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 bg-yellow-100 border-y-2 border-yellow-500">
                <div className="text-[10px] uppercase tracking-widest text-yellow-900 font-semibold">
                  Air Waybill ({brand.label})
                </div>
                <div className="font-bold text-yellow-900 text-base mt-1">
                  ⚠ Resi belum diisi
                </div>
                <div className="text-xs text-yellow-900">
                  Pesan jemputan ke kurir, dapat nomor resi (cth: <span className="font-mono">JX9481926078</span>),
                  lalu input di halaman pesanan admin sebelum cetak ulang.
                </div>
              </div>
            )}
          </div>

          {/* Kurir & berat (resi sudah ditampilkan di section AWB di atas) */}
          <div className="border-t border-gray-300 px-4 py-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Kurir</div>
              <div className="font-bold">{brand.label}</div>
              <div className="text-gray-700">{order.courier_service}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Berat</div>
              <div className="font-bold">{(totalWeightGr / 1000).toFixed(1)} kg</div>
            </div>
          </div>

          {/* Daftar Barang ringkas */}
          <div className="border-t border-gray-300 px-4 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Isi Paket</div>
            <ul className="mt-1 space-y-0.5">
              {(order.items ?? []).map((it) => (
                <li key={it.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {it.product_name}
                    {it.variant_name && <span className="text-gray-600"> — {it.variant_name}</span>}
                  </span>
                  <span className="shrink-0 font-mono">×{it.quantity}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer total */}
          <div className="border-t-2 border-black px-4 py-2 grid grid-cols-2 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Total Belanja</div>
              <div className="font-bold">{formatRupiah(order.total)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Pembayaran</div>
              <div className="font-bold">
                {isCOD
                  ? <span className="text-amber-700">COD — Bayar di Tempat</span>
                  : order.payment_method === 'manual_transfer'
                    ? 'Transfer Manual'
                    : 'Lunas (Online)'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
