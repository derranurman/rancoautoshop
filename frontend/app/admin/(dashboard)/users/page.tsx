'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import type { User } from '@/lib/types';

interface UserForm {
  id?: number;
  name: string;
  email: string;
  phone: string;
  password: string;
  is_active: boolean;
}

const EMPTY_FORM: UserForm = {
  name: '',
  email: '',
  phone: '',
  password: '',
  is_active: true,
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const r = await api.get('/admin/users', { params: { search } });
      setUsers(r.data.data);
    } catch (e) { toast.error(apiError(e)); }
  }
  useEffect(() => { load(); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate() {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(u: User) {
    setForm({
      id: u.id,
      name: u.name ?? '',
      email: u.email ?? '',
      phone: u.phone ?? '',
      password: '',
      is_active: u.is_active ?? true,
    });
    setModalOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Build payload — only include password when admin actually filled it
      // on edit (kosong = jangan ubah). Email/phone dikirim null bila kosong.
      const payload: Record<string, unknown> = {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        is_active: form.is_active,
      };
      if (form.password) payload.password = form.password;

      if (form.id) {
        await api.patch(`/admin/users/${form.id}`, payload);
        toast.success('Pelanggan diperbarui');
      } else {
        if (!form.password) {
          toast.error('Password wajib diisi untuk pelanggan baru.');
          setSaving(false);
          return;
        }
        await api.post('/admin/users', payload);
        toast.success('Pelanggan ditambahkan');
      }
      setModalOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) { toast.error(apiError(e)); }
    finally { setSaving(false); }
  }

  async function toggle(u: User) {
    if (!confirm(u.is_active ? `Suspend ${u.name}?` : `Aktifkan kembali ${u.name}?`)) return;
    try {
      await api.patch(`/admin/users/${u.id}/toggle-suspend`);
      toast.success('Status diperbarui');
      load();
    } catch (e) { toast.error(apiError(e)); }
  }

  async function remove(u: User) {
    if (!confirm(`Hapus pelanggan "${u.name}" secara permanen? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast.success('Pelanggan dihapus');
      load();
    } catch (e) { toast.error(apiError(e)); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">Pelanggan</h1>
        <div className="flex gap-2">
          <input className="input max-w-xs" placeholder="Cari nama/email/HP" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button onClick={openCreate} className="btn-primary whitespace-nowrap">+ Tambah Pelanggan</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">HP</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Aksi</th>
            </tr>
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
                  <div className="inline-flex gap-1">
                    <button onClick={() => openEdit(u)} className="btn-outline text-xs">Edit</button>
                    <button onClick={() => toggle(u)} className="btn-outline text-xs">
                      {u.is_active ? 'Suspend' : 'Aktifkan'}
                    </button>
                    <button onClick={() => remove(u)} className="btn-outline text-xs text-red-600 border-red-200 hover:bg-red-50">
                      Hapus
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-500">Tidak ada pelanggan.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <form onSubmit={save} className="bg-white rounded-xl w-full max-w-md p-5 space-y-3 shadow-xl">
            <h2 className="text-lg font-bold">{form.id ? 'Edit Pelanggan' : 'Tambah Pelanggan'}</h2>
            <div>
              <label className="label">Nama lengkap</label>
              <input
                className="input" required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                type="email" className="input"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="label">No. HP</label>
              <input
                className="input"
                placeholder="08xxxxxxxxxx"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="label">
                Password {form.id && <span className="text-xs font-normal text-gray-500">(kosongkan jika tidak diubah)</span>}
              </label>
              <input
                type="password" className="input"
                minLength={form.id ? 0 : 3}
                required={!form.id}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Akun aktif
            </label>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Batal</button>
              <button disabled={saving} className="btn-primary">{saving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
