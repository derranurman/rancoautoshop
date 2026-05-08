'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import { useAuth, useCart } from '@/lib/stores';

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
  const [provinceId, setProvinceId] = useState('');
  const [cityId, setCityId] = useState('');
  const [courier, setCourier] = useState('jne');
  const [costs, setCosts] = useState<Cost[]>([]);
  const [chosenCost, setChosenCost] = useState<Cost | null>(null);
  const [voucherCode, setVoucherCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) { router.replace('/login'); return; }
    if (user) fetchCart();
    api.get('/shipping/provinces').then((r) => setProvinces(r.data.data));
  }, [user, authLoading, fetchCart, router]);

  useEffect(() => {
    if (user) setRecipient((r) => ({ ...r, name: r.name || user.name, phone: r.phone || (user.phone ?? '') }));
  }, [user]);

  useEffect(() => {
    if (provinceId) {
      api.get('/shipping/cities', { params: { province_id: provinceId } })
        .then((r) => setCities(r.data.data));
    } else { setCities([]); }
    setCityId(''); setCosts([]); setChosenCost(null);
  }, [provinceId]);

  async function calcCost() {
    if (!cityId || !cart) return;
    try {
      const r = await api.post('/shipping/cost', {
        destination: cityId, weight: Math.max(1, cart.total_weight), courier,
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
    const cityObj = cities.find((c) => c.city_id === cityId);
    const provObj = provinces.find((p) => p.province_id === provinceId);
    const addr = `${recipient.address}\n${cityObj?.type ?? ''} ${cityObj?.city_name ?? ''}, ${provObj?.province ?? ''} ${cityObj?.postal_code ?? ''}`.trim();

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
      const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
      const snapUrl   = process.env.NEXT_PUBLIC_MIDTRANS_SNAP_URL
        || 'https://app.sandbox.midtrans.com/snap/snap.js';

      if (!r.data.mock && token && clientKey) {
        // Load snap.js dynamically and open popup
        await loadSnapScript(snapUrl, clientKey);
        // @ts-expect-error: global injected by snap.js
        window.snap.pay(token, {
          onSuccess: () => router.push(`/orders/${orderNumber}`),
          onPending: () => router.push(`/orders/${orderNumber}`),
          onClose:   () => router.push(`/orders/${orderNumber}`),
        });
      } else {
        // Dev/mock mode — just go to order detail
        router.push(`/orders/${orderNumber}`);
      }
    } catch (e) {
      toast.error(apiError(e));
    } finally { setSubmitting(false); }
  }

  if (!cart) return <div className="max-w-4xl mx-auto px-4 py-10 text-gray-500">Memuat keranjang...</div>;
  if (cart.items.length === 0) return <div className="max-w-4xl mx-auto px-4 py-10">Keranjang kosong.</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-4">
        <div className="card p-4">
          <h2 className="font-semibold mb-3">Alamat Pengiriman</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label">Nama penerima</label>
              <input className="input" value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} />
            </div>
            <div><label className="label">No. HP penerima</label>
              <input className="input" value={recipient.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} />
            </div>
            <div><label className="label">Provinsi</label>
              <select className="input" value={provinceId} onChange={(e) => setProvinceId(e.target.value)}>
                <option value="">-- pilih provinsi --</option>
                {provinces.map((p) => <option key={p.province_id} value={p.province_id}>{p.province}</option>)}
              </select>
            </div>
            <div><label className="label">Kota/Kabupaten</label>
              <select className="input" value={cityId} onChange={(e) => setCityId(e.target.value)} disabled={!provinceId}>
                <option value="">-- pilih kota --</option>
                {cities.map((c) => <option key={c.city_id} value={c.city_id}>{c.type} {c.city_name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><label className="label">Alamat lengkap</label>
              <textarea className="input" rows={2} value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} />
            </div>
          </div>
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
      </div>
    </div>
  );
}

function loadSnapScript(url: string, clientKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = url;
    s.setAttribute('data-client-key', clientKey);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('snap.js gagal dimuat'));
    document.head.appendChild(s);
  });
}
