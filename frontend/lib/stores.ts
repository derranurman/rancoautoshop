'use client';

import { create } from 'zustand';
import { api, getToken, setToken } from './api';
import type { Cart, User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  loadMe: () => Promise<void>;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
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
      const res = await api.get('/admin/dashboard');
      // If this works, we know we have a valid admin token; fetch me separately
      const me = await api.get('/auth/me').catch(() => null);
      const admin = (me?.data?.user ?? null) as User | null;
      if (admin?.role !== 'admin') {
        setToken('admin', null);
        set({ admin: null, loading: false });
        return;
      }
      set({ admin, loading: false });
      // Reference to avoid unused warning
      void res;
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
    try { await api.post('/auth/logout'); } catch {}
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
