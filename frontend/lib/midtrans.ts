'use client';

/**
 * Helper to lazy-load the Midtrans Snap script and return the global `snap`
 * object. Same module is reused by checkout and order detail pages.
 *
 * If the merchant client key isn't configured (dev/mock mode), the helper
 * returns `null` and the caller should fall back to a no-popup flow.
 */
export type SnapCallbacks = {
  onSuccess?: (result: unknown) => void;
  onPending?: (result: unknown) => void;
  onError?: (result: unknown) => void;
  onClose?: () => void;
};

interface SnapGlobal {
  pay: (token: string, callbacks?: SnapCallbacks) => void;
}

declare global {
  interface Window {
    snap?: SnapGlobal;
  }
}

export function midtransClientKey(): string | undefined {
  return process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
}

export function midtransSnapUrl(): string {
  return (
    process.env.NEXT_PUBLIC_MIDTRANS_SNAP_URL
    || 'https://app.sandbox.midtrans.com/snap/snap.js'
  );
}

let loading: Promise<SnapGlobal | null> | null = null;

export function loadSnap(): Promise<SnapGlobal | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.snap) return Promise.resolve(window.snap);
  if (loading) return loading;

  const clientKey = midtransClientKey();
  if (!clientKey) return Promise.resolve(null); // dev/mock mode

  loading = new Promise<SnapGlobal | null>((resolve, reject) => {
    const url = midtransSnapUrl();
    let script = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = url;
      script.setAttribute('data-client-key', clientKey);
      script.async = true;
      script.onload = () => resolve(window.snap ?? null);
      script.onerror = () => reject(new Error('Gagal memuat Midtrans Snap'));
      document.head.appendChild(script);
    } else {
      // script already exists; wait for global
      const t = setInterval(() => {
        if (window.snap) {
          clearInterval(t);
          resolve(window.snap);
        }
      }, 50);
    }
  });

  return loading;
}

export async function paySnap(token: string, callbacks: SnapCallbacks = {}) {
  const snap = await loadSnap();
  if (!snap) {
    // Dev/mock mode — pretend success after short delay so the UI keeps moving.
    callbacks.onSuccess?.({ mock: true });
    return;
  }
  snap.pay(token, callbacks);
}
