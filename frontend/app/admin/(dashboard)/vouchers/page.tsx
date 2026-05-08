'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';

interface Voucher {
  id?: number;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  min_purchase?: number;
  max_discount?: number | null;
  usage_limit?: number | null;
  used_count?: number;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active?: boolean;
}

const EMPTY: Voucher = { code: '', type: 'percent', value: 10, min_purchase: 0, is_active: true };

export default function AdminVouchersPage() {
  const [items, setItems] = useState<Voucher[]>([]);
  const [form, setForm] = useState<Voucher>(EMPTY);
  const [editing, setEditing] = useState<Voucher | null>(null);

  async function load() { const r = await api.get('/admin/vouchers'); setItems(r.data.data); }
  useEffect(() => { load(); }, []);

  async function save() {
    try {
      const payload = { ...form, is_active: !!form.is_active };
      if (editing?.id) await api.put(`/admin/vouchers/${editing.id}`, payload);
      else await api.post('/admin/vouchers', payload);
      toast.success('Voucher tersimpan');
      setForm(EMPTY); setEditing(null); load();
    } catch (e) { toast.error(apiError(e)); }
  }

  function edit(v: Voucher) { setEditing(v); setForm({ ...v }); }

  async function del(v: Voucher) {
    if (!confirm(`Hapus ${v.code}?`)) return;
    await api.delete(`/admin/vouchers/${v.id}`);
    toast.success('Voucher dihapus'); load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Voucher</h1>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-4 md:col-span-1 space-y-3">
          <h2 className="font-semibold">{editing ? 'Edit Voucher' : 'Voucher Baru'}</h2>
          <div><label className="label">Kode</label>
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Tipe</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Voucher['type'] })}>
                <option value="percent">Persen</option><option value="fixed">Nominal</option>
              </select>
            </div>
            <div><label className="label">{form.type === 'percent' ? 'Persen' : 'Nominal (Rp)'}</label>
              <input type="number" className="input" value={form.value} onChange={(e) => setForm({ ...form, value: +e.target.value })} />
            </div>
          </div>
          <div><label className="label">Minimum belanja</label>
            <input type="number" className="input" value={form.min_purchase ?? 0} onChange={(e) => setForm({ ...form, min_purchase: +e.target.value })} />
          </div>
          <div><label className="label">Maks diskon (opsional)</label>
            <input type="number" className="input" value={form.max_discount ?? ''} onChange={(e) => setForm({ ...form, max_discount: e.target.value ? +e.target.value : null })} />
          </div>
          <div><label className="label">Limit pemakaian</label>
            <input type="number" className="input" value={form.usage_limit ?? ''} onChange={(e) => setForm({ ...form, usage_limit: e.target.value ? +e.target.value : null })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Aktif
          </label>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={save}>{editing ? 'Simpan' : 'Tambah'}</button>
            {editing && <button className="btn-outline" onClick={() => { setEditing(null); setForm(EMPTY); }}>Batal</button>}
          </div>
        </div>

        <div className="md:col-span-2 card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr><th className="px-3 py-2">Kode</th><th className="px-3 py-2">Tipe</th><th className="px-3 py-2">Nilai</th><th className="px-3 py-2">Pakai</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono">{v.code}</td>
                  <td className="px-3 py-2">{v.type}</td>
                  <td className="px-3 py-2">{v.type === 'percent' ? `${v.value}%` : formatRupiah(v.value)}</td>
                  <td className="px-3 py-2">{v.used_count ?? 0}/{v.usage_limit ?? '∞'}</td>
                  <td className="px-3 py-2">
                    <span className={`chip ${v.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>{v.is_active ? 'Aktif' : 'Nonaktif'}</span>
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button className="btn-outline" onClick={() => edit(v)}>Edit</button>
                    <button className="btn-outline text-red-600 border-red-300" onClick={() => del(v)}>Hapus</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-gray-500">Belum ada voucher.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
