'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, formatRupiah } from '@/lib/api';
import type { Order } from '@/lib/types';

const STATUSES = ['', 'pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/admin/orders', { params: { status, search } })
      .then((r) => setOrders(r.data.data));
  }, [status, search]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Pesanan</h1>
      <div className="flex gap-2 flex-wrap">
        <input className="input max-w-xs" placeholder="Cari nomor/nama/resi" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'Semua status'}</option>)}
        </select>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">No Order</th>
              <th className="px-3 py-2">Penerima</th>
              <th className="px-3 py-2">Kurir</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-mono">{o.order_number}</td>
                <td className="px-3 py-2">{o.recipient_name}</td>
                <td className="px-3 py-2">{o.courier?.toUpperCase()} {o.courier_service}</td>
                <td className="px-3 py-2"><span className="chip bg-gray-100">{o.status}</span></td>
                <td className="px-3 py-2 text-right">{formatRupiah(o.total)}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/admin/orders/${o.id}`} className="btn-outline">Detail</Link>
                </td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-500">Tidak ada pesanan.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
