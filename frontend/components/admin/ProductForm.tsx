'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import type { Category } from '@/lib/types';

/**
 * Draft varian saat editing di form admin. Kalau punya `id`, varian ini sudah
 * ada di DB dan akan di-update; kalau tidak, baris ini akan di-create saat submit.
 */
interface VariantDraft {
  id?: number;
  name: string;
  sku: string;
  stock: number;
  /** Harga override; string supaya input bisa kosong = "ikut harga produk". */
  price_override: string;
  weight_override: string;
  image: string | null;
  is_active: boolean;
}

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
  variants: VariantDraft[];
}

const DEFAULT: FormState = {
  category_id: '', name: '', description: '',
  price: 0, operational_cost: 0, stock: 0, weight: 1000, images: [], is_active: true,
  variants: [],
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

  /**
   * When false (default), `operational_cost` is auto-derived from
   *   harga × persen kategori
   * and the input is read-only. When the admin clicks "Atur manual",
   * we flip this to true and let them type any value.
   *
   * For new products the form starts in auto mode. For existing products
   * we infer: if their saved operational_cost matches the current category
   * percent calc, treat as auto; otherwise default to manual so we don't
   * silently overwrite a custom value on first save.
   */
  const [opsManual, setOpsManual] = useState(false);

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
          variants: Array.isArray(p.variants)
            ? p.variants.map((v: {
                id: number; name: string; sku: string | null; stock: number;
                price_override: number | null; weight_override?: number | null;
                image: string | null; is_active: boolean;
              }) => ({
                id: v.id,
                name: v.name ?? '',
                sku: v.sku ?? '',
                stock: v.stock ?? 0,
                price_override: v.price_override == null ? '' : String(v.price_override),
                weight_override: v.weight_override == null ? '' : String(v.weight_override),
                image: v.image ?? null,
                is_active: v.is_active !== false,
              }))
            : [],
        });
      });
    }
  }, [productId]);

  /**
   * Persen biaya ops dari kategori yang dipilih. Pakai useMemo agar perubahan
   * select tidak men-trigger re-compute kalau cats belum loaded.
   */
  const selectedCategory = useMemo(() => {
    if (form.category_id === '') return null;
    return cats.find((c) => c.id === form.category_id) ?? null;
  }, [cats, form.category_id]);

  const categoryPercent = useMemo(() => {
    if (!selectedCategory) return 0;
    const raw = selectedCategory.operational_cost_percent;
    const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw ?? 0);
    return Number.isFinite(n) ? n : 0;
  }, [selectedCategory]);

  /** Auto-computed ops cost based on current price + selected category. */
  const autoOpsCost = useMemo(
    () => Math.round((form.price || 0) * categoryPercent / 100),
    [form.price, categoryPercent],
  );

  // When admin loads an existing product, decide auto vs manual based on whether
  // the stored value matches what auto would compute right now. This runs once
  // whenever both the product data and categories are available.
  const decidedRef = useRef(false);
  useEffect(() => {
    if (decidedRef.current) return;
    if (cats.length === 0) return;
    if (productId && form.name === '') return; // product not yet loaded
    decidedRef.current = true;
    if (productId) {
      // Existing product: keep stored value, default to manual mode unless it
      // matches the auto calc (within 1 rupiah of rounding).
      const matches = Math.abs(form.operational_cost - autoOpsCost) <= 1;
      setOpsManual(!matches);
    } else {
      // New product: start in auto.
      setOpsManual(false);
      setForm((f) => ({ ...f, operational_cost: 0 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cats, productId, form.name]);

  // Whenever auto mode is on, keep the form's operational_cost in sync with
  // the auto value so what we display in the read-only input matches what we
  // submit.
  useEffect(() => {
    if (opsManual) return;
    setForm((f) => (f.operational_cost === autoOpsCost ? f : { ...f, operational_cost: autoOpsCost }));
  }, [opsManual, autoOpsCost]);

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
      e.target.value = '';
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
  }

  /* --------------------- Variants helpers --------------------- */

  function addVariant() {
    setForm((f) => ({
      ...f,
      variants: [
        ...f.variants,
        {
          name: '',
          sku: '',
          stock: 0,
          price_override: '',
          weight_override: '',
          image: null,
          is_active: true,
        },
      ],
    }));
  }

  function updateVariant(idx: number, patch: Partial<VariantDraft>) {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }));
  }

  function removeVariant(idx: number) {
    setForm((f) => ({ ...f, variants: f.variants.filter((_, i) => i !== idx) }));
  }

  async function uploadVariantImage(idx: number, file: File) {
    if (!ACCEPTED.split(',').includes(file.type)) {
      toast.error('Format foto tidak didukung'); return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Foto maks. 5 MB'); return;
    }
    setUploading((n) => n + 1);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const r = await api.post('/admin/products/upload-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      updateVariant(idx, { image: r.data.url as string });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setUploading((n) => n - 1);
    }
  }

  /** Total stok semua varian (preview untuk admin). */
  const variantsTotalStock = useMemo(
    () => form.variants.reduce((s, v) => s + (Number.isFinite(v.stock) ? Number(v.stock) : 0), 0),
    [form.variants],
  );
  const hasVariants = form.variants.length > 0;

  async function submit() {
    // Validasi varian sebelum kirim — backend juga validate, tapi UX lebih bagus.
    if (hasVariants) {
      for (const [i, v] of form.variants.entries()) {
        if (!v.name.trim()) {
          toast.error(`Varian ke-${i + 1} belum ada nama.`);
          return;
        }
        if (Number(v.stock) < 0 || !Number.isFinite(Number(v.stock))) {
          toast.error(`Stok varian "${v.name || i + 1}" tidak valid.`);
          return;
        }
      }
      // Cek nama duplikat (case-insensitive).
      const seen = new Set<string>();
      for (const v of form.variants) {
        const k = v.name.trim().toLowerCase();
        if (seen.has(k)) {
          toast.error(`Nama varian "${v.name}" duplikat.`);
          return;
        }
        seen.add(k);
      }
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        category_id: form.category_id === '' ? null : form.category_id,
        name: form.name,
        description: form.description,
        price: form.price,
        // stock akan ditimpa oleh server kalau ada varian (jadi total agregat),
        // tetap dikirim sebagai fallback untuk produk tanpa varian.
        stock: hasVariants ? variantsTotalStock : form.stock,
        weight: form.weight,
        images: form.images,
        is_active: form.is_active,
      };
      // In auto mode we omit operational_cost so the backend recomputes
      // from category percent.
      if (opsManual) {
        payload.operational_cost = form.operational_cost;
      }
      // Hanya kirim variants kalau admin secara eksplisit ingin mengubah
      // (form selalu bawa array; kalau kosong di product yang sebelumnya
      // punya varian, ini akan menghapus semua → memang itu intent admin).
      payload.variants = form.variants.map((v, i) => ({
        id: v.id,
        name: v.name.trim(),
        sku: v.sku.trim() || null,
        stock: Number(v.stock) || 0,
        price_override: v.price_override === '' ? null : Number(v.price_override),
        weight_override: v.weight_override === '' ? null : Number(v.weight_override),
        image: v.image,
        is_active: v.is_active,
        sort_order: i,
      }));

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
              {cats.map((c) => {
                const pct = c.operational_cost_percent;
                const pctNum = typeof pct === 'string' ? parseFloat(pct) : Number(pct ?? 0);
                return (
                  <option key={c.id} value={c.id}>
                    {c.name}{pctNum > 0 ? ` (${pctNum}% ops)` : ''}
                  </option>
                );
              })}
            </select>
            {selectedCategory && categoryPercent > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                Biaya operasional default kategori ini: {categoryPercent}% dari harga.
              </div>
            )}
            {selectedCategory && categoryPercent === 0 && (
              <div className="text-xs text-yellow-700 mt-1">
                Kategori ini belum punya persen biaya ops. Atur di
                halaman Produk &rarr; <b>Kelola Kategori</b>.
              </div>
            )}
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
            <div>
              <label className="label">Harga dasar (Rp)</label>
              <input type="number" className="input" value={form.price}
                     onChange={(e) => setForm({ ...form, price: +e.target.value })} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label !mb-0">Biaya operasional (Rp)</label>
                <button
                  type="button"
                  className="text-xs text-brand hover:underline"
                  onClick={() => setOpsManual((v) => !v)}
                >
                  {opsManual ? 'Pakai otomatis' : 'Atur manual'}
                </button>
              </div>
              <input
                type="number"
                className={`input ${opsManual ? '' : 'bg-gray-50 cursor-not-allowed'}`}
                value={form.operational_cost}
                onChange={(e) => setForm({ ...form, operational_cost: +e.target.value })}
                readOnly={!opsManual}
                tabIndex={opsManual ? 0 : -1}
              />
              <div className="text-xs text-gray-500 mt-1">
                {opsManual ? (
                  <>Manual override. Klik &ldquo;Pakai otomatis&rdquo; untuk balik ke
                  hitungan dari kategori.</>
                ) : selectedCategory && categoryPercent > 0 ? (
                  <>Otomatis = {formatRupiah(form.price)} &times; {categoryPercent}%
                  &nbsp;=&nbsp; <b>{formatRupiah(autoOpsCost)}</b>.</>
                ) : (
                  <>Pilih kategori dengan persen ops untuk hitungan otomatis,
                  atau klik &ldquo;Atur manual&rdquo;.</>
                )}
              </div>
            </div>
            <div>
              <label className="label">Stok {hasVariants && <span className="text-xs text-gray-400">(total varian)</span>}</label>
              <input
                type="number"
                className={`input ${hasVariants ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                value={hasVariants ? variantsTotalStock : form.stock}
                onChange={(e) => setForm({ ...form, stock: +e.target.value })}
                readOnly={hasVariants}
              />
              {hasVariants && (
                <div className="text-xs text-gray-500 mt-1">
                  Stok dihitung otomatis dari total semua varian aktif.
                </div>
              )}
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
        </div>
      </div>

      {/* ---------------- Variants editor ---------------- */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">Varian Produk (opsional)</h2>
            <p className="text-xs text-gray-500">
              Misal: warna (Merah, Biru, Hitam), ukuran, atau ukuran roda. Setiap varian
              boleh punya stok &amp; harga sendiri. Kalau dikosongkan, produk dianggap tunggal —
              stok &amp; harga di atas yang dipakai.
            </p>
          </div>
          <button type="button" className="btn-outline" onClick={addVariant}>
            + Tambah Varian
          </button>
        </div>

        {form.variants.length === 0 && (
          <div className="text-sm text-gray-400 italic">
            Belum ada varian. Klik &ldquo;+ Tambah Varian&rdquo; untuk membuat warna/ukuran.
          </div>
        )}

        <div className="space-y-2">
          {form.variants.map((v, i) => (
            <VariantRow
              key={v.id ?? `new-${i}`}
              draft={v}
              onChange={(patch) => updateVariant(i, patch)}
              onRemove={() => removeVariant(i)}
              onPickImage={(file) => uploadVariantImage(i, file)}
              productPrice={form.price}
              productOpsCost={form.operational_cost}
              productWeight={form.weight}
            />
          ))}
        </div>

        {hasVariants && (
          <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded p-2">
            Total stok semua varian aktif: <b>{variantsTotalStock}</b> unit.
            Pelanggan wajib memilih varian sebelum bisa menambahkan ke keranjang / Beli Sekarang.
          </div>
        )}
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

/* --------------------- Sub: VariantRow --------------------- */

function VariantRow({
  draft, onChange, onRemove, onPickImage,
  productPrice, productOpsCost, productWeight,
}: {
  draft: VariantDraft;
  onChange: (patch: Partial<VariantDraft>) => void;
  onRemove: () => void;
  onPickImage: (file: File) => void;
  productPrice: number;
  productOpsCost: number;
  productWeight: number;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const effectivePrice =
    draft.price_override === '' ? productPrice : Number(draft.price_override) || 0;
  const sellingPrice = effectivePrice + productOpsCost;
  const effectiveWeight =
    draft.weight_override === '' ? productWeight : Number(draft.weight_override) || 0;

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-white">
      <div className="flex items-start gap-3 flex-wrap">
        <div
          onClick={() => fileRef.current?.click()}
          className="w-16 h-16 rounded-md bg-gray-50 border border-dashed border-gray-300 grid place-items-center text-xs text-gray-500 cursor-pointer overflow-hidden shrink-0 hover:border-brand"
          title="Klik untuk unggah foto varian"
        >
          {draft.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.image} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="px-1 text-center leading-tight">Foto<br />varian</span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPickImage(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-0">
          <div className="col-span-2">
            <label className="label text-xs">Nama varian</label>
            <input
              className="input"
              placeholder="cth: Merah / 14 inch / L"
              value={draft.name}
              onChange={(e) => onChange({ name: e.target.value })}
              maxLength={120}
            />
          </div>
          <div>
            <label className="label text-xs">SKU (opsional)</label>
            <input
              className="input"
              placeholder="STR-MRH-14"
              value={draft.sku}
              onChange={(e) => onChange({ sku: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <label className="label text-xs">Stok</label>
            <input
              type="number"
              min={0}
              className="input"
              value={draft.stock}
              onChange={(e) => onChange({ stock: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label text-xs">Harga override (Rp)</label>
            <input
              type="number"
              min={0}
              className="input"
              placeholder={`ikut ${productPrice.toLocaleString('id-ID')}`}
              value={draft.price_override}
              onChange={(e) => onChange({ price_override: e.target.value })}
            />
            <div className="text-[10px] text-gray-500 mt-0.5">
              Kosongkan → ikut harga produk. Harga jual ke pelanggan saat varian ini dipilih:{' '}
              <b>{formatRupiah(sellingPrice)}</b>
            </div>
          </div>
          <div>
            <label className="label text-xs">Berat override (g)</label>
            <input
              type="number"
              min={1}
              className="input"
              placeholder={`ikut ${productWeight}`}
              value={draft.weight_override}
              onChange={(e) => onChange({ weight_override: e.target.value })}
            />
            <div className="text-[10px] text-gray-500 mt-0.5">
              Berat efektif: <b>{effectiveWeight} g</b>
            </div>
          </div>
          <div className="col-span-2 flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => onChange({ is_active: e.target.checked })}
              />
              Aktif
            </label>
            <button
              type="button"
              onClick={onRemove}
              className="ml-auto text-xs text-red-600 hover:underline"
            >
              Hapus varian
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
