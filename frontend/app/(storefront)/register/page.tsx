'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/lib/stores';

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', password_confirmation: '',
  });
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/register', form);
      login(res.data.token, res.data.user);
      toast.success('Pendaftaran berhasil');
      router.push('/');
    } catch (e) {
      toast.error(apiError(e));
    } finally { setLoading(false); }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-4">Daftar Akun Baru</h1>
      <form onSubmit={onSubmit} className="card p-5 space-y-3">
        <div><label className="label">Nama lengkap</label>
          <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div><label className="label">Email</label>
          <input type="email" className="input" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div><label className="label">Nomor HP (opsional)</label>
          <input className="input" placeholder="08xxxxxxxxxx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div><label className="label">Password</label>
          <input type="password" className="input" required minLength={3} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div><label className="label">Konfirmasi password</label>
          <input type="password" className="input" required minLength={3} value={form.password_confirmation} onChange={(e) => setForm({ ...form, password_confirmation: e.target.value })} />
        </div>
        <button disabled={loading} className="btn-primary w-full">{loading ? 'Mendaftar...' : 'Daftar'}</button>
        <div className="text-sm text-gray-600 text-center">
          Sudah punya akun? <Link href="/login" className="text-brand font-medium">Masuk</Link>
        </div>
      </form>
    </div>
  );
}
