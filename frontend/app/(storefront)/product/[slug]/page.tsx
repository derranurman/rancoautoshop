'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiError, formatRupiah } from '@/lib/api';
import { useAuth, useCart, useSiteSettings } from '@/lib/stores';
import type { Product, ProductVariant } from '@/lib/types';

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const { user } = useAuth();
  const { add } = useCart();
  const settings = useSiteSettings((s) => s.settings);

  useEffect(() => {
    api.get(`/products/${slug}`).then((r) => {
      const p = r.data.data as Product;
      setProduct(p);
      // Pre-select varian pertama yang masih ada stoknya supaya CTA langsung
      // bisa diklik tanpa user perlu interaksi tambahan untuk produk varian
      // tunggal (kasus paling umum: ada satu warna yang stoknya cukup besar).
      if (p.has_variants && p.variants && p.variants.length > 0) {
        const firstInStock = p.variants.find((v) => v.stock > 0) ?? p.variants[0];
        setSelectedVariantId(firstInStock.id);
      }
    });
  }, [slug]);

  /** Varian yang sedang dipilih (kalau produk memang punya varian). */
  const selectedVariant: ProductVariant | null = useMemo(() => {
    if (!product?.has_variants || !product.variants) return null;
    return product.variants.find((v) => v.id === selectedVariantId) ?? null;
  }, [product, selectedVariantId]);

  // Harga tampil & stok ikut varian saat tersedia, kalau tidak fallback ke produk.
  const displayPrice = selectedVariant?.selling_price ?? product?.selling_price ?? 0;
  const displayStock = selectedVariant ? selectedVariant.stock : (product?.stock ?? 0);
  // Foto utama: kalau varian punya foto sendiri, prioritaskan; kalau tidak,
  // pakai foto pertama produk.
  const mainImage =
    selectedVariant?.image
    ?? product?.images?.[0]
    ?? 'https://placehold.co/600x600/111827/ffffff?text=Ranco';

  // Reset qty kalau melebihi stok varian terpilih (mis. ganti dari "Merah" stok 10
  // ke "Biru" stok 2 → qty 5 harus turun jadi 2).
  useEffect(() => {
    if (qty > displayStock && displayStock > 0) setQty(displayStock);
    if (displayStock === 0 && qty !== 1) setQty(1);
  }, [displayStock, qty]);

  if (!product) {
    return <div className="max-w-6xl mx-auto px-4 py-10 animate-pulse">Memuat...</div>;
  }

  async function onAddToCart() {
    if (!user) { router.push('/login'); return; }
    if (!product) return;
    if (product.has_variants && !selectedVariantId) {
      toast.error('Pilih varian dulu');
      return;
    }
    try {
      await add(product.id, qty, selectedVariantId);
      toast.success('Ditambahkan ke keranjang');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  /**
   * Beli Sekarang: TIDAK menambahkan ke keranjang. Kita simpan info produk
   * + varian + qty terpilih ke sessionStorage, lalu loncat ke halaman checkout
   * dengan flag `?buy_now=1`. Halaman checkout akan men-checkout single item
   * + variant ini saja.
   */
  function onBuyNow() {
    if (!user) { router.push('/login'); return; }
    if (!product) return;
    if (displayStock === 0) return;
    if (product.has_variants && !selectedVariantId) {
      toast.error('Pilih varian dulu');
      return;
    }

    if (typeof window !== 'undefined') {
      sessionStorage.setItem('ranco.buyNow', JSON.stringify({
        product_id: product.id,
        variant_id: selectedVariantId,
        quantity: qty,
        // Snapshot ringkas yang dipakai halaman checkout untuk preview
        // sebelum order benar-benar dibuat di server.
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
  }

  const variants = product.variants ?? [];
  const isBuyDisabled =
    displayStock === 0 || (product.has_variants && !selectedVariantId);

  // Threshold "stok tinggal sedikit" — per produk override dulu, kalau null
  // pakai default global toko.
  const lowThreshold =
    typeof product.low_stock_threshold === 'number' && product.low_stock_threshold > 0
      ? product.low_stock_threshold
      : settings.low_stock_threshold ?? 5;
  const isLowStock = displayStock > 0 && displayStock <= lowThreshold;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 grid md:grid-cols-2 gap-6">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mainImage} alt={product.name} className="w-full rounded-xl bg-gray-100 aspect-square object-cover" />
      </div>
      <div className="space-y-3">
        <div className="text-sm text-gray-500">{product.category?.name}</div>
        <h1 className="text-2xl font-bold">{product.name}</h1>
        <div className="text-3xl font-bold text-brand">{formatRupiah(displayPrice)}</div>
        <div className="text-sm text-gray-500">
          Stok: <span className={isLowStock ? 'text-amber-600 font-semibold' : ''}>{displayStock}</span> · Berat: {selectedVariant?.weight ?? product.weight} gr
          {selectedVariant?.sku && (
            <span className="ml-2 text-xs text-gray-400">SKU: {selectedVariant.sku}</span>
          )}
        </div>
        {isLowStock && (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1 rounded">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            Stok hampir habis — tinggal {displayStock} unit, segera order!
          </div>
        )}
        {displayStock === 0 && (
          <div className="inline-flex items-center gap-1.5 text-xs font-medium bg-red-50 border border-red-200 text-red-800 px-2 py-1 rounded">
            Stok habis. Hubungi admin via WhatsApp untuk pre-order.
          </div>
        )}
        <p className="text-gray-700 whitespace-pre-line">{product.description}</p>

        {/* ---------------- Variant picker ---------------- */}
        {variants.length > 0 && (
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Pilih varian{' '}
                {selectedVariant && (
                  <span className="text-gray-500 font-normal">: {selectedVariant.name}</span>
                )}
              </span>
              <span className="text-xs text-gray-500">{variants.length} pilihan</span>
            </div>
            <div className="flex flex-wrap gap-2">
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
                      'px-3 py-2 rounded-lg border text-sm flex items-center gap-2 transition',
                      active
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-gray-200 hover:border-gray-300',
                      out ? 'opacity-50 line-through cursor-not-allowed' : '',
                    ].join(' ')}
                    title={out ? 'Stok habis' : v.name}
                  >
                    {v.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.image} alt="" className="w-6 h-6 object-cover rounded-sm" />
                    )}
                    <span>{v.name}</span>
                    {!out && v.selling_price !== displayPrice && (
                      <span className="text-xs text-gray-500">
                        {formatRupiah(v.selling_price)}
                      </span>
                    )}
                    {out && <span className="text-xs">(habis)</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Pelanggan hanya melihat harga jual final. */}
        <div className="card p-3 text-sm text-gray-600">
          <div className="flex justify-between text-gray-900 font-medium">
            <span>Harga</span><span>{formatRupiah(displayPrice)}</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            *Ongkir dihitung di halaman checkout sesuai alamat pengiriman.
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <div className="flex items-center gap-2">
            <button className="btn-outline" onClick={() => setQty(Math.max(1, qty - 1))}>-</button>
            <span className="w-10 text-center">{qty}</span>
            <button className="btn-outline" onClick={() => setQty(Math.min(displayStock, qty + 1))}>+</button>
          </div>
          <button onClick={onAddToCart} disabled={isBuyDisabled} className="btn-outline flex-1">
            {displayStock === 0 ? 'Stok Habis' : 'Masukkan Keranjang'}
          </button>
          <button onClick={onBuyNow} disabled={isBuyDisabled} className="btn-primary flex-1">
            Beli Sekarang
          </button>
        </div>
      </div>
    </div>
  );
}
