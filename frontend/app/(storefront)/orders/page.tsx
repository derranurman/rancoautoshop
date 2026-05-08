'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatRupiah } from '@/lib/api';
import { useAuth } from '@/lib/stores';
import type { Order } from '@/lib/types';

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Menunggu Pembayaran', color: 'bg-yellow-100 text-yellow-800' },
  paid:      { label: 'Dibayar',              color: 'bg-blue-100 text-blue-800' },
  packed:    { label: 'Dikemas',              color: 'bg-indigo-100 text-indigo-800' },
  shipped:   { label: 'Dikirim',              color: 'bg-purple-100 text-purple-800' },
  delivered: { label: 'Selesai',              color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Dibatalkan',           color: 'bg-red-100 text-red-700' },
};

export default function OrdersPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (!loading && !user) { router.replace('/login'); return; }
    if (user) {
      setBusy(true);
      api.get('/orders').then((r) => setOrders(r.data.data)).finally(() => setBusy(false));
    }
  }, [user, loading, router]);

  if (busy || loading) return <div className="max-w-4xl mx-auto px-4 py-10 text-gray-500">Memuat...</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">Pesanan Saya</h1>
      {orders.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">Belum ada pesanan.</div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const s = STATUS_LABEL[o.status];
            return (
              <Link key={o.id} href={`/orders/${o.order_number}`}
                className="card p-4 flex justify-between items-center hover:shadow-sm transition">
                <div>
                  <div className="font-semibold">{o.order_number}</div>
                  <div className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString('id-ID')}</div>
                  <span className={`chip ${s.color} mt-2`}>{s.label}</span>
                </div>
                <div className="text-right">
                  <div className="font-bold">{formatRupiah(o.total)}</div>
                  {o.tracking_number && <div className="text-xs text-gray-500 mt-1">Resi: {o.tracking_number}</div>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
