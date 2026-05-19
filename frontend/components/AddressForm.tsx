'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import type { Address } from '@/lib/types';

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
 * - When editing, tries to preselect the matching province/city by name and
 *   falls back to free-text values returned from the server.
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
  const [provinceId, setProvinceId] = useState('');
  const [cityId, setCityId] = useState(initial?.city_id ?? '');
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

  // Auto-fill postal code from selected city if user hasn't entered one.
  const selectedCity = useMemo(
    () => cities.find((c) => c.city_id === cityId) ?? null,
    [cities, cityId],
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
            onChange={(e) => setCityId(e.target.value)}
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
