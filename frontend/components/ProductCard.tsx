import Link from 'next/link';
import { formatRupiah } from '@/lib/api';
import type { Product } from '@/lib/types';

export default function ProductCard({ p }: { p: Product }) {
  const img = p.images?.[0] ?? 'https://placehold.co/600x600/111827/ffffff?text=Ranco';
  return (
    <Link href={`/product/${p.slug}`}
      className="card hover:shadow-md transition overflow-hidden flex flex-col">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img} alt={p.name} className="aspect-square w-full object-cover bg-gray-100" />
      <div className="p-3 flex flex-col gap-1">
        <div className="text-sm text-gray-500">{p.category?.name ?? 'Umum'}</div>
        <div className="font-medium line-clamp-2 text-sm">{p.name}</div>
        <div className="text-brand font-bold">{formatRupiah(p.selling_price)}</div>
        <div className="text-xs text-gray-400">Stok: {p.stock}</div>
      </div>
    </Link>
  );
}
