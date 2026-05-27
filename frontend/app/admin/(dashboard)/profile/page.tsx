'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError, RequestWithKind } from '@/lib/api';
import { useAdminAuth } from '@/lib/stores';

/**
 * Halaman ini dipakai admin untuk mengganti email login dan password admin
 * tanpa harus mengakses database. Untuk mengganti password, admin wajib
 * mengisi password lama (di-verifikasi di backend dengan Hash::check).
 */
export default function AdminProfilePage() {
  const { admin, loadMe } = useAdminAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    if (admin) {
      setName(admin.name ?? '');
      setEmail(admin.email ?? '');
    }
  }, [admin]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.patch('/auth/profile',
        { name, email: email || null },
        { tokenKind: 'admin' } as RequestWithKind,
      );
      toast.success('Profil admin diperbarui');
      await loadMe();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSavingProfile(false); }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password !== passwordConfirm) {
      toast.error('Konfirmasi password tidak cocok.');
      return;
    }
    if (password.length < 3) {
      toast.error('Password baru minimal 3 karakter.');
      return;
    }
    setSavingPwd(true);
    try {
      await api.patch('/auth/profile',
        {
          current_password: currentPassword,
          password,
          password_confirmation: passwordConfirm,
        },
        { tokenKind: 'admin' } as RequestWithKind,
      );
      toast.success('Password admin diperbarui');
      setCurrentPassword('');
      setPassword('');
      setPasswordConfirm('');
    } catch (e) { toast.error(apiError(e)); }
    finally { setSavingPwd(false); }
  }

  if (!admin) {
    return <div className="text-gray-500">Memuat...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Profil Admin</h1>

      <form onSubmit={saveProfile} className="card p-5 space-y-3">
        <h2 className="font-semibold">Data Login Admin</h2>
        <div>
          <label className="label">Nama</label>
          <input
            className="input" required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Email login</label>
          <input
            type="email" className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">
            Email ini yang akan dipakai untuk masuk ke halaman admin.
          </p>
        </div>
        <button disabled={savingProfile} className="btn-primary">
          {savingProfile ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </form>

      <form onSubmit={savePassword} className="card p-5 space-y-3">
        <h2 className="font-semibold">Ganti Password</h2>
        <div>
          <label className="label">Password lama</label>
          <input
            type="password" className="input" required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Password baru</label>
          <input
            type="password" className="input" required minLength={3}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Konfirmasi password baru</label>
          <input
            type="password" className="input" required minLength={3}
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
          />
        </div>
        <button disabled={savingPwd} className="btn-primary">
          {savingPwd ? 'Menyimpan...' : 'Ganti Password'}
        </button>
      </form>
    </div>
  );
}
