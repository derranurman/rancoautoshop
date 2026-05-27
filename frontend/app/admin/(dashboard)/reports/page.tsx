'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { api, apiError, formatRupiah } from '@/lib/api';

interface Row {
  date: string;             // ISO timestamp dari paid_at
  order_number: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  selling_price: number;    // qty × unit_price (harga jual baris)
  buyer_name: string | null;
  buyer_phone: string | null;
}

interface Meta {
  from: string;
  to: string;
  total_orders: number;
  total_revenue: number;
  total_quantity: number;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoNDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function ReportsPage() {
  // Default: 30 hari terakhir.
  const [from, setFrom] = useState<string>(isoNDaysAgo(29));
  const [to, setTo] = useState<string>(todayIso());
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Pencarian client-side: filter baris yang sudah dimuat berdasarkan
  // nama produk, nama pembeli, no HP, atau nomor order. Tidak perlu round-trip
  // ke server karena dataset laporan biasanya cukup kecil dan sudah di-load.
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await api.get('/admin/reports/sales', { params: { from, to } });
      setRows(r.data.data ?? []);
      setMeta(r.data.meta ?? null);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }

  // Initial load + reload on filter apply.
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onApply(e: React.FormEvent) {
    e.preventDefault();
    if (from && to && from > to) {
      toast.error('Tanggal "Dari" tidak boleh setelah tanggal "Sampai".');
      return;
    }
    load();
  }

  function onReset() {
    setFrom(isoNDaysAgo(29));
    setTo(todayIso());
    setSearch('');
    // give state a tick to settle then reload
    setTimeout(load, 0);
  }

  // Filter pencarian dijalankan di client (case-insensitive, multi-field).
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.product_name,
        r.buyer_name ?? '',
        r.buyer_phone ?? '',
        r.order_number,
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  // Ringkasan ikut menyesuaikan hasil pencarian — biar admin bisa cek
  // omset untuk produk/pembeli tertentu tanpa hitung manual.
  const visibleSummary = useMemo(() => {
    const totalQty = filteredRows.reduce((s, r) => s + (r.quantity || 0), 0);
    const totalRev = filteredRows.reduce((s, r) => s + (r.selling_price || 0), 0);
    const totalOrders = new Set(filteredRows.map((r) => r.order_number)).size;
    return { totalQty, totalRev, totalOrders };
  }, [filteredRows]);

  async function onExportExcel() {
    if (filteredRows.length === 0) {
      toast.error('Tidak ada data untuk diekspor.');
      return;
    }
    setExporting(true);
    try {
      const sheetRows = filteredRows.map((r) => ({
        'Tanggal'      : formatDate(r.date),
        'No Order'     : r.order_number,
        'Produk'       : r.product_name,
        'Qty'          : r.quantity,
        'Harga Satuan' : r.unit_price,
        'Harga Jual'   : r.selling_price,
        'Nama Pembeli' : r.buyer_name ?? '',
        'No HP'        : r.buyer_phone ?? '',
      }));

      // Pakai static import (lihat top-of-file) — dynamic import bermasalah
      // dengan struktur ESM xlsx di Next.js (chunk URL undefined).
      const ws = XLSX.utils.json_to_sheet(sheetRows);
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

      // Sheet ringkasan (1 baris) supaya admin punya total lengkap saat
      // membuka file di Excel — termasuk yang sudah difilter di UI.
      const summary = [{
        'Periode Dari' : from,
        'Periode Sampai': to,
        'Filter Pencarian': search || '(tanpa filter)',
        'Total Order'  : visibleSummary.totalOrders,
        'Total Qty'    : visibleSummary.totalQty,
        'Total Omset'  : visibleSummary.totalRev,
      }];
      const wsMeta = XLSX.utils.json_to_sheet(summary);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Penjualan');
      XLSX.utils.book_append_sheet(wb, wsMeta, 'Ringkasan');

      const fname = `laporan_penjualan_${from}_to_${to}.xlsx`;
      XLSX.writeFile(wb, fname);
      toast.success(`${filteredRows.length} baris diekspor.`);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Laporan Penjualan</h1>
        <button
          type="button"
          onClick={onExportExcel}
          disabled={exporting || loading || filteredRows.length === 0}
          className="btn-primary"
          title="Ekspor data laporan (sesuai filter & pencarian) ke Excel (.xlsx)"
        >
          {exporting ? 'Mengekspor...' : 'Export Excel'}
        </button>
      </div>

      <form onSubmit={onApply} className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Dari tanggal</label>
          <input
            type="date" className="input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Sampai tanggal</label>
          <input
            type="date" className="input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="label">Cari produk / pembeli / no order</label>
          <input
            type="search"
            className="input"
            placeholder="cth: ban depan, Budi, 0812..., RNC-2026..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="btn-primary" disabled={loading}>
          {loading ? 'Memuat...' : 'Terapkan Filter'}
        </button>
        <button type="button" onClick={onReset} className="btn-ghost">
          Reset (30 hari)
        </button>
      </form>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs text-gray-500">
            Total Order{search ? ' (terfilter)' : ''}
          </div>
          <div className="text-xl font-bold">
            {search ? visibleSummary.totalOrders : (meta?.total_orders ?? 0)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">
            Total Item Terjual{search ? ' (terfilter)' : ''}
          </div>
          <div className="text-xl font-bold">
            {search ? visibleSummary.totalQty : (meta?.total_quantity ?? 0)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">
            Total Omset{search ? ' (terfilter)' : ''}
          </div>
          <div className="text-xl font-bold">
            {formatRupiah(search ? visibleSummary.totalRev : (meta?.total_revenue ?? 0))}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2">Tanggal</th>
              <th className="text-left px-3 py-2">Produk</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Harga Jual</th>
              <th className="text-left px-3 py-2">Nama Pembeli</th>
              <th className="text-left px-3 py-2">No. HP</th>
              <th className="text-left px-3 py-2">No. Order</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Memuat data...</td></tr>
            )}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                {search
                  ? `Tidak ada baris yang cocok dengan pencarian "${search}".`
                  : 'Belum ada penjualan pada rentang tanggal ini.'}
              </td></tr>
            )}
            {!loading && filteredRows.map((r, i) => (
              <tr key={`${r.order_number}-${i}`} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">{formatDate(r.date)}</td>
                <td className="px-3 py-2">
                  {r.product_name}
                  {r.quantity > 1 && (
                    <div className="text-xs text-gray-400">@ {formatRupiah(r.unit_price)}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{r.quantity}</td>
                <td className="px-3 py-2 text-right font-medium">{formatRupiah(r.selling_price)}</td>
                <td className="px-3 py-2">{r.buyer_name ?? '—'}</td>
                <td className="px-3 py-2">{r.buyer_phone ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{r.order_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && search && filteredRows.length > 0 && rows.length !== filteredRows.length && (
          <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100">
            Menampilkan {filteredRows.length} dari {rows.length} baris.
          </div>
        )}
      </div>
    </div>
  );
}
