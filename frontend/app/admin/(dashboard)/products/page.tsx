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

/** Backend returns operational_cost_percent as numeric string (decimal cast). */
function pct(c: Category): number {
  const raw = c.operational_cost_percent;
  const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export default function AdminProductsPage() {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);

  const [showManageCategoriesModal, setShowManageCategoriesModal] = useState(false);
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
            onClick={() => setShowManageCategoriesModal(true)}
            className="btn-outline"
          >
            Kelola Kategori
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
            <option key={c.id} value={c.id}>
              {c.name}{pct(c) > 0 ? ` (${pct(c)}% ops)` : ''}
            </option>
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
              const opsPct = p.price > 0
                ? ((p.operational_cost / p.price) * 100).toFixed(1)
                : null;
              return (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2">{p.category?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{formatRupiah(p.price)}</td>
                  <td className="px-3 py-2 text-right">
                    <div>{formatRupiah(p.operational_cost)}</div>
                    {opsPct && <div className="text-[10px] text-gray-500">{opsPct}%</div>}
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

      {showManageCategoriesModal && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setShowManageCategoriesModal(false)}
          onChanged={() => { loadCategories(); loadProducts(); }}
        />
      )}

      {showOpsCostModal && (
        <OpsCostModal
          categories={categories}
          activeCategoryId={categoryFilter || null}
          onClose={() => setShowOpsCostModal(false)}
          onApplied={() => { loadProducts(); loadCategories(); }}
        />
      )}
    </div>
  );
}

/* --------------------- Modal: Kelola Kategori --------------------- */

function ManageCategoriesModal({
  categories, onClose, onChanged,
}: {
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Record<number, { name: string; percent: string }>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  // Form state for adding a new category at top of the modal.
  const [newName, setNewName] = useState('');
  const [newPercent, setNewPercent] = useState('8');
  const [newDesc, setNewDesc] = useState('');
  const [busyAdd, setBusyAdd] = useState(false);

  function startEdit(c: Category) {
    setEditing((prev) => ({
      ...prev,
      [c.id]: { name: c.name, percent: String(pct(c)) },
    }));
  }
  function cancelEdit(id: number) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function saveEdit(c: Category) {
    const e = editing[c.id];
    if (!e || !e.name.trim()) return;
    const p = Number(e.percent);
    if (Number.isNaN(p) || p < 0 || p > 100) {
      toast.error('Persen harus 0–100');
      return;
    }
    setBusyId(c.id);
    try {
      await api.put(`/admin/categories/${c.id}`, {
        name: e.name.trim(),
        operational_cost_percent: p,
      });
      toast.success('Kategori diperbarui');
      cancelEdit(c.id);
      onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally { setBusyId(null); }
  }

  async function remove(c: Category) {
    const used = c.products_count ?? 0;
    const msg = used > 0
      ? `Hapus kategori "${c.name}"?\n\n${used} produk akan dilepas dari kategori ini (tidak dihapus, hanya jadi tanpa kategori).`
      : `Hapus kategori "${c.name}"?`;
    if (!confirm(msg)) return;
    setBusyId(c.id);
    try {
      await api.delete(`/admin/categories/${c.id}`);
      toast.success('Kategori dihapus');
      onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally { setBusyId(null); }
  }

  async function addNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const p = Number(newPercent);
    if (Number.isNaN(p) || p < 0 || p > 100) {
      toast.error('Persen harus 0–100');
      return;
    }
    setBusyAdd(true);
    try {
      await api.post('/admin/categories', {
        name: newName.trim(),
        description: newDesc.trim() || null,
        operational_cost_percent: p,
      });
      toast.success('Kategori ditambahkan');
      setNewName(''); setNewDesc(''); setNewPercent('8');
      onChanged();
    } catch (err) {
      toast.error(apiError(err));
    } finally { setBusyAdd(false); }
  }

  return (
    <ModalShell title="Kelola Kategori Produk" onClose={onClose} size="lg">
      <p className="text-sm text-gray-600 mb-3">
        Persen biaya ops di sini adalah <b>nilai default</b> untuk produk baru di
        kategori tersebut. Saat membuat / mengedit produk, biaya operasional
        dihitung otomatis = harga &times; persen kategori.
      </p>

      {/* Add new */}
      <form onSubmit={addNew} className="card p-3 space-y-2 mb-4">
        <div className="font-semibold text-sm">+ Tambah Kategori Baru</div>
        <div className="grid sm:grid-cols-3 gap-2">
          <input
            className="input"
            placeholder="Nama kategori"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={120}
            required
          />
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              className="input"
              placeholder="0"
              value={newPercent}
              onChange={(e) => setNewPercent(e.target.value)}
              required
            />
            <span className="text-sm text-gray-600">%</span>
          </div>
          <button
            type="submit"
            className="btn-primary disabled:opacity-50"
            disabled={busyAdd || !newName.trim()}
          >
            {busyAdd ? 'Menyimpan...' : 'Tambah'}
          </button>
        </div>
        <input
          className="input"
          placeholder="Deskripsi (opsional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          maxLength={500}
        />
      </form>

      {/* Existing list */}
      <div className="border rounded-lg divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
        {categories.length === 0 && (
          <div className="p-6 text-center text-sm text-gray-500">Belum ada kategori.</div>
        )}
        {categories.map((c) => {
          const isEditing = !!editing[c.id];
          const draft = editing[c.id] ?? { name: c.name, percent: String(pct(c)) };
          return (
            <div key={c.id} className="p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="grid sm:grid-cols-2 gap-2">
                    <input
                      className="input"
                      value={draft.name}
                      onChange={(e) => setEditing((p) => ({ ...p, [c.id]: { ...draft, name: e.target.value } }))}
                      maxLength={120}
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        className="input"
                        value={draft.percent}
                        onChange={(e) => setEditing((p) => ({ ...p, [c.id]: { ...draft, percent: e.target.value } }))}
                      />
                      <span className="text-sm text-gray-600">%</span>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-gray-500">
                      {pct(c) > 0 ? `${pct(c)}% biaya ops` : 'Tanpa persen biaya ops'}
                      {typeof c.products_count === 'number' && (
                        <> · {c.products_count} produk</>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      className="btn-primary text-xs disabled:opacity-50"
                      onClick={() => saveEdit(c)}
                      disabled={busyId === c.id}
                    >
                      {busyId === c.id ? '...' : 'Simpan'}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => cancelEdit(c.id)}
                      disabled={busyId === c.id}
                    >
                      Batal
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn-outline text-xs" onClick={() => startEdit(c)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-outline text-xs text-red-600 border-red-300"
                      onClick={() => remove(c)}
                      disabled={busyId === c.id}
                    >
                      Hapus
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end mt-4">
        <button type="button" className="btn-outline" onClick={onClose}>
          Tutup
        </button>
      </div>
    </ModalShell>
  );
}

/* --------------------- Modal: Atur Biaya Operasional % (massal) --------------------- */

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
  const [alsoSetCategoryDefault, setAlsoSetCategoryDefault] = useState(true);
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

      // If the user is targeting one specific category and asked to also save
      // the percent as that category's default, update the category too so
      // future products inherit the same percent automatically.
      if (
        scope === 'category'
        && categoryId
        && alsoSetCategoryDefault
      ) {
        const c = categories.find((x) => x.id === categoryId);
        if (c) {
          await api.put(`/admin/categories/${c.id}`, {
            name: c.name,
            description: c.description ?? null,
            operational_cost_percent: p,
          });
        }
      }

      toast.success(`${r.data.updated} produk diperbarui (${p}%)`);
      onApplied();
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  }

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
              Semua produk (seluruh katalog)
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
              <>
                <select
                  className="input"
                  value={String(categoryId)}
                  onChange={(e) => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
                  required
                >
                  <option value="">-- pilih kategori --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{pct(c) > 0 ? ` (saat ini ${pct(c)}%)` : ''}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={alsoSetCategoryDefault}
                    onChange={(e) => setAlsoSetCategoryDefault(e.target.checked)}
                  />
                  Sekaligus jadikan {percent || '0'}% sebagai default kategori ini
                  (produk baru pakai persen ini juga)
                </label>
              </>
            )}
          </div>
        </div>

        <div className="text-xs text-gray-500 bg-yellow-50 border border-yellow-200 rounded p-2">
          Aksi ini menimpa kolom <code>operational_cost</code> pada produk yang
          ke-match. Untuk override per-produk setelahnya, edit produk masing-masing
          dan klik &ldquo;Atur manual&rdquo;.
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
  title, onClose, children, size = 'md',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-md'} p-5`}
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
