'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { cekresiUrl, courierLabel, courierTrackingUrl } from '@/lib/couriers';

interface Props {
  courier: string | null | undefined;
  service: string | null | undefined;
  trackingNumber: string | null | undefined;
}

/**
 * Compact card that lets the customer copy the AWB or jump directly to the
 * courier's official tracking page (or a cekresi.com aggregator fallback).
 * Designed to be embedded in the order detail page once the admin has set
 * a tracking_number on the order.
 */
export function PackageTracker({ courier, service, trackingNumber }: Props) {
  const [copied, setCopied] = useState(false);

  if (!trackingNumber) return null;

  const label = courierLabel(courier);
  const officialUrl = courierTrackingUrl(courier, trackingNumber);
  const aggregatorUrl = cekresiUrl(trackingNumber);

  async function copy() {
    try {
      await navigator.clipboard.writeText(trackingNumber!);
      setCopied(true);
      toast.success('Nomor resi disalin');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Gagal menyalin');
    }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="font-semibold">Lacak Paket</h2>
        <span className="text-xs text-gray-500">
          {label}{service ? ` · ${service}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-sm bg-gray-100 px-2 py-1 rounded select-all">
          {trackingNumber}
        </code>
        <button type="button" onClick={copy} className="btn-ghost text-xs">
          {copied ? 'Tersalin' : 'Salin'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <a
          href={officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary text-sm"
        >
          Lacak di {label}
        </a>
        <a
          href={aggregatorUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-outline text-sm"
          title="Cek di cekresi.com (aggregator multi-kurir)"
        >
          Lacak via cekresi.com
        </a>
      </div>

      <p className="text-[11px] text-gray-500 mt-2">
        Kalau halaman kurir minta input ulang, tempel resi di atas — beberapa
        situs kurir tidak menerima query string langsung.
      </p>
    </div>
  );
}
