'use client';

import { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WhatsAppWidget from '@/components/WhatsAppWidget';
import { useSiteSettings } from '@/lib/stores';

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const load = useSiteSettings((s) => s.load);
  const settings = useSiteSettings((s) => s.settings);

  // Muat sekali saat layout pertama dipasang. Store sendiri yang
  // memutuskan untuk skip kalau sudah pernah di-load di session ini.
  useEffect(() => { load(); }, [load]);

  // Sinkron favicon dari pengaturan admin secara dinamis. Kita hanya
  // update tag <link rel="icon"> yang sudah ada (atau tambah baru) di
  // <head>; tidak menyentuh App Router metadata supaya tidak konflik.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const href = settings.favicon_url;
    if (!href) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }, [settings.favicon_url]);

  // Sinkron <title> di tab browser dengan nama toko (kalau halaman tidak
  // override metadata-nya sendiri). Mempertahankan tagline aslinya.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!settings.app_name) return;
    document.title = `${settings.app_name} — Aksesoris & Perlengkapan Mobil`;
  }, [settings.app_name]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppWidget />
    </div>
  );
}
