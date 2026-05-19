'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/lib/stores';
import type { Address } from '@/lib/types';
import { AddressForm } from '@/components/AddressForm';

export default function AddressesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [items, setItems] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Address | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [authLoading, user, router]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get('/addresses');
      setItems(r.data.data ?? []);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) load();
  }, [user]);

  async function setDefault(addr: Address) {
    if (addr.is_default) return;
    try {
      const r = await api.patch(`/addresses/${addr.id}`, { is_default: true });
      // The server only returns the updated address; refetch the list so other
      // entries' is_default flags are reflected too.
      await load();
      // Avoid unused variable warning.
      void r;
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function remove(addr: Address) {
    if (!confirm(`Hapus alamat${addr.label ? ` "${addr.label}"` : ''}?`)) return;
    try {
      await api.delete(`/addresses/${addr.id}`);
      setItems((prev) => prev.filter((a) => a.id !== addr.id));
      toast.success('Alamat dihapus');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  function handleSaved(addr: Address) {
    setItems((prev) => {
      // If this one is the new default, clear is_default on the rest.
      const next = addr.is_default
        ? prev.map((a) => ({ ...a, is_default: a.id === addr.id ? true : false }))
        : prev;
      const exists = next.some((a) => a.id === addr.id);
      return exists ? next.map((a) => (a.id === addr.id ? addr : a)) : [addr, ...next];
    });
    setEditing(null);
    setCreating(false);
  }

  if (authLoading || !user) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-gray-500">Memuat...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Alamat Saya</h1>
          <p className="text-sm text-gray-500">Kelola alamat pengiriman pesananmu.</p>
        </div>
        {!creating && !editing && (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + Tambah Alamat
          </button>
        )}
      </div>

      {creating && (
        <div className="card p-4">
          <h2 className="font-semibold mb-3">Alamat Baru</h2>
          <AddressForm onSaved={handleSaved} onCancel={() => setCreating(false)} />
        </div>
      )}

      {editing && (
        <div className="card p-4">
          <h2 className="font-semibold mb-3">Ubah Alamat</h2>
          <AddressForm
            initial={editing}
            onSaved={handleSaved}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading ? (
        <div className="text-gray-500">Memuat alamat...</div>
      ) : items.length === 0 && !creating ? (
        <div className="card p-6 text-center text-gray-500">
          Belum ada alamat tersimpan. Klik &ldquo;Tambah Alamat&rdquo; untuk membuat alamat pertamamu.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div
              key={a.id}
              className={`card p-4 ${a.is_default ? 'border-brand ring-1 ring-brand/30' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.label && (
                      <span className="text-xs uppercase tracking-wide bg-gray-100 px-2 py-0.5 rounded">
                        {a.label}
                      </span>
                    )}
                    <span className="font-semibold">{a.recipient_name}</span>
                    <span className="text-sm text-gray-500">{a.phone}</span>
                    {a.is_default && (
                      <span className="text-xs bg-brand/10 text-brand px-2 py-0.5 rounded font-semibold">
                        Utama
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-700 whitespace-pre-line">
                    {a.address_line}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {a.city}, {a.province}
                    {a.postal_code ? ` ${a.postal_code}` : ''}
                  </div>
                </div>

                <div className="shrink-0 flex flex-col gap-1 items-stretch">
                  <button
                    className="btn-outline text-sm"
                    onClick={() => {
                      setCreating(false);
                      setEditing(a);
                    }}
                  >
                    Edit
                  </button>
                  {!a.is_default && (
                    <button
                      className="btn-ghost text-sm"
                      onClick={() => setDefault(a)}
                    >
                      Jadikan Utama
                    </button>
                  )}
                  <button
                    className="btn-ghost text-sm text-red-600"
                    onClick={() => remove(a)}
                  >
                    Hapus
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
