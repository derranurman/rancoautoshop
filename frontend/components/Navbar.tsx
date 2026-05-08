'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useAuth, useCart } from '@/lib/stores';

export default function Navbar() {
  const { user, loading, loadMe, logout } = useAuth();
  const { cart, fetch: fetchCart } = useCart();

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (user) fetchCart();
  }, [user, fetchCart]);

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl">
          <span className="inline-block h-8 w-8 rounded-lg bg-brand text-white grid place-items-center">R</span>
          <span className="text-ink">Ranco<span className="text-brand"> Autoshop</span></span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm ml-6">
          <Link href="/" className="hover:text-brand">Katalog</Link>
          <Link href="/orders" className="hover:text-brand">Pesanan</Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/cart" className="btn-outline relative">
            Keranjang
            {cart && cart.total_items > 0 && (
              <span className="absolute -top-2 -right-2 bg-brand text-white text-xs rounded-full w-5 h-5 grid place-items-center">
                {cart.total_items}
              </span>
            )}
          </Link>
          {loading ? (
            <span className="text-sm text-gray-400">...</span>
          ) : user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 hidden sm:inline">Hai, {user.name.split(' ')[0]}</span>
              <button onClick={logout} className="btn-ghost text-sm">Keluar</button>
            </div>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Masuk</Link>
              <Link href="/register" className="btn-primary">Daftar</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
