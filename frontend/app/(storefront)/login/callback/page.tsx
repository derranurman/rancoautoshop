'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '@/lib/api';
import { useAuth } from '@/lib/stores';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();

  useEffect(() => {
    const hash = window.location.hash;
    const match = /token=([^&]+)/.exec(hash);
    if (!match) { router.replace('/login'); return; }
    const token = decodeURIComponent(match[1]);
    setToken('customer', token);
    api.get('/auth/me').then((r) => {
      login(token, r.data.user);
      router.replace('/');
    }).catch(() => router.replace('/login'));
  }, [router, login]);

  return <div className="max-w-md mx-auto px-4 py-10 text-gray-500">Menyelesaikan login Google...</div>;
}
