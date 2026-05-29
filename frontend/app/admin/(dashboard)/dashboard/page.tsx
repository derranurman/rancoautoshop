'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, formatRupiah } from '@/lib/api';

interface Summary {
  totals: { products: number; customers: number; orders: number; revenue: number };
  today:  { orders: number; revenue: number };
  this_month: { orders: number; revenue: number };
  orders_by_status: Record<string, number>;
  inventory?: {
    low_stock_count: number;
    out_of_stock_count: number;
    global_threshold: number;
  };
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
          {['pending', 'awaiting_verification', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'].map((st) => (
            <div key={st} className="card p-3">
              <div className="text-xs text-gray-500 capitalize">{st.replace('_', ' ')}</div>
              <div className="font-bold">{s.orders_by_status[st] ?? 0}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Inventory health: muncul kalau API mengirim section ini. Membantu admin
          langsung lihat berapa SKU yang perlu re-stock dari halaman dashboard. */}
      {s.inventory && (s.inventory.low_stock_count > 0 || s.inventory.out_of_stock_count > 0) && (
        <div className="card p-4 border-amber-300 bg-amber-50">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold text-amber-900">⚠ Inventaris perlu perhatian</h2>
            <Link href="/admin/products" className="text-xs text-amber-900 hover:underline">
              Kelola produk →
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <div className="bg-white rounded p-3 border border-amber-200">
              <div className="text-xs text-gray-500">Stok hampir habis (≤ {s.inventory.global_threshold})</div>
              <div className="font-bold text-2xl text-amber-700">{s.inventory.low_stock_count}</div>
              <div className="text-xs text-gray-500">SKU butuh re-stock segera.</div>
            </div>
            <div className="bg-white rounded p-3 border border-red-200">
              <div className="text-xs text-gray-500">Stok habis</div>
              <div className="font-bold text-2xl text-red-700">{s.inventory.out_of_stock_count}</div>
              <div className="text-xs text-gray-500">SKU tidak bisa dibeli pelanggan.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
