'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import type { User } from '@/lib/types';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');

  async function load() {
    const r = await api.get('/admin/users', { params: { search } });
    setUsers(r.data.data);
  }
  useEffect(() => { load(); }, [search]);

  async function toggle(u: User) {
    if (!confirm(u.is_active ? `Suspend ${u.name}?` : `Aktifkan kembali ${u.name}?`)) return;
    try {
      await api.patch(`/admin/users/${u.id}/toggle-suspend`);
      toast.success('Status diperbarui');
      load();
    } catch (e) { toast.error(apiError(e)); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Pelanggan</h1>
        <input className="input max-w-xs" placeholder="Cari nama/email/HP" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr><th className="px-3 py-2">Nama</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">HP</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2">{u.email ?? '—'}</td>
                <td className="px-3 py-2">{u.phone ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`chip ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {u.is_active ? 'Aktif' : 'Disuspend'}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => toggle(u)} className="btn-outline">
                    {u.is_active ? 'Suspend' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-500">Tidak ada pelanggan.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
