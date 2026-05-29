'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth, useCart, useSiteSettings } from '@/lib/stores';

export default function Navbar() {
  const { user, loading, loadMe, logout } = useAuth();
  const { cart, fetch: fetchCart } = useCart();
  const settings = useSiteSettings((s) => s.settings);

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (user) fetchCart();
  }, [user, fetchCart]);

  // Close the account dropdown when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const phoneMissing = !!user && !user.phone;

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl">
          {settings.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.logo_url}
              alt={settings.app_name}
              className="h-8 w-8 rounded-lg object-cover bg-white"
            />
          ) : (
            // Fallback: huruf pertama nama toko (tetap pakai brand color).
            <span className="inline-block h-8 w-8 rounded-lg bg-brand text-white grid place-items-center">
              {(settings.app_name?.trim()?.charAt(0) ?? 'R').toUpperCase()}
            </span>
          )}
          <BrandLabel name={settings.app_name} />
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
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="btn-ghost relative inline-flex items-center gap-1"
                aria-haspopup="menu"
                aria-expanded={open}
              >
                <span className="hidden sm:inline">Hai, {user.name.split(' ')[0]}</span>
                <span className="sm:hidden">Akun</span>
                <svg className="h-3 w-3" viewBox="0 0 12 8" fill="currentColor">
                  <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="2" fill="none" />
                </svg>
                {phoneMissing && (
                  <span
                    className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white"
                    title="No. HP belum diisi"
                  />
                )}
              </button>

              {open && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-56 card p-1 shadow-lg z-40"
                >
                  <div className="px-3 py-2 border-b border-gray-100">
                    <div className="font-semibold truncate">{user.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {user.email ?? user.phone ?? '-'}
                    </div>
                  </div>

                  <Link
                    href="/account/profile"
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between px-3 py-2 text-sm rounded hover:bg-gray-50"
                  >
                    <span>Profil</span>
                    {phoneMissing && (
                      <span className="text-[10px] uppercase tracking-wide bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                        + No HP
                      </span>
                    )}
                  </Link>
                  <Link
                    href="/account/addresses"
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 text-sm rounded hover:bg-gray-50"
                  >
                    Alamat Saya
                  </Link>
                  <Link
                    href="/orders"
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 text-sm rounded hover:bg-gray-50"
                  >
                    Pesanan Saya
                  </Link>

                  <div className="border-t border-gray-100 my-1" />
                  <button
                    type="button"
                    onClick={() => { setOpen(false); logout(); }}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-50 text-red-600"
                  >
                    Keluar
                  </button>
                </div>
              )}
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



/**
 * Render nama toko dengan kata kedua diberi warna brand — meniru pola lama
 * "Ranco Autoshop" → "Ranco" hitam, "Autoshop" merah. Kalau cuma 1 kata,
 * tampil polos. Diambil dari pengaturan admin supaya bisa diubah tanpa rilis.
 */
function BrandLabel({ name }: { name: string }) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return <span className="text-ink">Ranco<span className="text-brand"> Autoshop</span></span>;
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return <span className="text-ink">{trimmed}</span>;
  const first = trimmed.slice(0, idx);
  const rest = trimmed.slice(idx + 1);
  return (
    <span className="text-ink">{first}<span className="text-brand"> {rest}</span></span>
  );
}
