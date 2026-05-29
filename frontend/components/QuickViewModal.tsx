'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import { useAuth, useCart, useSiteSettings } from '@/lib/stores';
import type { Product, ProductVariant } from '@/lib/types';

/**
 * Modal "Lihat Cepat": menampilkan ringkasan produk + variant picker + qty +
 * Add to Cart / Beli Sekarang, **tanpa** memuat halaman detail penuh. Datanya
 * di-fetch on-demand saat modal dibuka, supaya listing tetap ringan.
 *
 * Modal ini sengaja TIDAK render description panjang — itu fungsi halaman detail.
 * Tujuannya: pelanggan yang cuma ingin compare 2-3 produk dari listing tidak
 * perlu bolak-balik ke detail page.
 */
export function QuickViewModal({
  slug, onClose,
}: { slug: string; onClose: () => void }) {
  const router = useRouter();
  const { user } = useAuth();
  const { add } = useCart();
  const settings = useSiteSettings((s) => s.settings);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Lock body scroll saat modal terbuka, restore saat di-unmount.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Tutup modal saat pencet Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    api.get(`/products/${slug}`)
      .then((r) => {
        const p = r.data.data as Product;
        setProduct(p);
        if (p.has_variants && p.variants && p.variants.length > 0) {
          const firstInStock = p.variants.find((v) => v.stock > 0) ?? p.variants[0];
          setSelectedVariantId(firstInStock.id);
        }
      })
      .catch((e) => toast.error(apiError(e)))
      .finally(() => setLoading(false));
  }, [slug]);

  const selectedVariant: ProductVariant | null = useMemo(() => {
    if (!product?.has_variants || !product.variants) return null;
    return product.variants.find((v) => v.id === selectedVariantId) ?? null;
  }, [product, selectedVariantId]);

  const displayPrice = selectedVariant?.selling_price ?? product?.selling_price ?? 0;
  const displayStock = selectedVariant ? selectedVariant.stock : (product?.stock ?? 0);
  const mainImage =
    selectedVariant?.image
    ?? product?.images?.[0]
    ?? 'https://placehold.co/400x400/111827/ffffff?text=Ranco';

  const threshold =
    product && typeof product.low_stock_threshold === 'number' && product.low_stock_threshold > 0
      ? product.low_stock_threshold
      : settings.low_stock_threshold ?? 5;
  const isOut = displayStock <= 0;
  const isLow = !isOut && displayStock <= threshold;

  async function onAddToCart() {
    if (!product) return;
    if (!user) { router.push('/login'); return; }
    if (product.has_variants && !selectedVariantId) {
      toast.error('Pilih varian dulu'); return;
    }
    setBusy(true);
    try {
      await add(product.id, qty, selectedVariantId);
      toast.success('Ditambahkan ke keranjang');
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  function onBuyNow() {
    if (!product) return;
    if (!user) { router.push('/login'); return; }
    if (isOut) return;
    if (product.has_variants && !selectedVariantId) {
      toast.error('Pilih varian dulu'); return;
    }
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('ranco.buyNow', JSON.stringify({
        product_id: product.id,
        variant_id: selectedVariantId,
        quantity: qty,
        _preview: {
          name: product.name,
          variant_name: selectedVariant?.name ?? null,
          image: mainImage,
          unit_price: displayPrice,
          weight: selectedVariant?.weight ?? product.weight,
          stock: displayStock,
        },
      }));
    }
    router.push('/checkout?buy_now=1');
    onClose();
  }

  const variants = product?.variants ?? [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="font-semibold text-sm">Lihat Cepat</div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-xl leading-none"
            aria-label="Tutup"
          >
            ×
          </button>
        </div>

        {loading || !product ? (
          <div className="p-8 text-center text-gray-500">Memuat...</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4 p-4">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mainImage}
                alt={product.name}
                className="w-full rounded-xl bg-gray-100 aspect-square object-cover"
              />
              {(isOut || isLow) && (
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                  {isOut && (
                    <span className="text-xs font-semibold uppercase tracking-wide bg-red-600 text-white px-2 py-1 rounded">
                      Stok Habis
                    </span>
                  )}
                  {isLow && (
                    <span className="text-xs font-semibold uppercase tracking-wide bg-amber-500 text-white px-2 py-1 rounded">
                      Tinggal {displayStock}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs text-gray-500">{product.category?.name}</div>
              <h2 className="text-lg font-bold leading-tight">{product.name}</h2>
              <div className="text-2xl font-bold text-brand">{formatRupiah(displayPrice)}</div>
              <div className="text-xs text-gray-500">
                Stok: {displayStock} · Berat: {selectedVariant?.weight ?? product.weight} gr
              </div>

              {variants.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-xs text-gray-600">
                    Varian{selectedVariant && <span className="font-medium text-gray-900">: {selectedVariant.name}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {variants.map((v) => {
                      const active = v.id === selectedVariantId;
                      const out = v.stock === 0;
                      return (
                        <button
                          type="button"
                          key={v.id}
                          onClick={() => !out && setSelectedVariantId(v.id)}
                          disabled={out}
                          className={[
                            'px-2.5 py-1 rounded-md border text-xs flex items-center gap-1.5 transition',
                            active
                              ? 'border-brand bg-brand/10 text-brand'
                              : 'border-gray-200 hover:border-gray-300',
                            out ? 'opacity-50 line-through cursor-not-allowed' : '',
                          ].join(' ')}
                        >
                          {v.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.image} alt="" className="w-4 h-4 object-cover rounded-sm" />
                          )}
                          <span>{v.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <span className="text-sm text-gray-600">Jumlah:</span>
                <button
                  type="button"
                  className="btn-outline px-2"
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  disabled={isOut}
                >
                  -
                </button>
                <span className="w-8 text-center">{qty}</span>
                <button
                  type="button"
                  className="btn-outline px-2"
                  onClick={() => setQty(Math.min(displayStock, qty + 1))}
                  disabled={isOut}
                >
                  +
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-3">
                <button
                  type="button"
                  onClick={onAddToCart}
                  disabled={isOut || busy || (product.has_variants && !selectedVariantId)}
                  className="btn-outline disabled:opacity-50"
                >
                  + Keranjang
                </button>
                <button
                  type="button"
                  onClick={onBuyNow}
                  disabled={isOut || busy || (product.has_variants && !selectedVariantId)}
                  className="btn-primary disabled:opacity-50"
                >
                  Beli Sekarang
                </button>
              </div>

              <Link
                href={`/product/${product.slug}`}
                className="block text-center text-sm text-brand hover:underline mt-2"
                onClick={onClose}
              >
                Lihat detail lengkap →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
