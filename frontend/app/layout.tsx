import './globals.css';
import type { Metadata } from 'next';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'Ranco Autoshop — Aksesoris & Perlengkapan Mobil',
  description: 'Toko online aksesoris, sparepart, dan perlengkapan mobil.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Toaster position="top-center" />
        {children}
      </body>
    </html>
  );
}
