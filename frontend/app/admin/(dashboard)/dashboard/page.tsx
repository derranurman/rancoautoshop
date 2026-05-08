'use client';

import { useEffect, useState } from 'react';
import { api, formatRupiah } from '@/lib/api';

interface Summary {
  totals: { products: number; customers: number; orders: number; revenue: number };
  today:  { orders: number; revenue: number };
  this_month: { orders: number; revenue: number };
  orders_by_status: Record<string, number>;
}

export default function AdminDashboardPage() {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => { api.get('/admin/dashboard').then((r) => setS(r.data)); }, []);

  if (!s) return <div className="text-gray-500">Memuat...</div>;

  const cards = [
    { label: 'Total Produk',    value: s.totals.products.toString() },
    { label: 'Total Pelanggan', value: s.totals.customers.toString() },
    { label: 'Total Pesanan',   value: s.totals.orders.toString() },
    { label: 'Total Pendapatan', value: formatRupiah(s.totals.revenue) },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className="mt-1 text-xl font-bold">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="card p-4">
          <h2 className="font-semibold mb-2">Hari Ini</h2>
          <div className="flex justify-between"><span>Order</span><b>{s.today.orders}</b></div>
          <div className="flex justify-between"><span>Omset</span><b>{formatRupiah(s.today.revenue)}</b></div>
        </div>
        <div className="card p-4">
          <h2 className="font-semibold mb-2">Bulan Ini</h2>
          <div className="flex justify-between"><span>Order</span><b>{s.this_month.orders}</b></div>
          <div className="flex justify-between"><span>Omset</span><b>{formatRupiah(s.this_month.revenue)}</b></div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-semibold mb-3">Pesanan per Status</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
          {['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'].map((st) => (
            <div key={st} className="card p-3">
              <div className="text-xs text-gray-500 capitalize">{st}</div>
              <div className="font-bold">{s.orders_by_status[st] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
