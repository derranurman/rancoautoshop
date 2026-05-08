'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import type { Category } from '@/lib/types';

interface FormState {
  category_id: number | '';
  name: string;
  description: string;
  price: number;
  operational_cost: number;
  stock: number;
  weight: number;
  images: string[];
  is_active: boolean;
}

const DEFAULT: FormState = {
  category_id: '', name: '', description: '',
  price: 0, operational_cost: 0, stock: 0, weight: 1000, images: [], is_active: true,
};

export default function ProductForm({ productId }: { productId?: number }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [cats, setCats] = useState<Category[]>([]);
  const [imageInput, setImageInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/admin/categories').then((r) => setCats(r.data.data));
    if (productId) {
      api.get(`/admin/products/${productId}`).then((r) => {
        const p = r.data.data;
        setForm({
          category_id: p.category_id ?? '',
          name: p.name ?? '', description: p.description ?? '',
          price: p.price, operational_cost: p.operational_cost,
          stock: p.stock, weight: p.weight,
          images: p.images ?? [], is_active: !!p.is_active,
        });
      });
    }
  }, [productId]);

  function addImage() {
    const v = imageInput.trim();
    if (!v) return;
    setForm({ ...form, images: [...form.images, v] });
    setImageInput('');
  }

  function removeImage(i: number) {
    setForm({ ...form, images: form.images.filter((_, idx) => idx !== i) });
  }

  async function submit() {
    setLoading(true);
    try {
      const payload = { ...form, category_id: form.category_id === '' ? null : form.category_id };
      if (productId) await api.put(`/admin/products/${productId}`, payload);
      else await api.post('/admin/products', payload);
      toast.success('Produk disimpan');
      router.push('/admin/products');
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }

  const sellingPrice = form.price + form.operational_cost;

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">{productId ? 'Edit Produk' : 'Produk Baru'}</h1>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4 space-y-3">
          <div><label className="label">Nama produk</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div><label className="label">Kategori</label>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value === '' ? '' : +e.target.value })}>
              <option value="">— pilih —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label">Deskripsi</label>
            <textarea className="input" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Aktif (tampil di katalog)
          </label>
        </div>
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Harga dasar (Rp)</label>
              <input type="number" className="input" value={form.price} onChange={(e) => setForm({ ...form, price: +e.target.value })} />
            </div>
            <div><label className="label">Biaya operasional (Rp)</label>
              <input type="number" className="input" value={form.operational_cost} onChange={(e) => setForm({ ...form, operational_cost: +e.target.value })} />
            </div>
            <div><label className="label">Stok</label>
              <input type="number" className="input" value={form.stock} onChange={(e) => setForm({ ...form, stock: +e.target.value })} />
            </div>
            <div><label className="label">Berat (gram)</label>
              <input type="number" className="input" value={form.weight} onChange={(e) => setForm({ ...form, weight: +e.target.value })} />
            </div>
          </div>
          <div className="card bg-gray-50 p-3 text-sm">
            <div className="flex justify-between"><span>Harga tampil ke user</span><b>{formatRupiah(sellingPrice)}</b></div>
            <div className="text-xs text-gray-500 mt-1">= Harga dasar + Biaya operasional. Ongkir ditambahkan di checkout.</div>
          </div>

          <div>
            <label className="label">Foto (URL)</label>
            <div className="flex gap-2">
              <input className="input" placeholder="https://..." value={imageInput} onChange={(e) => setImageInput(e.target.value)} />
              <button onClick={addImage} className="btn-outline">+</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {form.images.map((img, i) => (
                <div key={i} className="relative w-16 h-16">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" className="w-16 h-16 object-cover rounded border" />
                  <button onClick={() => removeImage(i)} className="absolute -top-1 -right-1 bg-red-600 text-white text-xs w-5 h-5 rounded-full">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={loading} className="btn-primary">{loading ? 'Menyimpan...' : 'Simpan'}</button>
        <button onClick={() => router.back()} className="btn-outline">Batal</button>
      </div>
    </div>
  );
}
