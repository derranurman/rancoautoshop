'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Category, Product } from '@/lib/types';
import ProductCard from '@/components/ProductCard';
import { useSiteSettings } from '@/lib/stores';

export default function HomePage() {
  // useSearchParams butuh Suspense boundary saat build (Next.js App Router).
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-4 py-10 text-gray-500">Memuat...</div>}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');
  // Inisialisasi `search` dari ?search=... di URL — supaya saat user pencet
  // Enter di Navbar autocomplete dan landing ke homepage, query langsung ke-apply.
  const [search, setSearch] = useState(() => searchParams?.get('search') ?? '');
  const [loading, setLoading] = useState(true);
  const settings = useSiteSettings((s) => s.settings);

  useEffect(() => {
    api.get('/categories').then((r) => setCats(r.data.data));
  }, []);

  // Sinkron state lokal kalau query string berubah (mis. user klik link search
  // lain dari halaman manapun).
  useEffect(() => {
    const s = searchParams?.get('search') ?? '';
    setSearch(s);
  }, [searchParams]);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (activeCat) params.category = activeCat;
    if (search)    params.search   = search;
    api.get('/products', { params })
      .then((r) => setProducts(r.data.data))
      .finally(() => setLoading(false));
  }, [activeCat, search]);

  const heroStyle =
    settings.hero_gradient_from && settings.hero_gradient_to
      ? {
          backgroundImage: `linear-gradient(to bottom right, ${settings.hero_gradient_from}, ${settings.hero_gradient_to})`,
        }
      : undefined;
  const heroFallbackClass =
    !heroStyle ? 'bg-gradient-to-br from-brand to-brand-700' : '';

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <section
        className={`rounded-2xl ${heroFallbackClass} text-white p-8 mb-6`}
        style={heroStyle}
      >
        <h1 className="text-3xl md:text-4xl font-bold">{settings.hero_title}</h1>
        <p className="mt-2 opacity-90">{settings.hero_subtitle}</p>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={settings.hero_search_placeholder}
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

      {/* Header kecil untuk hasil pencarian — tampil hanya kalau `search` aktif. */}
      {search && !loading && (
        <div className="mt-3 text-sm text-gray-600">
          {products.length === 0
            ? <>Tidak ada hasil untuk <b>&ldquo;{search}&rdquo;</b>.</>
            : <>Menampilkan {products.length} hasil untuk <b>&ldquo;{search}&rdquo;</b>.</>
          }{' '}
          <button
            type="button"
            onClick={() => setSearch('')}
            className="text-brand hover:underline ml-1"
          >
            Reset pencarian
          </button>
        </div>
      )}

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
