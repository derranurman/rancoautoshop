'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import { useAuth, useCart } from '@/lib/stores';
import type { Product } from '@/lib/types';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const { user } = useAuth();
  const { add } = useCart();

  useEffect(() => {
    api.get(`/products/${slug}`).then((r) => setProduct(r.data.data));
  }, [slug]);

  if (!product) {
    return <div className="max-w-6xl mx-auto px-4 py-10 animate-pulse">Memuat...</div>;
  }

  const img = product.images?.[0] ?? 'https://placehold.co/600x600/111827/ffffff?text=Ranco';

  async function onAddToCart() {
    if (!user) { router.push('/login'); return; }
    try {
      if (!product) return;
      await add(product.id, qty);
      toast.success('Ditambahkan ke keranjang');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 grid md:grid-cols-2 gap-6">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={product.name} className="w-full rounded-xl bg-gray-100 aspect-square object-cover" />
      </div>
      <div className="space-y-3">
        <div className="text-sm text-gray-500">{product.category?.name}</div>
        <h1 className="text-2xl font-bold">{product.name}</h1>
        <div className="text-3xl font-bold text-brand">{formatRupiah(product.selling_price)}</div>
        <div className="text-sm text-gray-500">
          Stok: {product.stock} · Berat: {product.weight} gr
        </div>
        <p className="text-gray-700 whitespace-pre-line">{product.description}</p>

        <div className="card p-3 text-sm text-gray-600">
          <div className="flex justify-between"><span>Harga produk</span><span>{formatRupiah(product.price)}</span></div>
          <div className="flex justify-between"><span>Biaya operasional</span><span>{formatRupiah(product.operational_cost)}</span></div>
          <div className="flex justify-between text-gray-900 font-medium mt-1 pt-1 border-t border-gray-100">
            <span>Harga jual</span><span>{formatRupiah(product.selling_price)}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">*Ongkir dihitung di halaman checkout sesuai alamat pengiriman.</div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <div className="flex items-center gap-2">
            <button className="btn-outline" onClick={() => setQty(Math.max(1, qty - 1))}>-</button>
            <span className="w-10 text-center">{qty}</span>
            <button className="btn-outline" onClick={() => setQty(Math.min(product.stock, qty + 1))}>+</button>
          </div>
          <button onClick={onAddToCart} disabled={product.stock === 0} className="btn-primary flex-1">
            {product.stock === 0 ? 'Stok Habis' : 'Masukkan Keranjang'}
          </button>
        </div>
      </div>
    </div>
  );
}
