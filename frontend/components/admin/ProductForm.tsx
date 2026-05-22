'use client';

import { useEffect, useRef, useState } from 'react';
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

const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — must match backend validation

export default function ProductForm({ productId }: { productId?: number }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [cats, setCats] = useState<Category[]>([]);
  const [imageInput, setImageInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  function addImageUrl() {
    const v = imageInput.trim();
    if (!v) return;
    setForm((f) => ({ ...f, images: [...f.images, v] }));
    setImageInput('');
  }

  function removeImage(i: number) {
    setForm((f) => ({ ...f, images: f.images.filter((_, idx) => idx !== i) }));
  }

  function moveImage(i: number, direction: -1 | 1) {
    setForm((f) => {
      const next = [...f.images];
      const j = i + direction;
      if (j < 0 || j >= next.length) return f;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, images: next };
    });
  }

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    // Client-side validation so the user gets fast feedback before the upload.
    const valid: File[] = [];
    for (const f of files) {
      if (!ACCEPTED.split(',').includes(f.type)) {
        toast.error(`${f.name}: format tidak didukung`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name}: maks. 5 MB`);
        continue;
      }
      valid.push(f);
    }
    if (valid.length === 0) return;

    setUploading((n) => n + valid.length);

    // Upload in parallel; collect URLs in order so the displayed order is stable.
    const results = await Promise.all(
      valid.map(async (file) => {
        const fd = new FormData();
        fd.append('image', file);
        try {
          const r = await api.post('/admin/products/upload-image', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          return r.data.url as string;
        } catch (e) {
          toast.error(`${file.name}: ${apiError(e)}`);
          return null;
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );

    const okUrls = results.filter((u): u is string => !!u);
    if (okUrls.length === 0) return;
    setForm((f) => ({ ...f, images: [...f.images, ...okUrls] }));
    toast.success(`${okUrls.length} foto diunggah`);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length) {
      void uploadFiles(e.target.files);
      e.target.value = ''; // allow re-selecting the same file
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
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
            <select className="input" value={form.category_id}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value === '' ? '' : +e.target.value })}>
              <option value="">— pilih —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label">Deskripsi</label>
            <textarea className="input" rows={4} value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active}
                   onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Aktif (tampil di katalog)
          </label>
        </div>

        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Harga dasar (Rp)</label>
              <input type="number" className="input" value={form.price}
                     onChange={(e) => setForm({ ...form, price: +e.target.value })} />
            </div>
            <div><label className="label">Biaya operasional (Rp)</label>
              <input type="number" className="input" value={form.operational_cost}
                     onChange={(e) => setForm({ ...form, operational_cost: +e.target.value })} />
            </div>
            <div><label className="label">Stok</label>
              <input type="number" className="input" value={form.stock}
                     onChange={(e) => setForm({ ...form, stock: +e.target.value })} />
            </div>
            <div><label className="label">Berat (gram)</label>
              <input type="number" className="input" value={form.weight}
                     onChange={(e) => setForm({ ...form, weight: +e.target.value })} />
            </div>
          </div>
          <div className="card bg-gray-50 p-3 text-sm">
            <div className="flex justify-between"><span>Harga tampil ke user</span><b>{formatRupiah(sellingPrice)}</b></div>
            <div className="text-xs text-gray-500 mt-1">= Harga dasar + Biaya operasional. Ongkir ditambahkan di checkout.</div>
          </div>

          {/* ---------------- Image uploader ---------------- */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label !mb-0">Foto produk</label>
              <button type="button"
                      className="text-xs text-brand hover:underline"
                      onClick={() => setShowUrlInput((v) => !v)}>
                {showUrlInput ? 'Tutup tempel URL' : 'Tempel URL'}
              </button>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center text-sm text-gray-500 cursor-pointer hover:border-brand hover:bg-brand/5"
            >
              <div className="font-medium text-gray-700">Klik untuk pilih dari komputer</div>
              <div className="text-xs">atau drag &amp; drop file ke sini · JPG / PNG / WEBP / GIF · maks. 5 MB · multi-file OK</div>
              {uploading > 0 && (
                <div className="mt-2 text-xs text-brand">Mengunggah {uploading} foto...</div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED}
                multiple
                className="hidden"
                onChange={onPick}
              />
            </div>

            {showUrlInput && (
              <div className="flex gap-2 mt-2">
                <input className="input" placeholder="https://contoh.com/foto.jpg"
                       value={imageInput} onChange={(e) => setImageInput(e.target.value)} />
                <button type="button" onClick={addImageUrl} className="btn-outline">Tambah</button>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {form.images.map((img, i) => (
                <div key={`${img}-${i}`} className="relative w-20 h-20 group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt="" className="w-20 h-20 object-cover rounded border" />
                  <button type="button"
                          title="Hapus"
                          onClick={() => removeImage(i)}
                          className="absolute -top-1 -right-1 bg-red-600 text-white text-xs w-5 h-5 rounded-full">
                    ×
                  </button>
                  {i === 0 && (
                    <span className="absolute bottom-0 left-0 text-[10px] bg-black/70 text-white px-1 rounded-tr">
                      Utama
                    </span>
                  )}
                  <div className="absolute bottom-0 right-0 hidden group-hover:flex gap-0.5 bg-black/60 rounded-tl">
                    <button type="button" title="Geser kiri"
                            onClick={(e) => { e.stopPropagation(); moveImage(i, -1); }}
                            disabled={i === 0}
                            className="text-white text-xs px-1 disabled:opacity-30">‹</button>
                    <button type="button" title="Geser kanan"
                            onClick={(e) => { e.stopPropagation(); moveImage(i, 1); }}
                            disabled={i === form.images.length - 1}
                            className="text-white text-xs px-1 disabled:opacity-30">›</button>
                  </div>
                </div>
              ))}
              {form.images.length === 0 && (
                <div className="text-xs text-gray-400">Belum ada foto.</div>
              )}
            </div>
          </div>
          {/* ----------------------------------------------- */}
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={submit} disabled={loading || uploading > 0}
                className="btn-primary disabled:opacity-50">
          {loading ? 'Menyimpan...' : uploading > 0 ? 'Menunggu unggah...' : 'Simpan'}
        </button>
        <button onClick={() => router.back()} className="btn-outline">Batal</button>
      </div>
    </div>
  );
}
