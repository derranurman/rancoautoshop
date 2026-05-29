'use client';

import { useEffect, useRef, useState } from 'react';
import { useSiteSettings } from '@/lib/stores';

/**
 * Floating WhatsApp widget di pojok kanan-bawah storefront — meniru gaya
 * "live chat" yang sering dipakai e-commerce. Konfigurasi (nomor, label,
 * greeting, teks pre-fill) bisa diatur admin via menu "Tampilan".
 *
 * Kalau admin belum mengaktifkan widget atau belum mengisi nomor WA,
 * komponen ini sengaja render `null` supaya tidak ada UI yang menggantung.
 */
export default function WhatsAppWidget() {
  const { settings, load } = useSiteSettings();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Settings dimuat dari layout, tapi pasang lagi di sini sebagai safety net
  // (mis. komponen di-mount sebelum layout effect sempat jalan saat HMR).
  useEffect(() => { load(); }, [load]);

  // Tutup popover saat klik di luar atau tekan Escape — pola yang sama
  // dengan dropdown akun di Navbar.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
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

  if (!settings.whatsapp_enabled) return null;
  if (!settings.whatsapp_link) return null; // nomor belum diisi/valid

  const { whatsapp_label, whatsapp_greeting, whatsapp_link, whatsapp_number } = settings;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={whatsapp_label}
          className="w-[300px] max-w-[calc(100vw-2rem)] card shadow-xl overflow-hidden"
        >
          <div className="bg-[#25D366] text-white px-4 py-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-white/15 grid place-items-center shrink-0">
              <WhatsAppIcon className="h-5 w-5 fill-white" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm leading-tight truncate">{whatsapp_label}</div>
              <div className="text-[11px] opacity-90">Online · Balas via WhatsApp</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto text-white/80 hover:text-white text-lg leading-none"
              aria-label="Tutup"
            >
              ×
            </button>
          </div>

          {/* Bubble greeting bergaya WhatsApp */}
          <div className="bg-[#ECE5DD] px-3 py-4 min-h-[110px]">
            <div className="bg-white rounded-lg rounded-tl-none px-3 py-2 text-sm text-gray-800 shadow-sm max-w-[90%]">
              {whatsapp_greeting}
            </div>
            {whatsapp_number && (
              <div className="text-[11px] text-gray-500 mt-2 ml-1">
                +{whatsapp_number}
              </div>
            )}
          </div>

          <a
            href={whatsapp_link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 bg-[#25D366] text-white font-medium py-3 hover:bg-[#1ebe5b] transition"
          >
            <WhatsAppIcon className="h-4 w-4 fill-white" />
            Mulai Chat di WhatsApp
          </a>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Tutup chat WhatsApp' : 'Buka chat WhatsApp'}
        className="h-14 w-14 rounded-full bg-[#25D366] text-white shadow-lg grid place-items-center hover:bg-[#1ebe5b] transition active:scale-95"
        title={whatsapp_label}
      >
        {open
          ? <span className="text-2xl leading-none" aria-hidden>×</span>
          : <WhatsAppIcon className="h-7 w-7 fill-white" />}
      </button>
    </div>
  );
}

/** Inline SVG icon WhatsApp supaya tidak butuh dependency icon library. */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M19.11 4.91A10.06 10.06 0 0 0 12.04 2C6.5 2 2 6.5 2 12.05a10 10 0 0 0 1.39 5.07L2 22l5.05-1.32A10.05 10.05 0 0 0 12.04 22h.01c5.53 0 10.03-4.5 10.03-10.05 0-2.68-1.04-5.2-2.97-7.04ZM12.04 20.32h-.01a8.27 8.27 0 0 1-4.21-1.15l-.3-.18-3 .79.8-2.92-.2-.31a8.3 8.3 0 0 1-1.27-4.5c0-4.6 3.74-8.34 8.35-8.34 2.23 0 4.32.87 5.9 2.45a8.27 8.27 0 0 1 2.45 5.9c0 4.6-3.75 8.26-8.51 8.26Zm4.71-6.16c-.26-.13-1.52-.75-1.76-.83-.24-.09-.41-.13-.58.13-.17.26-.66.83-.81 1-.15.17-.3.19-.55.06-.26-.13-1.08-.4-2.06-1.27-.76-.68-1.27-1.51-1.42-1.77-.15-.26-.02-.4.11-.53.11-.11.26-.3.39-.45.13-.15.17-.26.26-.43.09-.17.04-.32-.02-.45-.06-.13-.58-1.4-.79-1.92-.21-.5-.42-.43-.58-.44H8.6c-.17 0-.45.06-.69.32-.24.26-.9.88-.9 2.15s.92 2.49 1.05 2.66c.13.17 1.81 2.77 4.39 3.88.61.26 1.09.42 1.46.54.61.2 1.17.17 1.61.1.49-.07 1.52-.62 1.73-1.22.21-.6.21-1.12.15-1.22-.06-.1-.24-.17-.5-.3Z"/>
    </svg>
  );
}
