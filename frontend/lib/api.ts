import axios, { AxiosError } from 'axios';

export const api = axios.create({
  baseURL: '/api', // proxied to Laravel via next.config rewrites
  withCredentials: true,
  headers: { 'Accept': 'application/json' },
});

export const TOKEN_KEYS = {
  customer: 'ranco_customer_token',
  admin:    'ranco_admin_token',
} as const;

export type TokenKind = keyof typeof TOKEN_KEYS;

export function setToken(kind: TokenKind, token: string | null) {
  if (typeof window === 'undefined') return;
  const k = TOKEN_KEYS[kind];
  if (token) localStorage.setItem(k, token);
  else localStorage.removeItem(k);
}

export function getToken(kind: TokenKind): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEYS[kind]);
}

/** Interceptor: attach admin token on /admin/* routes, otherwise customer token. */
api.interceptors.request.use((config) => {
  if (typeof window === 'undefined') return config;
  const isAdmin = (config.url ?? '').startsWith('/admin');
  const token = localStorage.getItem(isAdmin ? TOKEN_KEYS.admin : TOKEN_KEYS.customer);
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

export function apiError(e: unknown): string {
  const err = e as AxiosError<{ message?: string; errors?: Record<string, string[]> }>;
  if (err?.response?.data?.errors) {
    return Object.values(err.response.data.errors).flat().join(', ');
  }
  return err?.response?.data?.message ?? err?.message ?? 'Terjadi kesalahan.';
}

export const formatRupiah = (n: number) =>
  'Rp ' + (n ?? 0).toLocaleString('id-ID');
