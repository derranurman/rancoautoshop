'use client';

import type { OrderTrackingEvent } from '@/lib/types';

const SOURCE_LABEL: Record<string, string> = {
  admin:    'Admin',
  system:   'Sistem',
  webhook:  'Pembayaran',
  customer: 'Pelanggan',
};

const STATUS_DOT: Record<string, string> = {
  pending:   'bg-yellow-400',
  paid:      'bg-blue-500',
  packed:    'bg-indigo-500',
  shipped:   'bg-purple-500',
  delivered: 'bg-green-500',
  cancelled: 'bg-red-500',
};

function formatDate(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function OrderTimeline({
  events,
  emptyMessage = 'Belum ada riwayat pelacakan untuk pesanan ini.',
}: {
  events?: OrderTrackingEvent[] | null;
  emptyMessage?: string;
}) {
  const items = events ?? [];

  if (items.length === 0) {
    return <div className="text-sm text-gray-500">{emptyMessage}</div>;
  }

  return (
    <ol className="relative border-s-2 border-gray-200 ms-2 space-y-4">
      {items.map((ev, idx) => {
        const dotColor = ev.status ? (STATUS_DOT[ev.status] ?? 'bg-gray-400') : 'bg-gray-300';
        const isLast = idx === items.length - 1;
        return (
          <li key={ev.id ?? `${ev.status ?? 'note'}-${ev.created_at}-${idx}`} className="ms-4">
            <span
              className={`absolute -start-[9px] mt-1 h-4 w-4 rounded-full border-2 border-white shadow ${dotColor} ${
                isLast ? 'ring-2 ring-offset-2 ring-gray-200' : ''
              }`}
            />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">{ev.label}</div>
                {ev.note && <div className="text-sm text-gray-600 mt-0.5">{ev.note}</div>}
                {ev.location && (
                  <div className="text-xs text-gray-500 mt-0.5">Lokasi: {ev.location}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-gray-500">{formatDate(ev.created_at)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">
                  {SOURCE_LABEL[ev.source] ?? ev.source}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
