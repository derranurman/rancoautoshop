'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { api, apiError, formatRupiah } from '@/lib/api';
import type { Order } from '@/lib/types';

const STATUSES = ['', 'pending', 'awaiting_verification', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'];

/** Format ISO timestamp -> "dd/mm/yyyy hh:mm" lokal Indonesia. */
function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso ?? '';
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Bangun objek params yang akan dikirim ke API. Dipisah sebagai memo supaya
  // baik pemanggilan list maupun export memakai filter yang sama persis.
  const filterParams = useMemo(
    () => ({
      status: status || undefined,
      search: search || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [status, search, dateFrom, dateTo],
  );

  useEffect(() => {
    // Validasi ringan rentang tanggal — kalau salah, jangan request.
    if (dateFrom && dateTo && dateFrom > dateTo) return;

    setLoading(true);
    api.get('/admin/orders', { params: filterParams })
      .then((r) => setOrders(r.data.data ?? []))
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, [filterParams, dateFrom, dateTo]);

  function onResetFilter() {
    setStatus('');
    setSearch('');
    setDateFrom('');
    setDateTo('');
  }

  async function onExportExcel() {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast.error('Tanggal "Dari" tidak boleh setelah "Sampai".');
      return;
    }
    setExporting(true);
    try {
      // Ambil semua data yang cocok dengan filter (bukan hanya 1 halaman).
      const r = await api.get('/admin/orders', {
        params: { ...filterParams, all: 1 },
      });
      const rows = (r.data.data ?? []) as Order[];
      if (rows.length === 0) {
        toast.error('Tidak ada pesanan untuk diekspor.');
        return;
      }

      // Bentuk baris-baris flat siap-export; sengaja pakai header bahasa
      // Indonesia supaya admin tidak perlu translate ulang.
      const sheetRows = rows.map((o) => ({
        'No Order'        : o.order_number,
        'Tanggal'         : formatDateTime(o.created_at),
        'Status'          : o.status,
        'Nama Penerima'   : o.recipient_name,
        'No HP'           : o.recipient_phone,
        'Alamat'          : o.shipping_address,
        'Kurir'           : `${(o.courier ?? '').toUpperCase()} ${o.courier_service ?? ''}`.trim(),
        'No Resi'         : o.tracking_number ?? '',
        'Subtotal'        : o.subtotal,
        'Ongkir'          : o.shipping_cost,
        'Diskon'          : o.discount,
        'Total'           : o.total,
        'Voucher'         : o.voucher_code ?? '',
        'Tgl Bayar'       : formatDateTime(o.paid_at),
      }));

      // Pakai static import (lihat top-of-file). Sebelumnya pakai dynamic
      // import, tapi xlsx (SheetJS) di npm punya struktur ESM yang bikin
      // Next.js webpack gagal men-generate chunk URL — gejalanya error
      // "Loading chunk ... failed (.../_next/undefined)" saat klik tombol.
      // Bundle xlsx hanya termuat di halaman admin yang import dia, jadi
      // tidak mempengaruhi bundle storefront.
      const ws = XLSX.utils.json_to_sheet(sheetRows);
      // Auto-width kolom ringan (pakai panjang max isi tiap kolom).
      const headers = Object.keys(sheetRows[0]);
      ws['!cols'] = headers.map((h) => ({
        wch: Math.min(
          40,
          Math.max(
            h.length,
            ...sheetRows.map((row) => String(row[h as keyof typeof row] ?? '').length),
          ) + 2,
        ),
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Pesanan');

      const stamp = new Date().toISOString().slice(0, 10);
      const suffix = dateFrom || dateTo ? `_${dateFrom || '...'}_to_${dateTo || '...'}` : '';
      XLSX.writeFile(wb, `pesanan_${stamp}${suffix}.xlsx`);
      toast.success(`${rows.length} pesanan diekspor.`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setExporting(false);
    }
  }

  const dateInvalid = dateFrom && dateTo && dateFrom > dateTo;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Pesanan</h1>
        <button
          type="button"
          onClick={onExportExcel}
          disabled={exporting || loading || !!dateInvalid}
          className="btn-primary"
          title="Ekspor seluruh pesanan sesuai filter ke file Excel (.xlsx)"
        >
          {exporting ? 'Mengekspor...' : 'Export Excel'}
        </button>
      </div>

      <div className="card p-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px]">
          <label className="label">Cari</label>
          <input
            className="input"
            placeholder="No order / nama / resi"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'Semua status'}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Dari tanggal</label>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Sampai tanggal</label>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        {(search || status || dateFrom || dateTo) && (
          <button type="button" onClick={onResetFilter} className="btn-ghost">
            Reset
          </button>
        )}
        {dateInvalid && (
          <div className="basis-full text-xs text-red-600">
            Rentang tanggal tidak valid: tanggal &quot;Dari&quot; tidak boleh setelah &quot;Sampai&quot;.
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">No Order</th>
              <th className="px-3 py-2">Tanggal</th>
              <th className="px-3 py-2">Penerima</th>
              <th className="px-3 py-2">Kurir</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">Memuat data...</td></tr>
            )}
            {!loading && orders.map((o) => (
              <tr key={o.id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-mono">{o.order_number}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDateTime(o.created_at)}</td>
                <td className="px-3 py-2">{o.recipient_name}</td>
                <td className="px-3 py-2">{o.courier?.toUpperCase()} {o.courier_service}</td>
                <td className="px-3 py-2"><span className="chip bg-gray-100">{o.status}</span></td>
                <td className="px-3 py-2 text-right">{formatRupiah(o.total)}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/orders/${o.id}`} className="btn-outline">Detail</Link>
                </td>
              </tr>
            ))}
            {!loading && orders.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">Tidak ada pesanan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
