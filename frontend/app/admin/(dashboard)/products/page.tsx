'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';

interface AdminProduct {
  id: number; name: string; slug: string;
  price: number; operational_cost: number;
  stock: number; weight: number; is_active: boolean;
  category?: { id: number; name: string; slug: string } | null;
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get('/admin/products', { params: { search } });
      setProducts(r.data.data);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [search]);

  async function remove(p: AdminProduct) {
    if (!confirm(`Hapus ${p.name}?`)) return;
    try { await api.delete(`/admin/products/${p.id}`); toast.success('Dihapus'); load(); }
    catch (e) { toast.error(apiError(e)); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Produk</h1>
        <Link href="/admin/products/new" className="btn-primary">+ Tambah Produk</Link>
      </div>
      <input className="input max-w-xs" placeholder="Cari..." value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">Produk</th>
              <th className="px-3 py-2">Kategori</th>
              <th className="px-3 py-2 text-right">Harga</th>
              <th className="px-3 py-2 text-right">Biaya Ops</th>
              <th className="px-3 py-2 text-right">Stok</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">Memuat...</td></tr>}
            {!loading && products.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">Belum ada produk.</td></tr>
            )}
            {products.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2">{p.category?.name ?? '—'}</td>
                <td className="px-3 py-2 text-right">{formatRupiah(p.price)}</td>
                <td className="px-3 py-2 text-right">{formatRupiah(p.operational_cost)}</td>
                <td className="px-3 py-2 text-right">{p.stock}</td>
                <td className="px-3 py-2">
                  <span className={`chip ${p.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>
                    {p.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right space-x-2">
                  <Link href={`/admin/products/${p.id}`} className="btn-outline">Edit</Link>
                  <button onClick={() => remove(p)} className="btn-outline text-red-600 border-red-300">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
