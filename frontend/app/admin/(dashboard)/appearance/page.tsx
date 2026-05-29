'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import { useSiteSettings } from '@/lib/stores';
import type { SiteSettings, SiteSettingsAdmin } from '@/lib/types';

/**
 * Admin "Tampilan" — satu form besar untuk mengatur branding storefront:
 *   - Identitas toko (nama, logo, favicon)
 *   - Hero homepage (judul, subjudul, placeholder pencarian, gradient)
 *   - Footer
 *   - Floating widget WhatsApp (aktif/tidak, nomor, label, greeting, prefill)
 *
 * State diisi sekali dari `GET /admin/site-settings`. Saat user men-submit,
 * kita PUT ke endpoint yang sama dan langsung sinkron-kan store global
 * `useSiteSettings` supaya navbar/hero/footer/widget di tab admin yang sedang
 * dibuka ikut update tanpa reload.
 */
export default function AdminAppearancePage() {
  const replaceSettings = useSiteSettings((s) => s.replace);
  const [form, setForm] = useState<SiteSettingsAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get('/admin/site-settings')
      .then((r) => setForm(r.data.data as SiteSettingsAdmin))
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, []);

  function patch<K extends keyof SiteSettingsAdmin>(key: K, value: SiteSettingsAdmin[K]) {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  async function uploadAsset(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('image', file);
    const r = await api.post('/admin/site-settings/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return (r.data.url as string) ?? '';
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      // Field `whatsapp_number_normalized` & `whatsapp_link` adalah read-only
      // hasil derivasi server, jangan dikirim balik.
      const payload: Partial<SiteSettingsAdmin> = { ...form };
      delete (payload as Partial<SiteSettingsAdmin> & Record<string, unknown>).whatsapp_number_normalized;
      delete (payload as Partial<SiteSettingsAdmin> & Record<string, unknown>).whatsapp_link;

      const r = await api.put('/admin/site-settings', payload);
      const fresh = r.data.data as SiteSettingsAdmin;
      setForm(fresh);

      // Sinkron ke store publik supaya storefront (kalau user buka tab lain)
      // langsung pakai versi terbaru. Petakan dari versi admin → publik.
      const publicShape: SiteSettings = {
        app_name: fresh.app_name,
        logo_url: fresh.logo_url,
        favicon_url: fresh.favicon_url,
        hero_title: fresh.hero_title,
        hero_subtitle: fresh.hero_subtitle,
        hero_search_placeholder: fresh.hero_search_placeholder,
        hero_gradient_from: fresh.hero_gradient_from,
        hero_gradient_to: fresh.hero_gradient_to,
        footer_text: fresh.footer_text,
        whatsapp_enabled: fresh.whatsapp_enabled,
        whatsapp_number: fresh.whatsapp_number_normalized,
        whatsapp_label: fresh.whatsapp_label,
        whatsapp_greeting: fresh.whatsapp_greeting,
        whatsapp_prefilled_text: fresh.whatsapp_prefilled_text,
        whatsapp_link: fresh.whatsapp_link,
        manual_transfer_enabled: fresh.manual_transfer_enabled ?? false,
        bank_name: fresh.bank_name ?? null,
        bank_account_number: fresh.bank_account_number ?? null,
        bank_account_holder: fresh.bank_account_holder ?? null,
        bank_branch: fresh.bank_branch ?? null,
        bank_extra_note: fresh.bank_extra_note ?? null,
      };
      replaceSettings(publicShape);

      toast.success('Pengaturan tampilan tersimpan.');
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form) {
    return <div className="text-gray-500">Memuat pengaturan...</div>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tampilan</h1>
          <p className="text-sm text-gray-500">
            Atur logo, hero homepage, footer, dan widget WhatsApp toko.
          </p>
        </div>
        <button form="appearance-form" type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </div>

      <form id="appearance-form" onSubmit={onSubmit} className="space-y-4">
        {/* ------------- Identitas Toko ------------- */}
        <section className="card p-4 space-y-4">
          <h2 className="font-semibold">Identitas Toko</h2>

          <div>
            <label className="label">Nama Toko</label>
            <input
              className="input"
              value={form.app_name}
              onChange={(e) => patch('app_name', e.target.value)}
              maxLength={80}
            />
            <p className="text-xs text-gray-500 mt-1">
              Tampil di header dan footer. Kata kedua akan otomatis diberi warna brand
              (mis. &quot;Ranco <span className="text-brand">Autoshop</span>&quot;).
            </p>
          </div>

          <ImageField
            label="Logo"
            description="Disarankan rasio 1:1, ukuran ≤ 2MB. Format JPG/PNG/WebP/SVG."
            value={form.logo_url}
            onChange={(v) => patch('logo_url', v)}
            onUpload={uploadAsset}
            previewClassName="h-12 w-12 rounded-lg object-cover bg-gray-100"
          />

          <ImageField
            label="Favicon (opsional)"
            description="Ikon kecil di tab browser. Disarankan 32×32 atau 64×64 PNG."
            value={form.favicon_url}
            onChange={(v) => patch('favicon_url', v)}
            onUpload={uploadAsset}
            previewClassName="h-8 w-8 rounded object-cover bg-gray-100"
          />
        </section>

        {/* ------------- Hero ------------- */}
        <section className="card p-4 space-y-4">
          <h2 className="font-semibold">Banner Beranda (Hero)</h2>

          <div>
            <label className="label">Judul Hero</label>
            <input
              className="input"
              value={form.hero_title}
              onChange={(e) => patch('hero_title', e.target.value)}
              maxLength={120}
            />
          </div>
          <div>
            <label className="label">Sub Judul</label>
            <input
              className="input"
              value={form.hero_subtitle}
              onChange={(e) => patch('hero_subtitle', e.target.value)}
              maxLength={240}
            />
          </div>
          <div>
            <label className="label">Placeholder Kotak Pencarian</label>
            <input
              className="input"
              value={form.hero_search_placeholder}
              onChange={(e) => patch('hero_search_placeholder', e.target.value)}
              maxLength={160}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Warna Gradient (Atas/Kiri)</label>
              <ColorInput
                value={form.hero_gradient_from ?? ''}
                onChange={(v) => patch('hero_gradient_from', v || null)}
                placeholder="#dc2626"
              />
            </div>
            <div>
              <label className="label">Warna Gradient (Bawah/Kanan)</label>
              <ColorInput
                value={form.hero_gradient_to ?? ''}
                onChange={(v) => patch('hero_gradient_to', v || null)}
                placeholder="#7f1d1d"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="pt-2">
            <div
              className="rounded-2xl text-white p-6"
              style={{
                backgroundImage:
                  form.hero_gradient_from && form.hero_gradient_to
                    ? `linear-gradient(to bottom right, ${form.hero_gradient_from}, ${form.hero_gradient_to})`
                    : 'linear-gradient(to bottom right, var(--brand, #dc2626), #7f1d1d)',
              }}
            >
              <div className="text-2xl font-bold">{form.hero_title || 'Judul Hero'}</div>
              <div className="opacity-90 text-sm mt-1">{form.hero_subtitle || 'Sub judul'}</div>
              <div className="mt-3 bg-white/95 text-gray-500 text-sm rounded-lg px-3 py-2 max-w-md">
                {form.hero_search_placeholder || 'Cari produk...'}
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Pratinjau gradient hero. Kosongkan kedua warna untuk memakai warna brand default.
            </div>
          </div>
        </section>

        {/* ------------- Footer ------------- */}
        <section className="card p-4 space-y-3">
          <h2 className="font-semibold">Footer</h2>
          <div>
            <label className="label">Teks Hak Cipta (opsional)</label>
            <input
              className="input"
              value={form.footer_text ?? ''}
              onChange={(e) => patch('footer_text', e.target.value || null)}
              placeholder={`© ${new Date().getFullYear()} ${form.app_name}. Semua hak dilindungi.`}
              maxLength={240}
            />
            <p className="text-xs text-gray-500 mt-1">
              Kosongkan untuk memakai format default berbasis nama toko.
            </p>
          </div>
        </section>

        {/* ------------- WhatsApp Widget ------------- */}
        <section className="card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Widget WhatsApp (Live Chat)</h2>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.whatsapp_enabled}
                onChange={(e) => patch('whatsapp_enabled', e.target.checked)}
              />
              Aktifkan
            </label>
          </div>
          <p className="text-xs text-gray-500 -mt-1">
            Saat aktif, akan muncul tombol melayang di pojok kanan-bawah storefront.
            Pengunjung yang klik diarahkan ke chat WhatsApp dengan pesan otomatis.
          </p>

          <div>
            <label className="label">Nomor WhatsApp</label>
            <input
              className="input"
              value={form.whatsapp_number ?? ''}
              onChange={(e) => patch('whatsapp_number', e.target.value || null)}
              placeholder="Contoh: 081234567890 atau +6281234567890"
              maxLength={30}
            />
            {form.whatsapp_number_normalized ? (
              <p className="text-xs text-gray-500 mt-1">
                Akan dipakai sebagai: <code className="font-mono">+{form.whatsapp_number_normalized}</code>
                {' '}({' '}
                <a
                  href={form.whatsapp_link ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  test link
                </a>{' '})
              </p>
            ) : (
              <p className="text-xs text-yellow-700 mt-1">
                Nomor belum valid. Widget tidak akan tampil sampai nomor diisi dengan benar.
              </p>
            )}
          </div>

          <div>
            <label className="label">Label / Nama Pengirim</label>
            <input
              className="input"
              value={form.whatsapp_label}
              onChange={(e) => patch('whatsapp_label', e.target.value)}
              maxLength={80}
            />
            <p className="text-xs text-gray-500 mt-1">
              Tampil di header popover, mis. &quot;CS Ranco Autoshop&quot;.
            </p>
          </div>

          <div>
            <label className="label">Sapaan Otomatis (greeting bubble)</label>
            <textarea
              className="input"
              rows={2}
              value={form.whatsapp_greeting}
              onChange={(e) => patch('whatsapp_greeting', e.target.value)}
              maxLength={240}
            />
          </div>

          <div>
            <label className="label">Pesan Pre-fill (otomatis terisi di chat)</label>
            <textarea
              className="input"
              rows={2}
              value={form.whatsapp_prefilled_text}
              onChange={(e) => patch('whatsapp_prefilled_text', e.target.value)}
              maxLength={240}
            />
            <p className="text-xs text-gray-500 mt-1">
              Pesan ini akan otomatis muncul di kotak chat WhatsApp pengunjung sebelum dia menekan kirim.
            </p>
          </div>
        </section>

        {/* ------------- Pembayaran Transfer Manual ------------- */}
        <section className="card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Pembayaran Transfer Manual</h2>
              <p className="text-xs text-gray-500">
                Aktifkan untuk memberi pembeli alternatif selain Midtrans. Pembeli akan
                melihat nomor rekening di bawah dan mengunggah bukti transfer dari
                halaman pesanannya.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.manual_transfer_enabled}
                onChange={(e) => patch('manual_transfer_enabled', e.target.checked)}
              />
              Aktifkan
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Nama Bank</label>
              <input
                className="input"
                value={form.bank_name ?? ''}
                onChange={(e) => patch('bank_name', e.target.value || null)}
                placeholder="Contoh: BCA"
                maxLength={80}
              />
            </div>
            <div>
              <label className="label">Cabang (opsional)</label>
              <input
                className="input"
                value={form.bank_branch ?? ''}
                onChange={(e) => patch('bank_branch', e.target.value || null)}
                placeholder="Contoh: KCP Sudirman"
                maxLength={120}
              />
            </div>
            <div>
              <label className="label">Nomor Rekening</label>
              <input
                className="input font-mono"
                value={form.bank_account_number ?? ''}
                onChange={(e) => patch('bank_account_number', e.target.value || null)}
                placeholder="Contoh: 1234567890"
                maxLength={60}
              />
            </div>
            <div>
              <label className="label">Atas Nama</label>
              <input
                className="input"
                value={form.bank_account_holder ?? ''}
                onChange={(e) => patch('bank_account_holder', e.target.value || null)}
                placeholder="Contoh: PT Ranco Autoshop"
                maxLength={120}
              />
            </div>
          </div>

          <div>
            <label className="label">Catatan untuk Pelanggan (opsional)</label>
            <textarea
              className="input"
              rows={3}
              value={form.bank_extra_note ?? ''}
              onChange={(e) => patch('bank_extra_note', e.target.value || null)}
              placeholder="Cth: Mohon transfer sesuai nominal hingga 3 digit terakhir agar mudah diverifikasi. Verifikasi 1x24 jam pada hari kerja."
              maxLength={1000}
            />
          </div>

          {form.manual_transfer_enabled && !form.bank_account_number && (
            <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-2">
              Toggle aktif, tapi nomor rekening belum diisi — opsi transfer manual
              tidak akan muncul di halaman checkout sampai nomor rekening tersedia.
            </div>
          )}

          {/* Live preview persis seperti yang akan dilihat customer di halaman order */}
          {(form.bank_name || form.bank_account_number) && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1">
              <div className="text-xs text-gray-500 uppercase tracking-wide">Pratinjau untuk pelanggan</div>
              <div className="font-semibold text-lg">
                {form.bank_name || '—'}
                {form.bank_branch && (
                  <span className="ml-2 text-xs font-normal text-gray-500">Cabang {form.bank_branch}</span>
                )}
              </div>
              <div className="font-mono text-xl tracking-wider">
                {form.bank_account_number || '—'}
              </div>
              {form.bank_account_holder && (
                <div className="text-sm text-gray-700">a.n. <b>{form.bank_account_holder}</b></div>
              )}
              {form.bank_extra_note && (
                <div className="text-xs text-gray-600 whitespace-pre-line pt-1 border-t border-gray-200 mt-2">
                  {form.bank_extra_note}
                </div>
              )}
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Field gambar reusable: preview + tombol upload + tombol hapus + URL manual. */
function ImageField({
  label, description, value, onChange, onUpload, previewClassName,
}: {
  label: string;
  description?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  onUpload: (file: File) => Promise<string>;
  previewClassName?: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await onUpload(file);
      onChange(url);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-start gap-3">
        {value
          ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={label} className={previewClassName ?? 'h-12 w-12 rounded-lg object-cover bg-gray-100'} />
          )
          : (
            <div className={`${previewClassName ?? 'h-12 w-12 rounded-lg'} bg-gray-100 grid place-items-center text-xs text-gray-400`}>
              kosong
            </div>
          )
        }
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-outline text-xs"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'Mengunggah...' : (value ? 'Ganti file' : 'Unggah file')}
            </button>
            {value && (
              <button
                type="button"
                className="btn-ghost text-xs text-red-600"
                onClick={() => onChange(null)}
              >
                Hapus
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </div>
          <input
            className="input text-xs"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder="atau tempel URL gambar (https://...)"
          />
          {description && <p className="text-xs text-gray-500">{description}</p>}
        </div>
      </div>
    </div>
  );
}

/** Pilih warna pakai input native + sinkron dengan field text hex. */
function ColorInput({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  // Input type=color hanya menerima format #rrggbb. Kalau value belum
  // berbentuk hex, jangan dilempar ke picker — biarkan default.
  const isHex = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div className="flex gap-2 items-center">
      <input
        type="color"
        className="h-10 w-12 rounded-lg border border-gray-300 bg-white cursor-pointer"
        value={isHex ? value : '#dc2626'}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Pilih warna"
      />
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '#dc2626'}
        maxLength={20}
      />
    </div>
  );
}
