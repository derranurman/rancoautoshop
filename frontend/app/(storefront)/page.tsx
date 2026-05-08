'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Category, Product } from '@/lib/types';
import ProductCard from '@/components/ProductCard';

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/categories').then((r) => setCats(r.data.data));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (activeCat) params.category = activeCat;
    if (search)    params.search   = search;
    api.get('/products', { params })
      .then((r) => setProducts(r.data.data))
      .finally(() => setLoading(false));
  }, [activeCat, search]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <section className="rounded-2xl bg-gradient-to-br from-brand to-brand-700 text-white p-8 mb-6">
        <h1 className="text-3xl md:text-4xl font-bold">Ranco Autoshop</h1>
        <p className="mt-2 opacity-90">Aksesoris, sparepart, & perlengkapan mobil dengan harga bersahabat.</p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari produk... misal: stir skeleton, velg, oli"
          className="mt-5 input text-gray-900 max-w-lg"
        />
      </section>

      <div className="flex gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setActiveCat('')}
          className={`chip px-3 py-1.5 border ${activeCat === '' ? 'bg-brand text-white border-brand' : 'bg-white border-gray-200'}`}>
          Semua
        </button>
        {cats.map((c) => (
          <button key={c.id}
            onClick={() => setActiveCat(c.slug)}
            className={`chip px-3 py-1.5 border whitespace-nowrap ${activeCat === c.slug ? 'bg-brand text-white border-brand' : 'bg-white border-gray-200'}`}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card aspect-[3/4] animate-pulse bg-gray-100" />
          ))
        ) : products.length === 0 ? (
          <div className="col-span-full text-center py-10 text-gray-500">Produk tidak ditemukan.</div>
        ) : (
          products.map((p) => <ProductCard key={p.id} p={p} />)
        )}
      </div>
    </div>
  );
}
