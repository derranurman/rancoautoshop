'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import { useAuth, useCart } from '@/lib/stores';
import { paySnap } from '@/lib/midtrans';
import { COURIER_CODES, COURIERS, type CourierCode } from '@/lib/couriers';
import { useSiteSettings } from '@/lib/stores';
import type { Address, PaymentMethod } from '@/lib/types';

type Province = { province_id: string; province: string };
type City = { city_id: string; province_id: string; type: string; city_name: string; postal_code: string };
type Subdistrict = { subdistrict_id: string; city_id: string; subdistrict_name: string };
type Cost = { courier: string; service: string; description: string; cost: number; etd: string };

/**
 * Cache helper berbasis localStorage untuk data yang sangat statis seperti
 * daftar provinsi & kota RajaOngkir. Tujuannya supaya halaman checkout tidak
 * lagi nunggu jaringan ke RajaOngkir setiap kali dibuka. TTL 7 hari sudah
 * cukup (jarang ada provinsi/kota baru).
 */
/** TTL default 7 hari untuk data yang sangat statis (provinsi, kota). */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function cacheGet<T>(key: string, ttl: number = CACHE_TTL_MS): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { ts: number; v: T };
    if (Date.now() - obj.ts > ttl) return null;
    return obj.v;
  } catch { return null; }
}
function cacheSet<T>(key: string, v: T) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v })); } catch { /* quota? ignore */ }
}

/** Normalisasi nama provinsi/kota supaya match-nya toleran (whitespace, prefix). */
function normName(s: string | null | undefined): string {
  return (s ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^provinsi\s+/, '')
    .replace(/^dki\s+/, '');
}

/** Snapshot mini produk yang disimpan di sessionStorage untuk mode Beli Sekarang. */
interface BuyNowItem {
  product_id: number;
  /** Varian terpilih (kalau produk punya varian). */
  variant_id?: number | null;
  quantity: number;
  _preview: {
    name: string;
    /** Nama varian terpilih (cth: "Merah"). */
    variant_name?: string | null;
    image: string | null;
    unit_price: number;
    weight: number;
    stock: number;
  };
}

export default function CheckoutPage() {
  // useSearchParams() butuh Suspense boundary saat build (Next.js App Router).
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto px-4 py-10 text-gray-500">Memuat checkout...</div>}>
      <CheckoutPageInner />
    </Suspense>
  );
}

function CheckoutPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { cart, fetch: fetchCart } = useCart();
  // Pengaturan site (untuk tahu apakah transfer manual diaktifkan + info rekening
  // di section ringkasan). Sudah otomatis di-load di layout storefront.
  const siteSettings = useSiteSettings((s) => s.settings);
  const manualTransferAvailable = !!siteSettings.manual_transfer_enabled
    && !!siteSettings.bank_account_number;

  // Mode Beli Sekarang: dipicu saat URL mengandung ?buy_now=1 dan ada item
  // di sessionStorage. Dalam mode ini, halaman ini TIDAK memakai keranjang
  // sama sekali — dia checkout single item dengan qty yang sudah dipilih
  // pembeli di halaman detail produk.
  const buyNowMode = search?.get('buy_now') === '1';
  const [buyNow, setBuyNow] = useState<BuyNowItem | null>(null);

  const [recipient, setRecipient] = useState({ name: '', phone: '', address: '' });
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [subdistricts, setSubdistricts] = useState<Subdistrict[]>([]);
  const [provincesLoading, setProvincesLoading] = useState(true);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [provinceId, setProvinceId] = useState('');
  const [cityId, setCityId] = useState('');
  const [subdistrictId, setSubdistrictId] = useState('');
  // Free-text fallback ketika kota terpilih tidak punya daftar kecamatan
  // di mock dataset. Tidak punya subdistrict_id, jadi tidak ikut hitung
  // ongkir tapi tetap di-persist untuk dicetak di label pengiriman.
  const [manualSubdistrict, setManualSubdistrict] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [courier, setCourier] = useState<CourierCode>('jne');
  const [costs, setCosts] = useState<Cost[]>([]);
  const [chosenCost, setChosenCost] = useState<Cost | null>(null);
  const [voucherCode, setVoucherCode] = useState('');
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('midtrans');
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
      // Cart tetap di-fetch supaya badge "Keranjang" di navbar tetap update.
      // Angkanya tidak dipakai di halaman ini saat mode Beli Sekarang.
      fetchCart();

      // Daftar alamat: tampilkan dari cache localStorage dulu (TTL 5 menit)
      // supaya user yang sebelumnya sudah pernah checkout langsung lihat
      // alamatnya tanpa kedip "Pilih dari alamat tersimpan" → form kosong.
      const cachedAddrs = cacheGet<Address[]>(`ranco.addresses.${user.id}`, 5 * 60 * 1000);
      if (cachedAddrs && cachedAddrs.length > 0) {
        setAddresses(cachedAddrs);
      }
      api.get('/addresses')
        .then((r) => {
          const list = (r.data.data ?? []) as Address[];
          setAddresses(list);
          cacheSet(`ranco.addresses.${user.id}`, list);
        })
        .catch(() => { if (!cachedAddrs) setAddresses([]); });
    }
    // Provinsi: pakai cache localStorage dulu supaya UI tidak nge-blank tunggu
    // network. Kalau cache ada, langsung pakai; di latar belakang tetap
    // refresh dari server supaya data nggak basi.
    //
    // Cache key di-prefix `v2` karena dataset provinsi/kota di backend telah
    // dirombak (resolve duplicate IDs, tambah Kabupaten lengkap). Tanpa
    // bump prefix, browser yang sudah punya cache lama akan terus pakai
    // ID lama dan dropdown Kota gagal di-load (province_id mismatch).
    const cached = cacheGet<Province[]>('ranco.v2.provinces');
    if (cached && cached.length > 0) {
      setProvinces(cached);
      setProvincesLoading(false);
    } else {
      setProvincesLoading(true);
    }
    api.get('/shipping/provinces')
      .then((r) => {
        const list = (r.data.data ?? []) as Province[];
        setProvinces(list);
        cacheSet('ranco.v2.provinces', list);
      })
      .catch((e) => {
        if (!cached) toast.error('Gagal memuat daftar provinsi: ' + apiError(e));
      })
      .finally(() => setProvincesLoading(false));
  }, [user, authLoading, fetchCart, router]);

  // Muat snapshot Beli Sekarang dari sessionStorage. Kalau mode buy_now
  // diaktifkan tapi tidak ada data, anggap kadaluarsa dan balik ke katalog.
  useEffect(() => {
    if (!buyNowMode) { setBuyNow(null); return; }
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem('ranco.buyNow');
    if (!raw) {
      toast.error('Sesi "Beli Sekarang" sudah berakhir. Silakan ulangi dari halaman produk.');
      router.replace('/');
      return;
    }
    try {
      const parsed = JSON.parse(raw) as BuyNowItem;
      if (!parsed?.product_id || !parsed?.quantity) throw new Error('invalid');
      setBuyNow(parsed);
    } catch {
      sessionStorage.removeItem('ranco.buyNow');
      router.replace('/');
    }
  }, [buyNowMode, router]);

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
      const cached = cacheGet<City[]>(`ranco.v2.cities.${provinceId}`);
      if (cached && cached.length > 0) {
        setCities(cached);
        setCitiesLoading(false);
      } else {
        setCitiesLoading(true);
      }
      api.get('/shipping/cities', { params: { province_id: provinceId } })
        .then((r) => {
          const list = (r.data.data ?? []) as City[];
          setCities(list);
          cacheSet(`ranco.v2.cities.${provinceId}`, list);
        })
        .catch((e) => {
          if (!cached) {
            toast.error('Gagal memuat daftar kota: ' + apiError(e));
            setCities([]);
          }
        })
        .finally(() => setCitiesLoading(false));
    } else {
      setCities([]);
    }
    setCityId('');
    setSubdistrictId('');
    setSubdistricts([]);
    setManualSubdistrict('');
    setCosts([]);
    setChosenCost(null);
  }, [provinceId]);

  // First-time auto-pick. Runs only ONCE: when BOTH the saved-addresses list
  // AND the provinces list have been loaded. This avoids a race where the
  // addresses list arrived first, applyAddress() matched against an empty
  // provinces array, and provinceId stayed blank — which made "Cek Ongkir"
  // permanently disabled even though an address was clearly chosen.
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (autoAppliedRef.current) return;
    if (provincesLoading) return;
    if (provinces.length === 0) return;

    autoAppliedRef.current = true;
    if (addresses.length === 0) {
      // No saved addresses → user has to fill the form by hand.
      setEditing(true);
      return;
    }
    const def = addresses.find((a) => a.is_default) ?? addresses[0];
    applyAddress(def);
    setSelectedAddrId(def.id);
    setEditing(false);
  }, [addresses, provinces, provincesLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyAddress(a: Address) {
    setRecipient({ name: a.recipient_name, phone: a.phone, address: a.address_line });
    setPostalCode(a.postal_code ?? '');

    // FAST PATH: kalau alamat tersimpan punya city_id RajaOngkir, langsung set
    // sebagai destination ongkir. Tidak perlu nunggu province → cities di-fetch
    // dulu, jadi user yang sudah pernah checkout tidak akan kena delay sama
    // sekali untuk hitung ongkir.
    if (a.city_id) {
      setCityId(a.city_id);
    }
    // Same fast-path for subdistrict — biar ongkir kecamatan-aware langsung
    // ke-recompute tanpa nunggu /shipping/subdistricts selesai. Kalau city
    // berubah jadi kota lain, subdistrict effect di bawah akan reset value
    // ini begitu daftar baru tiba.
    if (a.subdistrict_id) {
      setSubdistrictId(a.subdistrict_id);
    } else {
      setSubdistrictId('');
    }

    // Match province by name untuk kebutuhan dropdown UI (kalau user buka
    // mode "Ubah"). Pakai normalisasi case/whitespace/prefix supaya toleran
    // terhadap "DKI Jakarta" vs "Jakarta", "Provinsi Jawa Barat" vs "Jawa Barat", dst.
    const target = normName(a.province);
    const prov = provinces.find((p) => normName(p.province) === target);
    if (prov) {
      setProvinceId(prov.province_id);
      // Always populate pending refs sebagai safety net. Saat setProvinceId
      // di atas men-trigger province effect, cityId fast-path bisa ter-reset
      // ke ''. Cities-effect berikutnya akan baca refs ini dan men-set
      // cityId balik (lewat city_id kalau ada, atau lookup by nama kota).
      pendingCityIdRef.current = a.city_id ?? null;
      pendingCityNameRef.current = a.city ?? null;
      pendingSubdistrictIdRef.current = a.subdistrict_id ?? null;
      pendingSubdistrictNameRef.current = a.subdistrict ?? null;
    } else {
      // Province tidak ketemu — biarkan dropdown kosong, tapi cityId tetap
      // berfungsi kalau sudah di-set lewat fast-path di atas.
      setProvinceId('');
    }
  }

  // Refs to bridge the async city load (province change triggers city fetch
  // asynchronously; we stash the desired city until the list arrives).
  const pendingCityIdRef = useRef<string | null>(null);
  const pendingCityNameRef = useRef<string | null>(null);
  // Same idea for kecamatan — gets stashed by applyAddress and consumed
  // when the subdistricts list for the resolved city arrives.
  const pendingSubdistrictIdRef = useRef<string | null>(null);
  const pendingSubdistrictNameRef = useRef<string | null>(null);

  // When cities arrive, try to resolve the pending city selection.
  useEffect(() => {
    if (!cities.length) return;
    const wantId = pendingCityIdRef.current;
    const wantName = pendingCityNameRef.current;
    if (!wantId && !wantName) return;
    const wantNameNorm = normName(wantName);
    const match =
      (wantId && cities.find((c) => c.city_id === wantId)) ||
      (wantName && cities.find((c) => {
        const full = normName(`${c.type} ${c.city_name}`);
        const just = normName(c.city_name);
        return full === wantNameNorm
            || just === wantNameNorm
            || full.includes(wantNameNorm)
            || wantNameNorm.includes(just);
      })) ||
      null;
    if (match) {
      setCityId(match.city_id);
      if (!postalCode) setPostalCode(match.postal_code);

      // Migration: kalau saved address yang lagi terpilih belum punya
      // city_id (alamat lama, dibuat sebelum kode ini ada), simpan city_id
      // hasil resolve ke server. Kunjungan checkout berikutnya langsung
      // pakai fast-path tanpa perlu lookup nama kota lagi.
      if (typeof selectedAddrId === 'number') {
        const addr = addresses.find((a) => a.id === selectedAddrId);
        if (addr && !addr.city_id) {
          api.patch(`/addresses/${addr.id}`, { city_id: match.city_id })
            .then(() => {
              setAddresses((prev) => {
                const next = prev.map((a) =>
                  a.id === addr.id ? { ...a, city_id: match.city_id } : a,
                );
                if (user) cacheSet(`ranco.addresses.${user.id}`, next);
                return next;
              });
            })
            .catch(() => { /* opsional, abaikan */ });
        }
      }
    }
    pendingCityIdRef.current = null;
    pendingCityNameRef.current = null;
  }, [cities]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load kecamatan whenever the selected city changes. Empty list means
  // the city has no kecamatan data → UI hides the dropdown and ongkir
  // falls back to city level. We also resolve any pending kecamatan
  // selection coming from a saved address.
  useEffect(() => {
    if (!cityId) {
      setSubdistricts([]);
      // Don't clear subdistrictId here — applyAddress's fast-path may
      // have set it for a not-yet-loaded city; the next cityId update
      // will sort it out.
      return;
    }
    let cancelled = false;
    api.get('/shipping/subdistricts', { params: { city_id: cityId } })
      .then((r) => {
        if (cancelled) return;
        const list = (r.data.data ?? []) as Subdistrict[];
        setSubdistricts(list);

        // Resolve any pending kecamatan selection from a saved address.
        const wantId = pendingSubdistrictIdRef.current;
        const wantName = pendingSubdistrictNameRef.current;
        if (wantId && list.some((s) => s.subdistrict_id === wantId)) {
          setSubdistrictId(wantId);
        } else if (wantName) {
          const m = list.find(
            (s) => s.subdistrict_name.toLowerCase() === wantName.toLowerCase(),
          );
          if (m) setSubdistrictId(m.subdistrict_id);
          else setSubdistrictId('');
        } else if (subdistrictId && !list.some((s) => s.subdistrict_id === subdistrictId)) {
          // Existing selection no longer valid for this city — clear it.
          setSubdistrictId('');
        }
        pendingSubdistrictIdRef.current = null;
        pendingSubdistrictNameRef.current = null;
      })
      .catch(() => {
        if (cancelled) return;
        setSubdistricts([]);
        setSubdistrictId('');
      });
    return () => { cancelled = true; };
  }, [cityId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Subtotal & berat yang dipakai di halaman ini bergantung pada mode:
  // - Beli Sekarang: dari snapshot produk single
  // - Normal: dari keranjang user
  const viewSubtotal = buyNow
    ? buyNow._preview.unit_price * buyNow.quantity
    : (cart?.subtotal ?? 0);
  const viewWeight = buyNow
    ? Math.max(1, buyNow._preview.weight * buyNow.quantity)
    : (cart?.total_weight ?? 0);

  // Auto-cek ongkir: begitu kota & kurir + berat siap, langsung fetch tanpa
  // perlu user klik tombol. Hasil ongkir di-cache di localStorage (TTL 30
  // menit) per kombinasi (city_id × kurir × berat) supaya kunjungan
  // berikutnya dengan tujuan yang sama langsung tampil tanpa hit RajaOngkir.
  //
  // Penting: gunakan AbortController + debounce 250ms supaya saat user
  // berpindah-pindah kurir dengan cepat (JNE → J&T → POS), request lama
  // dibatalkan dulu sebelum yang baru dikirim. Tanpa ini, beberapa request
  // ke RajaOngkir berjalan paralel, response yang datang terakhir bisa
  // tidak sesuai dengan kurir terpilih, dan PHP-FPM bisa kehabisan worker
  // yang akhirnya muncul sebagai error 500 di browser.
  const [costsLoading, setCostsLoading] = useState(false);
  const costAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!cityId) {
      setCosts([]);
      setChosenCost(null);
      setCostsLoading(false);
      return;
    }
    if (!buyNow && !cart) return;
    if (viewWeight <= 0) return;

    const weight = Math.max(1, viewWeight);
    // Cache key di-prefix `v4` agar invalid begitu pengaruh kecamatan ke
    // tarif diperbesar (sebelumnya v3 pakai range 0..2000; v4 pakai
    // 0..6000 supaya perubahan kecamatan benar-benar terasa).
    const cacheKey = `ranco.v4.cost.${cityId}.${subdistrictId || '-'}.${courier}.${weight}`;
    const cached = cacheGet<Cost[]>(cacheKey, 30 * 60 * 1000);
    if (cached && cached.length > 0) {
      setCosts(cached);
      setChosenCost((prev) => prev ?? cached[0] ?? null);
      // tetap refresh di latar belakang biar harga tidak basi.
    } else {
      // Tampilkan loading lebih awal kalau cache miss, supaya user tahu
      // sistem sedang mengambil tarif baru.
      setCostsLoading(true);
    }

    const timer = setTimeout(async () => {
      // Cancel any previous in-flight request before firing a new one.
      costAbortRef.current?.abort();
      const controller = new AbortController();
      costAbortRef.current = controller;

      setCostsLoading(true);
      try {
        const r = await api.post(
          '/shipping/cost',
          {
            destination: cityId,
            subdistrict_id: subdistrictId || undefined,
            weight,
            courier,
          },
          { signal: controller.signal },
        );
        const list = (r.data.data ?? []) as Cost[];
        setCosts(list);
        setChosenCost((prev) => prev ?? list[0] ?? null);
        if (list.length > 0) cacheSet(cacheKey, list);
      } catch (e: unknown) {
        // Axios cancel = jangan tampilkan toast, ini bukan kegagalan.
        const err = e as { code?: string; name?: string; message?: string };
        const isCanceled =
          err?.code === 'ERR_CANCELED' ||
          err?.name === 'CanceledError' ||
          err?.name === 'AbortError' ||
          err?.message === 'canceled';
        if (isCanceled) return;
        // Hanya tampilkan toast kalau kita tidak punya cache untuk ditampilkan.
        // Selain itu cukup biarkan UI menampilkan data lama / state kosong.
        if (!cached) toast.error(apiError(e));
      } finally {
        // Hanya matikan loading kalau controller ini yang masih aktif —
        // kalau sudah dibatalkan oleh request berikutnya, biarkan request
        // baru yang mengontrol state loading.
        if (costAbortRef.current === controller) {
          setCostsLoading(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      costAbortRef.current?.abort();
    };
  }, [cityId, subdistrictId, courier, viewWeight]); // eslint-disable-line react-hooks/exhaustive-deps

  async function applyVoucher() {
    if (!voucherCode) { setDiscount(0); return; }
    if (!buyNow && !cart) return;
    try {
      const r = await api.post('/vouchers/check', { code: voucherCode, subtotal: viewSubtotal });
      if (r.data.valid) { setDiscount(r.data.discount); toast.success('Voucher diterapkan'); }
      else { setDiscount(0); toast.error(r.data.message ?? 'Voucher tidak valid'); }
    } catch (e) { toast.error(apiError(e)); }
  }

  const total = useMemo(() => {
    const s = viewSubtotal;
    const sh = chosenCost?.cost ?? 0;
    return Math.max(0, s - discount + sh);
  }, [viewSubtotal, chosenCost?.cost, discount]);

  async function onSubmit() {
    if (!chosenCost) { toast.error('Pilih layanan pengiriman dulu'); return; }
    if (!recipient.phone.trim()) {
      toast.error('No HP penerima wajib diisi');
      return;
    }
    const cityObj = cities.find((c) => c.city_id === cityId);
    const provObj = provinces.find((p) => p.province_id === provinceId);
    const subdObj = subdistricts.find((s) => s.subdistrict_id === subdistrictId) ?? null;
    // Resolve nama kecamatan terpilih: prioritas dari dropdown curated,
    // fallback ke input manual untuk kota minor.
    const kecamatanName = subdObj?.subdistrict_name ?? (manualSubdistrict.trim() || null);
    const pc = postalCode || cityObj?.postal_code || '';
    // Sertakan kecamatan di alamat cetak supaya kurir punya patokan
    // tambahan untuk drop-off (label tetap valid bahkan tanpa kecamatan).
    const kecamatanLine = kecamatanName ? `Kec. ${kecamatanName}, ` : '';
    const addr = `${recipient.address}\n${kecamatanLine}${cityObj?.type ?? ''} ${cityObj?.city_name ?? ''}, ${provObj?.province ?? ''} ${pc}`.trim();

    setSubmitting(true);
    try {
      // Kalau pembeli mengisi alamat baru manual (bukan dari alamat tersimpan),
      // simpan dulu sebagai entry di buku alamat supaya checkout berikutnya
      // tinggal pilih dan tidak perlu mengisi ulang. Dijadikan default kalau
      // dia memang belum punya alamat tersimpan sebelumnya.
      if (selectedAddrId === 'new'
          && recipient.name?.trim()
          && recipient.phone?.trim()
          && recipient.address?.trim()
          && cityObj && provObj) {
        try {
          const saved = await api.post('/addresses', {
            label: 'Rumah',
            recipient_name: recipient.name,
            phone: recipient.phone,
            address_line: recipient.address,
            province: provObj.province,
            city: `${cityObj.type} ${cityObj.city_name}`,
            city_id: cityObj.city_id,
            subdistrict: kecamatanName,
            subdistrict_id: subdObj?.subdistrict_id ?? null,
            postal_code: pc || cityObj.postal_code || '',
            is_default: addresses.length === 0,
          });
          // Sinkronkan state lokal supaya UI alamat tersimpan ikut update,
          // dan refresh cache localStorage agar kunjungan checkout berikutnya
          // langsung pakai alamat ini tanpa fetch.
          if (saved?.data?.data) {
            const newAddr = saved.data.data as Address;
            setAddresses((prev) => {
              const next = [...prev, newAddr];
              if (user) cacheSet(`ranco.addresses.${user.id}`, next);
              return next;
            });
            setSelectedAddrId(newAddr.id);
          }
        } catch {
          // Bukan kegagalan kritis — checkout tetap lanjut walau save alamat gagal.
        }
      }

      const payload: Record<string, unknown> = {
        recipient_name: recipient.name,
        recipient_phone: recipient.phone,
        shipping_address: addr,
        courier: chosenCost.courier,
        courier_service: chosenCost.service,
        shipping_cost: chosenCost.cost,
        voucher_code: voucherCode || undefined,
        payment_method: paymentMethod,
      };
      // Mode Beli Sekarang: kirim payload buy_now supaya backend membuat
      // order hanya dari produk ini, tanpa menyentuh keranjang user.
      if (buyNow) {
        const bn: Record<string, unknown> = {
          product_id: buyNow.product_id,
          quantity: buyNow.quantity,
        };
        if (buyNow.variant_id) bn.variant_id = buyNow.variant_id;
        payload.buy_now = bn;
      }
      const r = await api.post('/orders/checkout', payload);
      // Bersihkan snapshot Beli Sekarang setelah order berhasil dibuat,
      // supaya kalau user balik ke /checkout dia kembali ke flow keranjang.
      if (buyNow && typeof window !== 'undefined') {
        sessionStorage.removeItem('ranco.buyNow');
      }
      toast.success('Pesanan dibuat');
      const orderNumber = r.data.order.order_number;
      const token = r.data.snap_token as string | null;
      const isMock = !!r.data.mock;

      // Untuk transfer manual, langsung loncat ke halaman order detail —
      // di sana customer akan melihat info rekening + tombol upload bukti.
      if (paymentMethod === 'manual_transfer') {
        router.push(`/orders/${orderNumber}`);
        return;
      }

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

  // Loading & empty states. Dalam mode Beli Sekarang kita tidak butuh cart.
  if (buyNowMode && !buyNow) {
    return <div className="max-w-4xl mx-auto px-4 py-10 text-gray-500">Memuat data produk...</div>;
  }
  if (!buyNow) {
    if (!cart) return <div className="max-w-4xl mx-auto px-4 py-10 text-gray-500">Memuat keranjang...</div>;
    if (cart.items.length === 0) return <div className="max-w-4xl mx-auto px-4 py-10">Keranjang kosong.</div>;
  }

  // The summary view of the currently-selected saved address (when not editing).
  const selectedAddr = typeof selectedAddrId === 'number'
    ? addresses.find((a) => a.id === selectedAddrId) ?? null
    : null;

  // Helper note shown when shipping cost can't be calculated yet.
  const cekOngkirHint =
    !cityId
      ? (selectedAddr && !editing
          ? 'Klik "Ubah" untuk memilih kota tujuan'
          : 'Pilih kota tujuan dulu')
      : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 grid md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-4">
        {buyNow && (
          <div className="card p-3 border-brand/30 bg-brand/5 text-sm space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="font-semibold text-brand">Mode Beli Sekarang</div>
              <Link href="/cart" className="text-xs text-gray-500 hover:underline">
                Batal & ke keranjang
              </Link>
            </div>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={buyNow._preview.image ?? 'https://placehold.co/64x64/111827/ffffff?text=Ranco'}
                alt={buyNow._preview.name}
                className="h-14 w-14 rounded-md object-cover bg-gray-100 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{buyNow._preview.name}</div>
                {buyNow._preview.variant_name && (
                  <div className="text-xs text-gray-600">
                    Varian: <span className="font-medium">{buyNow._preview.variant_name}</span>
                  </div>
                )}
                <div className="text-xs text-gray-600">
                  {buyNow.quantity} × {formatRupiah(buyNow._preview.unit_price)}
                </div>
              </div>
              <div className="font-semibold whitespace-nowrap">
                {formatRupiah(buyNow._preview.unit_price * buyNow.quantity)}
              </div>
            </div>
            <div className="text-xs text-gray-500">
              Pembelian ini terpisah dari keranjangmu — barang yang sudah di keranjang
              tidak ikut ditagih.
            </div>
          </div>
        )}

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
                    {selectedAddr.subdistrict ? `Kec. ${selectedAddr.subdistrict}, ` : ''}
                    {selectedAddr.city}, {selectedAddr.province}
                    {selectedAddr.postal_code ? ` ${selectedAddr.postal_code}` : ''}
                  </div>
                  {/* Inline kecamatan picker — biar user bisa refine kecamatan
                      tanpa harus masuk mode "Ubah" alamat. Pilihan otomatis
                      memicu re-hitung ongkir + di-persist balik ke alamat
                      tersimpan supaya kunjungan checkout berikutnya langsung
                      pakai kecamatan terbaru. Hanya muncul kalau kota tujuan
                      memang punya data kecamatan curated. */}
                  {cityId && subdistricts.length > 0 && (
                    <div className="mt-2">
                      <label className="text-[11px] text-gray-500 block mb-0.5">
                        Kecamatan (untuk ongkir lebih akurat)
                      </label>
                      <select
                        className="input text-sm py-1"
                        value={subdistrictId}
                        onChange={(e) => {
                          const newId = e.target.value;
                          setSubdistrictId(newId);
                          // Persist balik ke alamat tersimpan supaya pilihan
                          // tidak hilang setelah checkout selesai. Tidak
                          // memblokir UI — kalau gagal, biarkan saja.
                          if (typeof selectedAddrId === 'number') {
                            const sub = subdistricts.find((s) => s.subdistrict_id === newId);
                            api.patch(`/addresses/${selectedAddrId}`, {
                              subdistrict: sub?.subdistrict_name ?? null,
                              subdistrict_id: sub?.subdistrict_id ?? null,
                            })
                              .then(() => {
                                setAddresses((prev) => {
                                  const next = prev.map((a) =>
                                    a.id === selectedAddrId
                                      ? {
                                          ...a,
                                          subdistrict: sub?.subdistrict_name ?? null,
                                          subdistrict_id: sub?.subdistrict_id ?? null,
                                        }
                                      : a,
                                  );
                                  if (user) cacheSet(`ranco.addresses.${user.id}`, next);
                                  return next;
                                });
                              })
                              .catch(() => { /* opsional */ });
                          }
                        }}
                      >
                        <option value="">-- pilih kecamatan --</option>
                        {subdistricts.map((s) => (
                          <option key={s.subdistrict_id} value={s.subdistrict_id}>
                            {s.subdistrict_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* Surface a clear hint if we couldn't auto-resolve the city to
                      a RajaOngkir id — e.g. when the saved city name doesn't
                      match any city we know about. Without this, "Cek Ongkir"
                      stays disabled silently. */}
                  {!cityId && (
                    <div className="mt-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                      Kota tujuan belum bisa otomatis dideteksi.
                      Klik <b>Ubah</b> dan pilih kota dari daftar agar ongkir bisa dihitung.
                    </div>
                  )}
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
                          onChange={(e) => {
                            setCityId(e.target.value);
                            setSubdistrictId('');
                          }}
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
                {/* Kecamatan picker.
                    - Kalau backend punya data curated → dropdown kecamatan.
                    - Kalau tidak (kota minor / belum di-mock) → input teks
                      bebas, supaya user tetap bisa tulis kecamatan untuk
                      keperluan label kurir. Backend tetap menerima kolom
                      `subdistrict` tanpa `subdistrict_id`; ongkir untuk
                      kasus ini dihitung level kota (zone-based) tanpa
                      adjustment per-kecamatan. */}
                {cityId && subdistricts.length > 0 ? (
                  <div>
                    <label className="label">Kecamatan</label>
                    <select className="input" value={subdistrictId}
                            onChange={(e) => setSubdistrictId(e.target.value)}>
                      <option value="">-- pilih kecamatan (opsional) --</option>
                      {subdistricts.map((s) => (
                        <option key={s.subdistrict_id} value={s.subdistrict_id}>
                          {s.subdistrict_name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-gray-500 mt-1">
                      Pilih kecamatan agar ongkir lebih akurat.
                    </p>
                  </div>
                ) : cityId ? (
                  <div>
                    <label className="label">Kecamatan</label>
                    <input
                      className="input"
                      value={manualSubdistrict}
                      onChange={(e) => setManualSubdistrict(e.target.value)}
                      placeholder="Tulis nama kecamatan (mis. Sumber, Kedawung)"
                      maxLength={120}
                    />
                    <p className="text-[11px] text-gray-500 mt-1">
                      Daftar kecamatan untuk kota ini belum tersedia — silakan ketik manual.
                      Ongkir dihitung level kota.
                    </p>
                  </div>
                ) : null}
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
          <div className="flex gap-2 mb-3 flex-wrap items-center">
            {COURIER_CODES.map((c) => (
              <button
                key={c}
                onClick={() => setCourier(c)}
                className={`btn ${courier === c ? 'bg-ink text-white' : 'bg-gray-100'}`}
                title={COURIERS[c].label}
              >
                {COURIERS[c].label}
              </button>
            ))}
            {costsLoading && (
              <span className="ml-auto text-xs text-gray-500">Menghitung ongkir...</span>
            )}
          </div>
          {/* Tampilkan berat total yang dipakai untuk hitung ongkir, supaya
              user paham kenapa ongkir berubah sesuai produk yang dibeli.
              RajaOngkir menghitung tarif per kelipatan kg (dibulatkan ke
              atas), jadi 2500 gr akan ditagih sebagai 3 kg. */}
          {viewWeight > 0 && (
            <div className="text-xs text-gray-600 mb-2">
              Berat total paket: <b>{viewWeight.toLocaleString('id-ID')} gr</b>
              {' '}(dihitung sebagai <b>{Math.ceil(viewWeight / 1000)} kg</b>)
            </div>
          )}
          {!cityId && cekOngkirHint && (
            <div className="text-xs text-gray-500 mb-2">{cekOngkirHint}.</div>
          )}
          {cityId && !costsLoading && costs.length === 0 && (
            <div className="text-xs text-gray-500 mb-2">Tidak ada layanan tersedia untuk kurir ini. Coba kurir lain.</div>
          )}
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
        <div className="flex justify-between text-sm"><span>Subtotal barang</span><span>{formatRupiah(viewSubtotal)}</span></div>
        <div className="flex justify-between text-sm"><span>Diskon</span><span>- {formatRupiah(discount)}</span></div>
        <div className="flex justify-between text-sm"><span>Ongkir</span><span>{formatRupiah(chosenCost?.cost ?? 0)}</span></div>
        <div className="border-t border-gray-100 pt-2 flex justify-between font-bold">
          <span>Total</span><span>{formatRupiah(total)}</span>
        </div>

        {/* Pilihan metode pembayaran. Manual transfer hanya muncul kalau admin
            sudah mengaktifkan dan mengisi rekening di Pengaturan Tampilan. */}
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="text-sm font-semibold">Metode Pembayaran</div>
          <label className={`flex items-start gap-2 rounded-lg border p-2 cursor-pointer ${paymentMethod === 'midtrans' ? 'border-brand bg-brand/5' : 'border-gray-200'}`}>
            <input
              type="radio"
              name="payment_method"
              value="midtrans"
              checked={paymentMethod === 'midtrans'}
              onChange={() => setPaymentMethod('midtrans')}
              className="mt-1"
            />
            <div className="text-sm">
              <div className="font-medium">Pembayaran Online (Midtrans)</div>
              <div className="text-xs text-gray-500">
                VA BCA/BNI/BRI/Mandiri/Permata, GoPay, ShopeePay, OVO, DANA, QRIS,
                Indomaret/Alfamart, kartu kredit, paylater.
              </div>
            </div>
          </label>
          <label className={[
            'flex items-start gap-2 rounded-lg border p-2',
            !manualTransferAvailable ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
            paymentMethod === 'manual_transfer' ? 'border-brand bg-brand/5' : 'border-gray-200',
          ].join(' ')}>
            <input
              type="radio"
              name="payment_method"
              value="manual_transfer"
              disabled={!manualTransferAvailable}
              checked={paymentMethod === 'manual_transfer'}
              onChange={() => setPaymentMethod('manual_transfer')}
              className="mt-1"
            />
            <div className="text-sm">
              <div className="font-medium">Transfer Manual</div>
              {manualTransferAvailable ? (
                <div className="text-xs text-gray-500">
                  Transfer ke <b>{siteSettings.bank_name}</b>{' '}
                  <span className="font-mono">{siteSettings.bank_account_number}</span>
                  {siteSettings.bank_account_holder ? ` a.n. ${siteSettings.bank_account_holder}` : ''}.
                  Upload bukti transfer setelah membuat pesanan.
                </div>
              ) : (
                <div className="text-xs text-gray-500">Belum tersedia.</div>
              )}
            </div>
          </label>
        </div>

        <button onClick={onSubmit} disabled={submitting || !chosenCost} className="btn-primary w-full mt-2">
          {submitting
            ? 'Memproses...'
            : paymentMethod === 'manual_transfer'
              ? 'Buat Pesanan & Lihat Rekening'
              : 'Bayar Sekarang'}
        </button>
        <div className="text-[11px] text-gray-500 text-center pt-1">
          {paymentMethod === 'manual_transfer'
            ? 'Setelah pesanan dibuat, transfer ke rekening lalu unggah bukti dari halaman pesanan.'
            : 'Pembayaran via Midtrans: BCA / BNI / BRI / Mandiri / Permata VA, GoPay, ShopeePay, OVO, DANA, QRIS, Indomaret/Alfamart, kartu kredit.'}
        </div>
      </div>
    </div>
  );
}
