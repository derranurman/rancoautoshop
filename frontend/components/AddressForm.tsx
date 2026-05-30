'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import type { Address, Subdistrict } from '@/lib/types';

type Province = { province_id: string; province: string };
type City = {
  city_id: string;
  province_id: string;
  type: string;
  city_name: string;
  postal_code: string;
};

interface Props {
  /** When provided, the form is in "edit" mode. */
  initial?: Address | null;
  /** Called with the created/updated address on success. */
  onSaved: (addr: Address) => void;
  onCancel?: () => void;
}

/**
 * Reusable form for creating or editing a customer address.
 * - Loads provinces from RajaOngkir API on mount.
 * - Loads cities when province changes.
 * - Loads subdistricts (kecamatan) when city changes — kecamatan picker
 *   is hidden when the chosen city has no kecamatan data, in which case
 *   ongkir falls back to city level (still correct, just less granular).
 * - When editing, tries to preselect the matching province / city /
 *   kecamatan by id first, then by name.
 */
export function AddressForm({ initial, onSaved, onCancel }: Props) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [recipient, setRecipient] = useState(initial?.recipient_name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [addressLine, setAddressLine] = useState(initial?.address_line ?? '');
  const [postalCode, setPostalCode] = useState(initial?.postal_code ?? '');
  const [isDefault, setIsDefault] = useState<boolean>(!!initial?.is_default);

  const [provinces, setProvinces] = useState<Province[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [subdistricts, setSubdistricts] = useState<Subdistrict[]>([]);
  const [provinceId, setProvinceId] = useState('');
  const [cityId, setCityId] = useState(initial?.city_id ?? '');
  const [subdistrictId, setSubdistrictId] = useState(initial?.subdistrict_id ?? '');
  const [busy, setBusy] = useState(false);

  // Load provinces once.
  useEffect(() => {
    api.get('/shipping/provinces')
      .then((r) => setProvinces(r.data.data ?? []))
      .catch((e) => toast.error(apiError(e)));
  }, []);

  // When provinces arrive and we are editing, try to match by name.
  useEffect(() => {
    if (!initial || !provinces.length || provinceId) return;
    const match = provinces.find(
      (p) => p.province.toLowerCase() === (initial.province ?? '').toLowerCase(),
    );
    if (match) setProvinceId(match.province_id);
  }, [provinces, initial, provinceId]);

  // Load cities whenever province changes.
  useEffect(() => {
    if (!provinceId) {
      setCities([]);
      return;
    }
    api.get('/shipping/cities', { params: { province_id: provinceId } })
      .then((r) => setCities(r.data.data ?? []))
      .catch((e) => toast.error(apiError(e)));
  }, [provinceId]);

  // When cities arrive in edit mode, preselect by stored city_id or city name.
  useEffect(() => {
    if (!initial || !cities.length) return;
    if (initial.city_id && cities.some((c) => c.city_id === initial.city_id)) {
      setCityId(initial.city_id);
      return;
    }
    const match = cities.find(
      (c) =>
        `${c.type} ${c.city_name}`.toLowerCase() === (initial.city ?? '').toLowerCase()
        || c.city_name.toLowerCase() === (initial.city ?? '').toLowerCase(),
    );
    if (match) setCityId(match.city_id);
  }, [cities, initial]);

  // Load subdistricts (kecamatan) whenever the selected city changes.
  // Empty response means "kecamatan data not available for this city" —
  // we keep the dropdown hidden and silently fall back to city-level
  // ongkir, which is still correct just less granular.
  useEffect(() => {
    if (!cityId) {
      setSubdistricts([]);
      setSubdistrictId('');
      return;
    }
    let cancelled = false;
    api.get('/shipping/subdistricts', { params: { city_id: cityId } })
      .then((r) => {
        if (cancelled) return;
        const list = (r.data.data ?? []) as Subdistrict[];
        setSubdistricts(list);
        // Preserve a previously-saved kecamatan when editing, but only if
        // the new city actually contains it (otherwise the value would be
        // silently wrong — e.g. user changed city after saving).
        if (initial?.subdistrict_id
            && list.some((s) => s.subdistrict_id === initial.subdistrict_id)) {
          setSubdistrictId(initial.subdistrict_id);
        } else if (initial?.subdistrict) {
          const byName = list.find(
            (s) => s.subdistrict_name.toLowerCase() === (initial.subdistrict ?? '').toLowerCase(),
          );
          if (byName) setSubdistrictId(byName.subdistrict_id);
        } else {
          setSubdistrictId('');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSubdistricts([]);
        setSubdistrictId('');
      });
    return () => { cancelled = true; };
  }, [cityId, initial?.subdistrict_id, initial?.subdistrict]);

  // Auto-fill postal code from selected city if user hasn't entered one.
  const selectedCity = useMemo(
    () => cities.find((c) => c.city_id === cityId) ?? null,
    [cities, cityId],
  );
  const selectedSubdistrict = useMemo(
    () => subdistricts.find((s) => s.subdistrict_id === subdistrictId) ?? null,
    [subdistricts, subdistrictId],
  );
  useEffect(() => {
    if (selectedCity && !postalCode) setPostalCode(selectedCity.postal_code);
  }, [selectedCity]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient.trim() || !phone.trim() || !addressLine.trim()) {
      toast.error('Lengkapi nama, no HP dan alamat lengkap.');
      return;
    }
    const province = provinces.find((p) => p.province_id === provinceId);
    const city = selectedCity;
    if (!province || !city) {
      toast.error('Pilih provinsi dan kota dulu.');
      return;
    }

    const payload = {
      label: label || null,
      recipient_name: recipient.trim(),
      phone: phone.trim(),
      province: province.province,
      city: `${city.type} ${city.city_name}`.trim(),
      city_id: city.city_id,
      // Only send kecamatan if the city actually has data and the user
      // picked one. Empty string clears any previous value on the server.
      subdistrict: selectedSubdistrict?.subdistrict_name ?? null,
      subdistrict_id: selectedSubdistrict?.subdistrict_id ?? null,
      postal_code: postalCode || city.postal_code || null,
      address_line: addressLine.trim(),
      is_default: isDefault,
    };

    setBusy(true);
    try {
      const res = initial
        ? await api.patch(`/addresses/${initial.id}`, payload)
        : await api.post('/addresses', payload);
      onSaved(res.data.data);
      toast.success(initial ? 'Alamat diperbarui' : 'Alamat ditambahkan');
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Label (opsional)</label>
          <input
            className="input"
            placeholder="Rumah, Kantor, ..."
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
          />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            Jadikan alamat utama
          </label>
        </div>

        <div>
          <label className="label">Nama Penerima</label>
          <input
            className="input"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            required
            maxLength={120}
          />
        </div>
        <div>
          <label className="label">No. HP Penerima</label>
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            maxLength={20}
          />
        </div>

        <div>
          <label className="label">Provinsi</label>
          <select
            className="input"
            value={provinceId}
            onChange={(e) => {
              setProvinceId(e.target.value);
              setCityId('');
              setSubdistrictId('');
            }}
            required
          >
            <option value="">-- pilih provinsi --</option>
            {provinces.map((p) => (
              <option key={p.province_id} value={p.province_id}>
                {p.province}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Kota / Kabupaten</label>
          <select
            className="input"
            value={cityId}
            onChange={(e) => {
              setCityId(e.target.value);
              setSubdistrictId('');
            }}
            disabled={!provinceId}
            required
          >
            <option value="">-- pilih kota --</option>
            {cities.map((c) => (
              <option key={c.city_id} value={c.city_id}>
                {c.type} {c.city_name}
              </option>
            ))}
          </select>
        </div>

        {/* Kecamatan picker — only rendered when the chosen city actually
            has kecamatan data. Otherwise we silently fall back to city-
            level ongkir so the form doesn't show an empty/disabled
            dropdown that just confuses the user. */}
        {cityId && subdistricts.length > 0 && (
          <div>
            <label className="label">Kecamatan</label>
            <select
              className="input"
              value={subdistrictId}
              onChange={(e) => setSubdistrictId(e.target.value)}
            >
              <option value="">-- pilih kecamatan (opsional) --</option>
              {subdistricts.map((s) => (
                <option key={s.subdistrict_id} value={s.subdistrict_id}>
                  {s.subdistrict_name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Memilih kecamatan membuat ongkir lebih akurat.
            </p>
          </div>
        )}

        <div>
          <label className="label">Kode Pos</label>
          <input
            className="input"
            value={postalCode ?? ''}
            onChange={(e) => setPostalCode(e.target.value)}
            placeholder={selectedCity?.postal_code ?? ''}
            maxLength={10}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Alamat Lengkap</label>
          <textarea
            className="input min-h-[80px]"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            placeholder="Jalan, nomor rumah, RT/RW, patokan..."
            required
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button type="button" className="btn-outline" onClick={onCancel} disabled={busy}>
            Batal
          </button>
        )}
        <button type="submit" className="btn-primary disabled:opacity-50" disabled={busy}>
          {busy ? 'Menyimpan...' : initial ? 'Simpan Perubahan' : 'Tambah Alamat'}
        </button>
      </div>
    </form>
  );
}
