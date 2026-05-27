'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
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
    // give state a tick to settle then reload
    setTimeout(load, 0);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Laporan Penjualan</h1>

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
        <button className="btn-primary" disabled={loading}>
          {loading ? 'Memuat...' : 'Terapkan Filter'}
        </button>
        <button type="button" onClick={onReset} className="btn-ghost">
          Reset (30 hari)
        </button>
      </form>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs text-gray-500">Total Order</div>
          <div className="text-xl font-bold">{meta?.total_orders ?? 0}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Total Item Terjual</div>
          <div className="text-xl font-bold">{meta?.total_quantity ?? 0}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Total Omset</div>
          <div className="text-xl font-bold">{formatRupiah(meta?.total_revenue ?? 0)}</div>
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
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">Belum ada penjualan pada rentang tanggal ini.</td></tr>
            )}
            {!loading && rows.map((r, i) => (
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
      </div>
    </div>
  );
}
