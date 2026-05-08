'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { apiError, formatRupiah } from '@/lib/api';
import { useAuth, useCart } from '@/lib/stores';

export default function CartPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { cart, fetch, updateItem, removeItem, loading } = useCart();

  useEffect(() => {
    if (!authLoading && !user) { router.replace('/login'); return; }
    if (user) fetch();
  }, [user, authLoading, fetch, router]);

  if (loading || !cart) {
    return <div className="max-w-4xl mx-auto px-4 py-10 text-gray-500">Memuat keranjang...</div>;
  }

  async function setQty(itemId: number, qty: number) {
    try { await updateItem(itemId, qty); }
    catch (e) { toast.error(apiError(e)); }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-4">Keranjang</h1>
      {cart.items.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          Keranjang kamu kosong. <Link href="/" className="text-brand font-medium">Belanja sekarang</Link>
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-3">
            {cart.items.map((it) => (
              <div key={it.id} className="card p-3 flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.image ?? 'https://placehold.co/200x200'} className="w-20 h-20 rounded object-cover" alt="" />
                <div className="flex-1">
                  <Link href={`/product/${it.slug}`} className="font-medium hover:text-brand">{it.name}</Link>
                  <div className="text-brand font-bold">{formatRupiah(it.selling_price)}</div>
                  <div className="text-xs text-gray-500">Stok: {it.stock}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <button className="btn-outline px-2" onClick={() => setQty(it.id, Math.max(1, it.quantity - 1))}>-</button>
                    <span className="w-8 text-center">{it.quantity}</span>
                    <button className="btn-outline px-2" onClick={() => setQty(it.id, Math.min(it.stock, it.quantity + 1))}>+</button>
                    <button className="ml-auto text-sm text-red-600" onClick={() => removeItem(it.id)}>Hapus</button>
                  </div>
                </div>
                <div className="text-right font-semibold">{formatRupiah(it.subtotal)}</div>
              </div>
            ))}
          </div>

          <div className="card p-4 h-fit">
            <div className="flex justify-between py-1"><span>Total barang</span><span>{cart.total_items}</span></div>
            <div className="flex justify-between py-1"><span>Subtotal</span><span>{formatRupiah(cart.subtotal)}</span></div>
            <div className="flex justify-between py-1 text-xs text-gray-500"><span>Total berat</span><span>{cart.total_weight} gr</span></div>
            <div className="text-xs text-gray-500 my-2">Ongkir dihitung di checkout.</div>
            <Link href="/checkout" className="btn-primary w-full">Lanjut ke Checkout</Link>
          </div>
        </div>
      )}
    </div>
  );
}
