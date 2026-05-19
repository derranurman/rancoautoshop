'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/lib/stores';

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading, setUser } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // Sync local form with the user once it's loaded.
  useEffect(() => {
    if (!user) return;
    setName(user.name ?? '');
    setEmail(user.email ?? '');
    setPhone(user.phone ?? '');
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    // Only send fields that actually changed to keep validation focused.
    const payload: Record<string, string | null> = {};
    if (name.trim() !== (user.name ?? '')) payload.name = name.trim();
    if ((email.trim() || null) !== (user.email ?? null)) payload.email = email.trim() || null;
    if ((phone.trim() || null) !== (user.phone ?? null)) payload.phone = phone.trim() || null;

    if (Object.keys(payload).length === 0) {
      toast('Tidak ada perubahan');
      return;
    }

    setBusy(true);
    try {
      const r = await api.patch('/auth/profile', payload);
      setUser(r.data.user);
      toast.success('Profil disimpan');
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  if (authLoading || !user) {
    return <div className="max-w-2xl mx-auto px-4 py-10 text-gray-500">Memuat...</div>;
  }

  const phoneMissing = !user.phone;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Profil Saya</h1>
        <p className="text-sm text-gray-500">
          Kelola data akunmu. Nomor HP digunakan untuk konfirmasi pesanan dan informasi pengiriman.
        </p>
      </div>

      {phoneMissing && (
        <div className="card p-4 border-yellow-300 bg-yellow-50 text-sm">
          <div className="font-semibold text-yellow-800">Nomor HP belum terdaftar</div>
          <p className="text-yellow-700 mt-1">
            Tambahkan nomor HP-mu di bawah agar admin dan kurir bisa menghubungimu saat pesanan dikirim.
          </p>
        </div>
      )}

      <form onSubmit={submit} className="card p-4 space-y-3">
        <div>
          <label className="label">Nama</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
          />
        </div>

        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="(opsional jika kamu daftar via OTP HP)"
          />
        </div>

        <div>
          <label className="label">
            No. HP {phoneMissing && <span className="text-red-600">*</span>}
          </label>
          <input
            type="tel"
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="08xxxxxxxxxx atau +628xxxxxxxxxx"
            pattern="^\+?\d{8,15}$"
            title="Hanya angka, 8–15 digit. Boleh diawali +."
          />
          <p className="text-xs text-gray-500 mt-1">
            Format: <code>08xx</code> atau <code>+628xx</code>. Akan dinormalisasi ke <code>+62...</code> di server.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Link href="/" className="btn-ghost">Kembali</Link>
          <button type="submit" className="btn-primary disabled:opacity-50" disabled={busy}>
            {busy ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </form>

      <div className="card p-4">
        <h2 className="font-semibold mb-2">Pintasan Akun</h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/account/addresses" className="btn-outline">Alamat Saya</Link>
          <Link href="/orders" className="btn-outline">Pesanan Saya</Link>
        </div>
      </div>
    </div>
  );
}
