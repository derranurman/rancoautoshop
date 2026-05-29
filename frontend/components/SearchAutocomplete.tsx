'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatRupiah } from '@/lib/api';
import type { ProductSuggestion } from '@/lib/types';

/**
 * Kotak pencarian dengan autocomplete dropdown.
 *
 * Behaviour:
 *  - Debounce 250ms — hindari hit `/products/suggest` setiap keystroke.
 *  - Cancellation: setiap request baru membatalkan yang sebelumnya pakai
 *    AbortController, supaya hasil yang datang terakhir bukan hasil basi.
 *  - Keyboard: ↑/↓ untuk pilih, Enter untuk navigate, Esc untuk tutup.
 *  - Click-outside menutup dropdown (sama seperti pola Navbar account menu).
 *  - Min 2 karakter sebelum query dikirim.
 *
 * Kalau user pencet Enter tanpa memilih item, kita push ke `/?search=<q>` —
 * homepage menerima query string dan mengisi state pencariannya.
 */
export function SearchAutocomplete({
  placeholder = 'Cari produk...',
  className = '',
  autoFocus = false,
  onNavigate,
}: {
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Optional callback supaya parent (mis. mobile drawer) bisa close drawer. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch + cancellation.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      // jangan tutup dropdown di sini — kalau user habis nge-clear, dropdown
      // tetap close-nya ditentukan oleh klik-luar / blur.
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const r = await api.get('/products/suggest', {
          params: { q: trimmed },
          signal: controller.signal,
        });
        setResults((r.data?.data ?? []) as ProductSuggestion[]);
        setActiveIdx(-1);
        setOpen(true);
      } catch (e: unknown) {
        const err = e as { code?: string; name?: string };
        const isCanceled =
          err?.code === 'ERR_CANCELED'
          || err?.name === 'CanceledError'
          || err?.name === 'AbortError';
        if (!isCanceled) {
          // network/parse error — biarkan dropdown kosong, jangan toast
          // supaya tidak mengganggu user yang masih mengetik.
          setResults([]);
        }
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [q]);

  // Click outside → tutup.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function navigateTo(slugOrSearch: { slug?: string; search?: string }) {
    setOpen(false);
    onNavigate?.();
    if (slugOrSearch.slug) {
      router.push(`/product/${slugOrSearch.slug}`);
    } else if (slugOrSearch.search) {
      router.push(`/?search=${encodeURIComponent(slugOrSearch.search)}`);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = activeIdx >= 0 ? results[activeIdx] : null;
      if (chosen) {
        navigateTo({ slug: chosen.slug });
      } else if (q.trim().length >= 2) {
        navigateTo({ search: q.trim() });
      }
    }
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { if (results.length > 0 || q.trim().length >= 2) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="input w-full pr-8"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {/* Indikator loading kecil di pojok kanan */}
      {loading && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
          ...
        </span>
      )}

      {open && (q.trim().length >= 2) && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-40 overflow-hidden max-h-[60vh] overflow-y-auto"
        >
          {results.length === 0 && !loading && (
            <div className="px-3 py-3 text-sm text-gray-500">
              Tidak ada hasil untuk &ldquo;{q}&rdquo;.
            </div>
          )}
          {results.map((r, i) => (
            <Link
              key={r.id}
              href={`/product/${r.slug}`}
              onClick={() => { setOpen(false); onNavigate?.(); }}
              role="option"
              aria-selected={i === activeIdx}
              className={[
                'flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50',
                i === activeIdx ? 'bg-brand/5' : '',
              ].join(' ')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.image ?? 'https://placehold.co/64x64/111827/ffffff?text=Ranco'}
                alt=""
                className="w-10 h-10 rounded object-cover bg-gray-100 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {r.category ?? 'Umum'} · {formatRupiah(r.selling_price)}
                  {!r.in_stock && <span className="text-red-600 ml-1">· Habis</span>}
                </div>
              </div>
            </Link>
          ))}

          {results.length > 0 && (
            <button
              type="button"
              onClick={() => navigateTo({ search: q.trim() })}
              className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 text-brand hover:bg-brand/5"
            >
              Lihat semua hasil untuk &ldquo;{q}&rdquo; →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
