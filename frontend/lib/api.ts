import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

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

/**
 * Allow callers to override which token to send for a request, e.g.
 *   api.get('/auth/me', { tokenKind: 'admin' } as RequestWithKind)
 */
export type RequestWithKind = AxiosRequestConfig & { tokenKind?: TokenKind };

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

/**
 * Pick the correct token for the current request.
 * Priority:
 *   1. explicit `config.tokenKind` set by the caller
 *   2. URL starts with `/admin/...` (admin-only endpoints)
 *   3. We are currently on an admin page (e.g. shared endpoints like /auth/me, /auth/logout)
 *   4. customer (default)
 */
function resolveTokenKind(config: InternalAxiosRequestConfig & { tokenKind?: TokenKind }): TokenKind {
  if (config.tokenKind) return config.tokenKind;
  const url = config.url ?? '';
  if (url.startsWith('/admin')) return 'admin';
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return 'admin';
  }
  return 'customer';
}

api.interceptors.request.use((config) => {
  if (typeof window === 'undefined') return config;
  const kind = resolveTokenKind(config as InternalAxiosRequestConfig & { tokenKind?: TokenKind });
  const token = localStorage.getItem(TOKEN_KEYS[kind]);
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
