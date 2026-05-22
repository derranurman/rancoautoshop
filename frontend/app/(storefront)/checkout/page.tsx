'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import { useAuth, useCart } from '@/lib/stores';
import { paySnap } from '@/lib/midtrans';
import type { Address } from '@/lib/types';

type Province = { province_id: string; province: string };
type City = { city_id: string; province_id: string; type: string; city_name: string; postal_code: string };
type Cost = { courier: string; service: string; description: string; cost: number; etd: string };

export default function CheckoutPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { cart, fetch: fetchCart } = useCart();

  const [recipient, setRecipient] = useState({ name: '', phone: '', address: '' });
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [provincesLoading, setProvincesLoading] = useState(true);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [provinceId, setProvinceId] = useState('');
  const [cityId, setCityId] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [courier, setCourier] = useState('jne');
  const [costs, setCosts] = useState<Cost[]>([]);
  const [chosenCost, setChosenCost] = useState<Cost | null>(null);
  const [voucherCode, setVoucherCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Saved addresses
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddrId, setSelectedAddrId] = useState<number | 'new'>('new');
  // Whether the editable form is visible. We keep it hidden when a saved
  // address is being used so checkout stays clean & one-tap.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) { router.replace('/login'); return; }
    if (user) {
      fetchCart();
      api.get('/addresses')
        .then((r) => setAddresses(r.data.data ?? []))
        .catch(() => setAddresses([]));
    }
    setProvincesLoading(true);
    api.get('/shipping/provinces')
      .then((r) => setProvinces(r.data.data ?? []))
      .catch((e) => toast.error('Gagal memuat daftar provinsi: ' + apiError(e)))
      .finally(() => setProvincesLoading(false));
  }, [user, authLoading, fetchCart, router]);

  useEffect(() => {
    if (user) {
      setRecipient((r) => ({
        ...r,
        name: r.name || user.name,
        phone: r.phone || (user.phone ?? ''),
      }));
    }
  }, [user]);

  // Load cities whenever province changes (and reset downstream selections).
  useEffect(() => {
    if (provinceId) {
      setCitiesLoading(true);
      api.get('/shipping/cities', { params: { province_id: provinceId } })
        .then((r) => setCities(r.data.data ?? []))
        .catch((e) => {
          toast.error('Gagal memuat daftar kota: ' + apiError(e));
          setCities([]);
        })
        .finally(() => setCitiesLoading(false));
    } else {
      setCities([]);
    }
    setCityId('');
    setCosts([]);
    setChosenCost(null);
  }, [provinceId]);

  // Auto-pick the default address (or first one) the first time we get the list.
  // When an address is auto-applied we keep the form collapsed.
  useEffect(() => {
    if (selectedAddrId !== 'new') return;
    if (addresses.length === 0) {
      // No saved addresses → user has to fill the form by hand.
      setEditing(true);
      return;
    }
    const def = addresses.find((a) => a.is_default) ?? addresses[0];
    applyAddress(def);
    setSelectedAddrId(def.id);
    setEditing(false);
  }, [addresses]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyAddress(a: Address) {
    setRecipient({ name: a.recipient_name, phone: a.phone, address: a.address_line });
    setPostalCode(a.postal_code ?? '');
    // Match province by name (province_id is RajaOngkir-side, not stored here).
    const prov = provinces.find(
      (p) => p.province.toLowerCase() === (a.province ?? '').toLowerCase(),
    );
    if (prov) {
      setProvinceId(prov.province_id);
      // Cities will load via the effect; we set city_id when they arrive.
      pendingCityIdRef.current = a.city_id ?? null;
      pendingCityNameRef.current = a.city ?? null;
    } else {
      setProvinceId('');
    }
  }

  // Refs to bridge the async city load (province change triggers city fetch
  // asynchronously; we stash the desired city until the list arrives).
  const pendingCityIdRef = useRef<string | null>(null);
  const pendingCityNameRef = useRef<string | null>(null);

  // When cities arrive, try to resolve the pending city selection.
  useEffect(() => {
    if (!cities.length) return;
    const wantId = pendingCityIdRef.current;
    const wantName = pendingCityNameRef.current;
    if (!wantId && !wantName) return;
    const match =
      (wantId && cities.find((c) => c.city_id === wantId)) ||
      (wantName && cities.find(
        (c) =>
          `${c.type} ${c.city_name}`.toLowerCase() === wantName.toLowerCase()
          || c.city_name.toLowerCase() === wantName.toLowerCase(),
      )) ||
      null;
    if (match) {
      setCityId(match.city_id);
      if (!postalCode) setPostalCode(match.postal_code);
    }
    pendingCityIdRef.current = null;
    pendingCityNameRef.current = null;
  }, [cities]); // eslint-disable-line react-hooks/exhaustive-deps

  function onAddressPick(value: string) {
    if (value === 'new') {
      setSelectedAddrId('new');
      setRecipient({
        name: user?.name ?? '',
        phone: user?.phone ?? '',
        address: '',
      });
      setProvinceId('');
      setCityId('');
      setPostalCode('');
      setEditing(true);
      return;
    }
    const id = Number(value);
    const addr = addresses.find((a) => a.id === id);
    if (!addr) return;
    setSelectedAddrId(id);
    applyAddress(addr);
    setEditing(false);
  }

  async function calcCost() {
    if (!cityId || !cart) return;
    try {
      const r = await api.post('/shipping/cost', {
        destination: cityId,
        weight: Math.max(1, cart.total_weight),
        courier,
      });
      setCosts(r.data.data); setChosenCost(null);
    } catch (e) { toast.error(apiError(e)); }
  }

  async function applyVoucher() {
    if (!voucherCode || !cart) { setDiscount(0); return; }
    try {
      const r = await api.post('/vouchers/check', { code: voucherCode, subtotal: cart.subtotal });
      if (r.data.valid) { setDiscount(r.data.discount); toast.success('Voucher diterapkan'); }
      else { setDiscount(0); toast.error(r.data.message ?? 'Voucher tidak valid'); }
    } catch (e) { toast.error(apiError(e)); }
  }

  const total = useMemo(() => {
    const s = cart?.subtotal ?? 0;
    const sh = chosenCost?.cost ?? 0;
    return Math.max(0, s - discount + sh);
  }, [cart?.subtotal, chosenCost?.cost, discount]);

  async function onSubmit() {
    if (!chosenCost) { toast.error('Pilih layanan pengiriman dulu'); return; }
    if (!recipient.phone.trim()) {
      toast.error('No HP penerima wajib diisi');
      return;
    }
    const cityObj = cities.find((c) => c.city_id === cityId);
    const provObj = provinces.find((p) => p.province_id === provinceId);
    const pc = postalCode || cityObj?.postal_code || '';
    const addr = `${recipient.address}\n${cityObj?.type ?? ''} ${cityObj?.city_name ?? ''}, ${provObj?.province ?? ''} ${pc}`.trim();

    setSubmitting(true);
    try {
      const r = await api.post('/orders/checkout', {
        recipient_name: recipient.name,
        recipient_phone: recipient.phone,
        shipping_address: addr,
        courier: chosenCost.courier,
        courier_service: chosenCost.service,
        shipping_cost: chosenCost.cost,
        voucher_code: voucherCode || undefined,
      });
      toast.success('Pesanan dibuat');
      const orderNumber = r.data.order.order_number;
      const token = r.data.snap_token as string | null;
      const isMock = !!r.data.mock;

      if (!isMock && token) {
        await paySnap(token, {
          onSuccess: () => router.push(`/orders/${orderNumber}`),
          onPending: () => router.push(`/orders/${orderNumber}`),
          onClose:   () => router.push(`/orders/${orderNumber}`),
        });
      } else {
        router.push(`/orders/${orderNumber}`);
      }
    } catch (e) {
      toast.error(apiError(e));
    } finally { setSubmitting(false); }
  }

  if (!cart) return <div className="max-w-4xl mx-auto px-4 py-10 text-gray-500">Memuat keranjang...</div>;
  if (cart.items.length === 0) return <div className="max-w-4xl mx-auto px-4 py-10">Keranjang kosong.</div>;

  // The summary view of the currently-selected saved address (when not editing).
  const selectedAddr = typeof selectedAddrId === 'number'
    ? addresses.find((a) => a.id === selectedAddrId) ?? null
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-4">
        {user && !user.phone && (
          <div className="card p-3 border-yellow-300 bg-yellow-50 text-sm flex items-center justify-between gap-2">
            <span className="text-yellow-800">
              Akunmu belum punya nomor HP. Tambahkan supaya kurir bisa menghubungimu.
            </span>
            <Link href="/account/profile" className="btn-outline text-xs whitespace-nowrap">
              Tambah No HP
            </Link>
          </div>
        )}

        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Alamat Pengiriman</h2>
            <Link href="/account/addresses" className="text-xs text-brand hover:underline">
              Kelola alamat
            </Link>
          </div>

          {/* When a saved address is in use AND we're not editing, show a compact
              summary instead of the full form. The user can switch address or
              start editing the chosen address inline. */}
          {selectedAddr && !editing ? (
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedAddr.label && (
                      <span className="text-[10px] uppercase tracking-wide bg-gray-100 px-2 py-0.5 rounded">
                        {selectedAddr.label}
                      </span>
                    )}
                    <span className="font-semibold">{selectedAddr.recipient_name}</span>
                    <span className="text-sm text-gray-500">{selectedAddr.phone}</span>
                    {selectedAddr.is_default && (
                      <span className="text-[10px] bg-brand/10 text-brand px-2 py-0.5 rounded font-semibold">
                        Utama
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-700 whitespace-pre-line">
                    {selectedAddr.address_line}
                  </div>
                  <div className="mt-0.5 text-sm text-gray-500">
                    {selectedAddr.city}, {selectedAddr.province}
                    {selectedAddr.postal_code ? ` ${selectedAddr.postal_code}` : ''}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col gap-1 items-stretch">
                  <button
                    type="button"
                    className="btn-outline text-xs"
                    onClick={() => setEditing(true)}
                  >
                    Ubah
                  </button>
                  {addresses.length > 1 && (
                    <select
                      className="input text-xs"
                      value={String(selectedAddrId)}
                      onChange={(e) => onAddressPick(e.target.value)}
                    >
                      {addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          Ganti: {a.label ? `[${a.label}] ` : ''}{a.recipient_name}
                          {a.is_default ? ' (utama)' : ''}
                        </option>
                      ))}
                      <option value="new">+ Alamat baru...</option>
                    </select>
                  )}
                  {addresses.length <= 1 && (
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => onAddressPick('new')}
                    >
                      + Alamat lain
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              {addresses.length > 0 && (
                <div className="mb-3 flex items-end gap-2">
                  <div className="flex-1">
                    <label className="label">Pilih dari alamat tersimpan</label>
                    <select
                      className="input"
                      value={String(selectedAddrId)}
                      onChange={(e) => onAddressPick(e.target.value)}
                    >
                      {addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label ? `[${a.label}] ` : ''}{a.recipient_name} — {a.city}
                          {a.is_default ? ' (utama)' : ''}
                        </option>
                      ))}
                      <option value="new">+ Isi alamat baru di formulir</option>
                    </select>
                  </div>
                  {selectedAddr && (
                    <button
                      type="button"
                      className="btn-ghost text-xs whitespace-nowrap mb-0.5"
                      onClick={() => setEditing(false)}
                    >
                      Batal ubah
                    </button>
                  )}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="label">Nama penerima</label>
                  <input className="input" value={recipient.name}
                         onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />
                </div>
                <div><label className="label">No. HP penerima</label>
                  <input className="input" value={recipient.phone}
                         onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} />
                </div>
                <div><label className="label">Provinsi</label>
                  <select className="input" value={provinceId}
                          onChange={(e) => setProvinceId(e.target.value)}
                          disabled={provincesLoading}>
                    <option value="">
                      {provincesLoading
                        ? '-- memuat provinsi... --'
                        : provinces.length === 0
                          ? '-- tidak ada data --'
                          : '-- pilih provinsi --'}
                    </option>
                    {provinces.map((p, i) => (
                      <option key={`${p.province_id}-${i}`} value={p.province_id}>{p.province}</option>
                    ))}
                  </select>
                </div>
                <div><label className="label">Kota/Kabupaten</label>
                  <select className="input" value={cityId}
                          onChange={(e) => setCityId(e.target.value)}
                          disabled={!provinceId || citiesLoading}>
                    <option value="">
                      {citiesLoading
                        ? '-- memuat kota... --'
                        : !provinceId
                          ? '-- pilih provinsi dulu --'
                          : cities.length === 0
                            ? '-- tidak ada data --'
                            : '-- pilih kota --'}
                    </option>
                    {cities.map((c, i) => (
                      <option key={`${c.city_id}-${i}`} value={c.city_id}>{c.type} {c.city_name}</option>
                    ))}
                  </select>
                </div>
                <div><label className="label">Kode Pos</label>
                  <input className="input" value={postalCode}
                         onChange={(e) => setPostalCode(e.target.value)}
                         placeholder={cities.find((c) => c.city_id === cityId)?.postal_code ?? ''} />
                </div>
                <div className="sm:col-span-2"><label className="label">Alamat lengkap</label>
                  <textarea className="input" rows={2} value={recipient.address}
                            onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card p-4">
          <h2 className="font-semibold mb-3">Pengiriman</h2>
          <div className="flex gap-2 mb-3">
            {(['jne', 'pos', 'tiki'] as const).map((c) => (
              <button key={c} onClick={() => setCourier(c)}
                className={`btn ${courier === c ? 'bg-ink text-white' : 'bg-gray-100'}`}>{c.toUpperCase()}</button>
            ))}
            <button onClick={calcCost} disabled={!cityId} className="btn-primary ml-auto">Cek Ongkir</button>
          </div>
          <div className="space-y-2">
            {costs.map((c, i) => (
              <label key={i} className={`card p-3 flex justify-between cursor-pointer ${chosenCost?.service === c.service ? 'border-brand' : ''}`}>
                <div>
                  <div className="font-medium">{c.courier.toUpperCase()} — {c.service}</div>
                  <div className="text-xs text-gray-500">{c.description} · Estimasi {c.etd} hari</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{formatRupiah(c.cost)}</div>
                  <input type="radio" name="srv" checked={chosenCost?.service === c.service} onChange={() => setChosenCost(c)} />
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-semibold mb-3">Voucher</h2>
          <div className="flex gap-2">
            <input className="input" placeholder="Kode voucher (cth: RANCO10)" value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} />
            <button className="btn-outline" onClick={applyVoucher}>Terapkan</button>
          </div>
          {discount > 0 && <div className="text-sm text-green-700 mt-2">Diskon: {formatRupiah(discount)}</div>}
        </div>
      </div>

      <div className="card p-4 h-fit sticky top-20 space-y-2">
        <h2 className="font-semibold">Ringkasan</h2>
        <div className="flex justify-between text-sm"><span>Subtotal barang</span><span>{formatRupiah(cart.subtotal)}</span></div>
        <div className="flex justify-between text-sm"><span>Diskon</span><span>- {formatRupiah(discount)}</span></div>
        <div className="flex justify-between text-sm"><span>Ongkir</span><span>{formatRupiah(chosenCost?.cost ?? 0)}</span></div>
        <div className="border-t border-gray-100 pt-2 flex justify-between font-bold">
          <span>Total</span><span>{formatRupiah(total)}</span>
        </div>
        <div className="text-xs text-gray-500">Ongkir ditanggung pembeli.</div>
        <button onClick={onSubmit} disabled={submitting || !chosenCost} className="btn-primary w-full mt-2">
          {submitting ? 'Memproses...' : 'Bayar Sekarang'}
        </button>
        <div className="text-[11px] text-gray-500 text-center pt-1">
          Pembayaran via Midtrans: BCA / BNI / BRI / Mandiri / Permata VA, GoPay,
          ShopeePay, OVO, DANA, QRIS, Indomaret/Alfamart, kartu kredit.
        </div>
      </div>
    </div>
  );
}
