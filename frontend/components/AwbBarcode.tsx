'use client';

import { useEffect, useRef } from 'react';

/**
 * Render barcode Code-128 dari nomor resi/AWB ke <svg>.
 *
 * Pakai `jsbarcode` (dependency frontend, ~30KB) — Code 128 adalah simbologi
 * standar yang dipakai semua kurir Indonesia (J&T, JNE, SiCepat, POS, TIKI,
 * Anteraja). Selama nomor resi yang admin input cocok dengan yang di sistem
 * kurir, paket akan ter-track normal.
 *
 * Render di useEffect supaya jsbarcode (yang menyentuh DOM) tidak
 * mengganggu SSR. Kalau jsbarcode gagal di-load (mis. dependency belum
 * di-install setelah pull), fallback ke text monospace polos.
 */
export function AwbBarcode({
  value,
  height = 50,
  fontSize = 14,
  className = '',
}: {
  value: string;
  height?: number;
  fontSize?: number;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!svgRef.current || !value) return;
    // Dynamic import supaya bundle utama tidak ikut kebawa jsbarcode
    // sampai admin benar-benar buka halaman label.
    import('jsbarcode').then(({ default: JsBarcode }) => {
      if (cancelled || !svgRef.current) return;
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          height,
          fontSize,
          margin: 0,
          displayValue: true,
          font: 'monospace',
          textMargin: 2,
        });
      } catch {
        // Karakter tidak valid di Code 128 (sangat jarang) — biarkan fallback
        // text di bawah yang muncul.
      }
    }).catch(() => { /* lib gagal load, biarkan fallback text */ });
    return () => { cancelled = true; };
  }, [value, height, fontSize]);

  if (!value) return null;
  return (
    <div className={className}>
      <svg ref={svgRef} aria-label={`Barcode resi ${value}`} />
      {/* Fallback text — terlihat saat svg belum/gagal di-render */}
      <noscript>
        <span className="font-mono">{value}</span>
      </noscript>
    </div>
  );
}
