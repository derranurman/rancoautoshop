'use client';

import { create } from 'zustand';
import { api, getToken, setToken, RequestWithKind } from './api';
import type { Cart, SiteSettings, User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  loadMe: () => Promise<void>;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  /** Replace the current user (used after profile update). */
  setUser: (user: User) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  async loadMe() {
    if (!getToken('customer')) { set({ loading: false }); return; }
    try {
      const res = await api.get('/auth/me');
      set({ user: res.data.user, loading: false });
    } catch {
      setToken('customer', null);
      set({ user: null, loading: false });
    }
  },
  login(token, user) {
    setToken('customer', token);
    set({ user });
  },
  async logout() {
    try { await api.post('/auth/logout'); } catch {}
    setToken('customer', null);
    set({ user: null });
  },
  setUser(user) {
    set({ user });
  },
}));

interface AdminAuthState {
  admin: User | null;
  loading: boolean;
  loadMe: () => Promise<void>;
  login: (token: string, admin: User) => void;
  logout: () => Promise<void>;
}

export const useAdminAuth = create<AdminAuthState>((set) => ({
  admin: null,
  loading: true,
  async loadMe() {
    if (!getToken('admin')) { set({ loading: false }); return; }
    try {
      // Force the admin token on this shared endpoint regardless of page context.
      const me = await api.get('/auth/me', { tokenKind: 'admin' } as RequestWithKind);
      const admin = (me?.data?.user ?? null) as User | null;
      if (!admin || admin.role !== 'admin' || admin.is_active === false) {
        setToken('admin', null);
        set({ admin: null, loading: false });
        return;
      }
      set({ admin, loading: false });
    } catch {
      setToken('admin', null);
      set({ admin: null, loading: false });
    }
  },
  login(token, admin) {
    setToken('admin', token);
    set({ admin });
  },
  async logout() {
    try { await api.post('/auth/logout', null, { tokenKind: 'admin' } as RequestWithKind); } catch {}
    setToken('admin', null);
    set({ admin: null });
  },
}));

interface CartState {
  cart: Cart | null;
  loading: boolean;
  fetch: () => Promise<void>;
  add: (productId: number, qty?: number) => Promise<void>;
  updateItem: (itemId: number, qty: number) => Promise<void>;
  removeItem: (itemId: number) => Promise<void>;
  clear: () => Promise<void>;
}

export const useCart = create<CartState>((set) => ({
  cart: null,
  loading: false,
  async fetch() {
    if (!getToken('customer')) { set({ cart: null }); return; }
    set({ loading: true });
    try {
      const res = await api.get('/cart');
      set({ cart: res.data });
    } finally { set({ loading: false }); }
  },
  async add(productId, qty = 1) {
    const res = await api.post('/cart/items', { product_id: productId, quantity: qty });
    set({ cart: res.data });
  },
  async updateItem(itemId, qty) {
    const res = await api.patch(`/cart/items/${itemId}`, { quantity: qty });
    set({ cart: res.data });
  },
  async removeItem(itemId) {
    const res = await api.delete(`/cart/items/${itemId}`);
    set({ cart: res.data });
  },
  async clear() {
    const res = await api.delete('/cart');
    set({ cart: res.data });
  },
}));



/**
 * Default tampilan kalau API belum sempat menjawab. Disinkronkan dengan
 * default kolom di migration `create_site_settings_table` supaya UI tidak
 * berubah saat first-load.
 */
const DEFAULT_SETTINGS: SiteSettings = {
  app_name: 'Ranco Autoshop',
  logo_url: null,
  favicon_url: null,
  hero_title: 'Ranco Autoshop',
  hero_subtitle: 'Aksesoris, sparepart, & perlengkapan mobil dengan harga bersahabat.',
  hero_search_placeholder: 'Cari produk... misal: stir skeleton, velg, oli',
  hero_gradient_from: null,
  hero_gradient_to: null,
  footer_text: null,
  whatsapp_enabled: false,
  whatsapp_number: null,
  whatsapp_label: 'Chat Admin Ranco',
  whatsapp_greeting: 'Halo! Ada yang bisa kami bantu seputar produk Ranco Autoshop?',
  whatsapp_prefilled_text: 'Halo Admin Ranco, saya ingin bertanya tentang produk.',
  whatsapp_link: null,
};

const SETTINGS_CACHE_KEY = 'ranco.siteSettings';

interface SiteSettingsState {
  settings: SiteSettings;
  loaded: boolean;
  /**
   * Memuat pengaturan dari API. Akan langsung memakai nilai dari
   * localStorage (kalau ada) supaya UI tidak FOUC, lalu refresh di latar
   * belakang ke server. Aman dipanggil berkali-kali — request keduanya akan
   * di-skip kalau sudah loaded di session ini.
   */
  load: (force?: boolean) => Promise<void>;
  /** Replace settings di-state (dipakai admin setelah berhasil simpan). */
  replace: (s: SiteSettings) => void;
}

export const useSiteSettings = create<SiteSettingsState>((set, get) => ({
  // PENTING: initial state HARUS deterministik & sama di server maupun client.
  // Sebelumnya kita baca localStorage di sini, akibatnya server render pakai
  // DEFAULT_SETTINGS sementara client (saat module di-evaluasi ulang di
  // browser) langsung pakai versi cache → markup beda → React melempar
  // "Hydration failed". Hidrasi dari cache dilakukan saat load() dipanggil
  // dari useEffect (yang otomatis hanya jalan di client setelah mount).
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load(force = false) {
    if (!force && get().loaded) return;

    // 1) Pakai cache localStorage dulu kalau ada — supaya UI tidak FOUC saat
    //    user berpindah halaman (mis. logo "loncat" dari fallback ke logo asli).
    //    Ini aman dilakukan setelah mount, jadi tidak memicu hydration error.
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
        if (raw) {
          const cached = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as SiteSettings) };
          set({ settings: cached });
        }
      } catch { /* ignore parse errors */ }
    }

    // 2) Refresh dari server di latar belakang.
    try {
      const r = await api.get('/site-settings');
      const data = (r.data?.data ?? null) as SiteSettings | null;
      if (data) {
        const next = { ...DEFAULT_SETTINGS, ...data };
        set({ settings: next, loaded: true });
        if (typeof window !== 'undefined') {
          try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(next)); } catch { /* quota? */ }
        }
      } else {
        set({ loaded: true });
      }
    } catch {
      // Jaringan gagal? UI tetap pakai cache / default.
      set({ loaded: true });
    }
  },
  replace(s) {
    const next = { ...DEFAULT_SETTINGS, ...s };
    set({ settings: next, loaded: true });
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(next)); } catch { /* quota? */ }
    }
  },
}));
