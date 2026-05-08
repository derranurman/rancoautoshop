'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAdminAuth } from '@/lib/stores';

const NAV = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/products',  label: 'Produk' },
  { href: '/admin/orders',    label: 'Pesanan' },
  { href: '/admin/users',     label: 'Pelanggan' },
  { href: '/admin/vouchers',  label: 'Voucher' },
  { href: '/admin/reports',   label: 'Laporan' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { admin, loading, loadMe, logout } = useAdminAuth();

  useEffect(() => { loadMe(); }, [loadMe]);

  useEffect(() => {
    if (!loading && !admin) router.replace('/admin/login');
  }, [loading, admin, router]);

  if (loading || !admin) {
    return <div className="min-h-screen grid place-items-center text-gray-500">Memuat admin...</div>;
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-ink text-white flex flex-col">
        <div className="p-4 border-b border-white/10 flex items-center gap-2">
          <span className="inline-block h-8 w-8 rounded-lg bg-brand grid place-items-center font-bold">R</span>
          <div>
            <div className="font-bold text-sm">Ranco Admin</div>
            <div className="text-xs text-white/60">{admin.name}</div>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + '/');
            return (
              <Link key={n.href} href={n.href}
                className={`block px-3 py-2 rounded-md text-sm ${active ? 'bg-brand text-white' : 'hover:bg-white/10'}`}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={() => { logout(); router.push('/admin/login'); }}
          className="m-3 btn-outline bg-white/10 border-white/20 text-white hover:bg-white/20">
          Keluar
        </button>
      </aside>
      <main className="flex-1 p-6 bg-gray-50">{children}</main>
    </div>
  );
}
