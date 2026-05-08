'use client';

import { useEffect, useState } from 'react';
import { api, formatRupiah } from '@/lib/api';

interface Row { date: string; orders: number; revenue: number; }

export default function ReportsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { api.get('/admin/reports/sales').then((r) => setRows(r.data.data)); }, []);

  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const totalOrders = rows.reduce((s, r) => s + Number(r.orders), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Laporan Penjualan (30 hari)</h1>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="card p-4"><div className="text-xs text-gray-500">Total Order</div><div className="text-xl font-bold">{totalOrders}</div></div>
        <div className="card p-4"><div className="text-xs text-gray-500">Total Omset</div><div className="text-xl font-bold">{formatRupiah(totalRevenue)}</div></div>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr><th className="text-left px-3 py-2">Tanggal</th><th className="text-right px-3 py-2">Order</th><th className="text-right px-3 py-2">Omset</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-gray-500">Belum ada data.</td></tr>}
            {rows.map((r) => (
              <tr key={r.date} className="border-t border-gray-100">
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2 text-right">{r.orders}</td>
                <td className="px-3 py-2 text-right">{formatRupiah(Number(r.revenue))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
