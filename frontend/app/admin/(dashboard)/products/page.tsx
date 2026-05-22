'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import type { Category } from '@/lib/types';

interface AdminProduct {
  id: number; name: string; slug: string;
  price: number; operational_cost: number;
  stock: number; weight: number; is_active: boolean;
  category?: { id: number; name: string; slug: string } | null;
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showOpsCostModal, setShowOpsCostModal] = useState(false);

  async function loadCategories() {
    try {
      const r = await api.get('/admin/categories');
      setCategories(r.data.data ?? []);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function loadProducts() {
    setLoading(true);
    try {
      const r = await api.get('/admin/products', {
        params: {
          search: search || undefined,
          category_id: categoryFilter || undefined,
        },
      });
      setProducts(r.data.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCategories(); }, []);
  useEffect(() => { loadProducts(); /* eslint-disable-next-line */ }, [search, categoryFilter]);

  async function remove(p: AdminProduct) {
    if (!confirm(`Hapus ${p.name}?`)) return;
    try {
      await api.delete(`/admin/products/${p.id}`);
      toast.success('Dihapus');
      loadProducts();
    } catch (e) { toast.error(apiError(e)); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h1 className="text-2xl font-bold">Produk</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowOpsCostModal(true)}
            className="btn-outline"
            title="Atur biaya operasional otomatis sebagai persentase dari harga"
          >
            Atur Biaya Ops %
          </button>
          <button
            type="button"
            onClick={() => setShowCategoryModal(true)}
            className="btn-outline"
          >
            + Kategori Baru
          </button>
          <Link href="/admin/products/new" className="btn-primary">+ Tambah Produk</Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Cari nama produk..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input max-w-xs"
          value={String(categoryFilter)}
          onChange={(e) => setCategoryFilter(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">Semua kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {(search || categoryFilter !== '') && (
          <button
            type="button"
            onClick={() => { setSearch(''); setCategoryFilter(''); }}
            className="btn-ghost text-sm"
          >
            Reset filter
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2">Produk</th>
              <th className="px-3 py-2">Kategori</th>
              <th className="px-3 py-2 text-right">Harga</th>
              <th className="px-3 py-2 text-right">Biaya Ops</th>
              <th className="px-3 py-2 text-right">Stok</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">Memuat...</td></tr>
            )}
            {!loading && products.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                {search || categoryFilter ? 'Tidak ada produk yang cocok dengan filter.' : 'Belum ada produk.'}
              </td></tr>
            )}
            {products.map((p) => {
              const pct = p.price > 0
                ? ((p.operational_cost / p.price) * 100).toFixed(1)
                : null;
              return (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2">{p.category?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{formatRupiah(p.price)}</td>
                  <td className="px-3 py-2 text-right">
                    <div>{formatRupiah(p.operational_cost)}</div>
                    {pct && <div className="text-[10px] text-gray-500">{pct}%</div>}
                  </td>
                  <td className="px-3 py-2 text-right">{p.stock}</td>
                  <td className="px-3 py-2">
                    <span className={`chip ${p.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}>
                      {p.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <Link href={`/admin/products/${p.id}`} className="btn-outline">Edit</Link>
                    <button onClick={() => remove(p)} className="btn-outline text-red-600 border-red-300">Hapus</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCategoryModal && (
        <CategoryModal
          onClose={() => setShowCategoryModal(false)}
          onSaved={() => { loadCategories(); }}
        />
      )}

      {showOpsCostModal && (
        <OpsCostModal
          categories={categories}
          activeCategoryId={categoryFilter || null}
          onClose={() => setShowOpsCostModal(false)}
          onApplied={() => { loadProducts(); }}
        />
      )}
    </div>
  );
}

/* --------------------- Modal: Tambah Kategori --------------------- */

function CategoryModal({
  onClose, onSaved,
}: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/categories', {
        name: name.trim(),
        description: description.trim() || null,
      });
      toast.success('Kategori ditambahkan');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  }

  return (
    <ModalShell title="Tambah Kategori Baru" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Nama kategori</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
            maxLength={120}
            placeholder="cth: Stir & Kemudi"
          />
        </div>
        <div>
          <label className="label">Deskripsi (opsional)</label>
          <textarea
            className="input min-h-[60px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="submit" className="btn-primary disabled:opacity-50" disabled={busy || !name.trim()}>
            {busy ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* --------------------- Modal: Atur Biaya Operasional % --------------------- */

function OpsCostModal({
  categories, activeCategoryId, onClose, onApplied,
}: {
  categories: Category[];
  activeCategoryId: number | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [percent, setPercent] = useState<string>('8');
  const [scope, setScope] = useState<'all' | 'category'>(
    activeCategoryId ? 'category' : 'all',
  );
  const [categoryId, setCategoryId] = useState<number | ''>(activeCategoryId ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = Number(percent);
    if (Number.isNaN(p) || p < 0 || p > 100) {
      toast.error('Persentase harus 0–100');
      return;
    }

    const scopeLabel = scope === 'all'
      ? 'SEMUA produk'
      : `produk di kategori "${categories.find((c) => c.id === categoryId)?.name ?? '-'}"`;
    if (!confirm(
      `Set biaya operasional ${p}% dari harga untuk ${scopeLabel}?\n\n`
      + `Contoh: produk Rp 450.000 → biaya ops Rp ${Math.round(450000 * p / 100).toLocaleString('id-ID')}.`,
    )) return;

    setBusy(true);
    try {
      const body: Record<string, unknown> = { percent: p };
      if (scope === 'category' && categoryId) {
        body.category_id = categoryId;
      }
      const r = await api.post('/admin/products/bulk-operational-cost', body);
      toast.success(`${r.data.updated} produk diperbarui (${p}%)`);
      onApplied();
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  }

  // Live preview against a sample price (Rp 100.000) for the user's intuition.
  const preview = (() => {
    const p = Number(percent);
    if (Number.isNaN(p)) return null;
    return Math.round(100000 * p / 100);
  })();

  return (
    <ModalShell title="Atur Biaya Operasional Otomatis" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-600">
          Biaya operasional setiap produk akan dihitung otomatis sebagai
          <b> persentase dari harga jual</b>. Margin ini hanya terlihat oleh admin —
          pelanggan hanya melihat harga jual akhir.
        </p>

        <div>
          <label className="label">Persentase biaya operasional</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              className="input w-32"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              autoFocus
              required
            />
            <span className="text-sm text-gray-600">%</span>
            {preview !== null && (
              <span className="text-xs text-gray-500 ml-2">
                contoh: harga Rp 100.000 → biaya ops {formatRupiah(preview)}
              </span>
            )}
          </div>
        </div>

        <div>
          <label className="label">Cakupan</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                checked={scope === 'all'}
                onChange={() => setScope('all')}
              />
              Semua produk ({/* count is unknown here without a separate call */}seluruh katalog)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                checked={scope === 'category'}
                onChange={() => setScope('category')}
              />
              Hanya kategori tertentu
            </label>
            {scope === 'category' && (
              <select
                className="input"
                value={String(categoryId)}
                onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
                required
              >
                <option value="">-- pilih kategori --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="text-xs text-gray-500 bg-yellow-50 border border-yellow-200 rounded p-2">
          Aksi ini menimpa kolom <code>operational_cost</code> pada produk yang
          ke-match. Untuk override per-produk setelahnya, edit produk masing-masing.
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button
            type="submit"
            className="btn-primary disabled:opacity-50"
            disabled={busy || (scope === 'category' && !categoryId)}
          >
            {busy ? 'Menerapkan...' : 'Terapkan'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* --------------------- Modal shell (no extra deps) --------------------- */

function ModalShell({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">{title}</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
