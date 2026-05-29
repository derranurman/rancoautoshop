'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import { useAdminAuth } from '@/lib/stores';

export default function AdminLoginPage() {
  const router = useRouter();
  const { login } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/admin/login', { email, password });
      login(res.data.token, res.data.user);
      toast.success('Selamat datang, Admin');
      router.push('/admin/dashboard');
    } catch (e) {
      toast.error(apiError(e));
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-ink text-white grid place-items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-6">
          <span className="inline-block h-10 w-10 rounded-lg bg-brand grid place-items-center font-bold">R</span>
          <h1 className="text-2xl font-bold">Ranco Autoshop — Admin</h1>
        </div>
        <form onSubmit={onSubmit} className="bg-white text-ink rounded-xl p-6 space-y-3 shadow-xl">
          <h2 className="text-lg font-semibold">Masuk sebagai Admin</h2>
          <div><label className="label">Email Admin</label>
            <input type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div><label className="label">Password</label>
            <input type="password" className="input" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button disabled={loading} className="btn-primary w-full">{loading ? 'Memproses...' : 'Masuk'}</button>
          <p className="text-xs text-gray-500 text-center">Halaman ini khusus untuk admin toko. Pelanggan silakan ke halaman login utama.</p>
        </form>
      </div>
    </div>
  );
}
