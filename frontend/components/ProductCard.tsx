'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatRupiah } from '@/lib/api';
import { useSiteSettings } from '@/lib/stores';
import type { Product } from '@/lib/types';
import { QuickViewModal } from './QuickViewModal';

/**
 * Card produk di listing storefront.
 *
 * Fitur:
 *  - Klik area utama → menuju halaman detail (Link).
 *  - Tombol "Lihat Cepat" (overlay saat hover di desktop, selalu tampil di mobile)
 *    → membuka {@link QuickViewModal} tanpa pindah halaman.
 *  - Badge stok: "Habis" merah saat stock=0; "Stok tinggal X" amber saat stok ≤
 *    threshold (per-produk override → fallback ke setting global toko).
 */
export default function ProductCard({ p }: { p: Product }) {
  const settings = useSiteSettings((s) => s.settings);
  const [showQuick, setShowQuick] = useState(false);

  const img = p.images?.[0] ?? 'https://placehold.co/600x600/111827/ffffff?text=Ranco';

  // Tentukan threshold yang berlaku: per-produk dulu, kalau null → global.
  const threshold =
    typeof p.low_stock_threshold === 'number' && p.low_stock_threshold > 0
      ? p.low_stock_threshold
      : settings.low_stock_threshold ?? 5;
  const isOut = p.stock <= 0;
  const isLow = !isOut && p.stock <= threshold;

  return (
    <>
      <div className="card hover:shadow-md transition overflow-hidden flex flex-col group relative">
        <Link href={`/product/${p.slug}`} className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt={p.name} className="aspect-square w-full object-cover bg-gray-100" />
        </Link>

        {/* Stok badges di pojok kiri-atas gambar. */}
        {(isOut || isLow) && (
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {isOut && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-red-600 text-white px-2 py-0.5 rounded">
                Stok Habis
              </span>
            )}
            {isLow && (
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-500 text-white px-2 py-0.5 rounded">
                Tinggal {p.stock}
              </span>
            )}
          </div>
        )}

        {/* Tombol Quick View overlay — visible di mobile selalu, di desktop on hover. */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setShowQuick(true); }}
          className="absolute top-2 right-2 bg-white/95 backdrop-blur text-xs font-medium px-2 py-1 rounded-full shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition"
          title="Lihat ringkas tanpa pindah halaman"
          aria-label="Lihat cepat produk"
        >
          Lihat Cepat
        </button>

        <Link href={`/product/${p.slug}`} className="p-3 flex flex-col gap-1">
          <div className="text-sm text-gray-500">{p.category?.name ?? 'Umum'}</div>
          <div className="font-medium line-clamp-2 text-sm">{p.name}</div>
          <div className="text-brand font-bold">{formatRupiah(p.selling_price)}</div>
          <div className={`text-xs ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-400'}`}>
            {isOut ? 'Stok habis' : `Stok: ${p.stock}`}
          </div>
        </Link>
      </div>

      {showQuick && (
        <QuickViewModal slug={p.slug} onClose={() => setShowQuick(false)} />
      )}
    </>
  );
}
