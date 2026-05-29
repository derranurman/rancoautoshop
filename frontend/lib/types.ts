export type Role = 'admin' | 'customer';

export interface User {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  avatar?: string | null;
  is_active?: boolean;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  /** Default biaya operasional sebagai persen dari harga produk (admin-only). */
  operational_cost_percent?: number | string | null;
  /** Hitungan jumlah produk di kategori ini (admin endpoint). */
  products_count?: number;
}

export interface Address {
  id: number;
  user_id: number;
  label: string | null;
  recipient_name: string;
  phone: string;
  province: string;
  city: string;
  city_id: string | null;
  postal_code: string | null;
  address_line: string;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProductVariant {
  id: number;
  name: string;                    // contoh: "Merah", "Biru", "Hitam"
  sku: string | null;
  stock: number;
  /** Harga dasar override (null = ikut produk induk). */
  price_override: number | null;
  /** Harga dasar efektif (override jika ada, kalau tidak fallback produk). */
  effective_price: number;
  /** Harga jual akhir = effective_price + operational_cost produk. */
  selling_price: number;
  /** Berat efektif gram (override / fallback). */
  weight: number;
  image: string | null;
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  price: number;
  operational_cost: number;
  selling_price: number;
  stock: number;
  /** Threshold "stok hampir habis" (per produk). null = pakai default global. */
  low_stock_threshold?: number | null;
  weight: number;
  images: string[];
  description?: string;
  category?: { id: number; name: string; slug: string } | null;
  /** True kalau produk punya minimal satu varian aktif. */
  has_variants?: boolean;
  variants?: ProductVariant[];
}

/** Hasil ringkas dari /products/suggest untuk autocomplete Navbar. */
export interface ProductSuggestion {
  id: number;
  slug: string;
  name: string;
  selling_price: number;
  image: string | null;
  category: string | null;
  in_stock: boolean;
}

export interface CartItem {
  id: number;
  product_id: number;
  variant_id: number | null;
  name: string;
  slug: string;
  image: string | null;
  price: number;
  operational_cost: number;
  selling_price: number;
  quantity: number;
  subtotal: number;
  stock: number;
  weight: number;
  variant_name: string | null;
  variant_sku: string | null;
}

export interface Cart {
  id: number;
  items: CartItem[];
  total_items: number;
  subtotal: number;
  total_weight: number;
}

export type OrderStatus =
  | 'pending'
  | 'awaiting_verification'
  | 'paid' | 'packed' | 'shipped' | 'delivered' | 'cancelled';

export type PaymentMethod = 'midtrans' | 'manual_transfer' | 'cod';

export interface OrderItem {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  product_name: string;
  variant_name: string | null;
  variant_sku: string | null;
  price_snapshot: number;
  operational_cost_snapshot: number;
  quantity: number;
  subtotal: number;
}

export interface OrderTrackingEvent {
  /** id is null for synthesized fallback rows for legacy orders. */
  id: number | null;
  status: OrderStatus | null;
  label: string;
  note: string | null;
  location: string | null;
  source: 'admin' | 'system' | 'webhook' | 'customer';
  created_at: string;
}

export interface Order {
  id: number;
  order_number: string;
  status: OrderStatus;
  subtotal: number;
  operational_cost: number;
  shipping_cost: number;
  discount: number;
  total: number;
  voucher_code?: string | null;
  courier?: string | null;
  courier_service?: string | null;
  tracking_number?: string | null;
  recipient_name: string;
  recipient_phone: string;
  shipping_address: string;
  midtrans_snap_token?: string | null;
  paid_at?: string | null;
  /** Metode pembayaran yang dipilih pembeli saat checkout. */
  payment_method?: PaymentMethod;
  /** URL bukti transfer manual yang sudah diunggah customer (`/storage/...`). */
  payment_proof_url?: string | null;
  payment_proof_uploaded_at?: string | null;
  payment_verified_at?: string | null;
  payment_rejection_reason?: string | null;

  /** Provider pengiriman: rajaongkir/biteship/manual. */
  shipping_provider?: 'rajaongkir' | 'biteship' | 'manual';
  /** ID order di Biteship — dipakai admin untuk refresh tracking & cancel. */
  biteship_order_id?: string | null;
  /** Kode kurir Biteship (kadang beda dari `courier`, mis. "jt" vs "jnt"). */
  biteship_courier_code?: string | null;
  biteship_courier_service_code?: string | null;
  biteship_status?: string | null;
  created_at: string;
  items?: OrderItem[];
  tracking_events?: OrderTrackingEvent[];
  /** Always-present timeline (server-side synthesizes when no rows exist). */
  timeline?: OrderTrackingEvent[];
}

/**
 * Konfigurasi tampilan storefront (diatur dari menu admin "Tampilan").
 * Dipakai oleh Navbar, hero, footer, dan widget WhatsApp.
 */
export interface SiteSettings {
  app_name: string;
  logo_url: string | null;
  favicon_url: string | null;
  hero_title: string;
  hero_subtitle: string;
  hero_search_placeholder: string;
  hero_gradient_from: string | null;
  hero_gradient_to: string | null;
  footer_text: string | null;
  whatsapp_enabled: boolean;
  whatsapp_number: string | null;       // versi normalized (62...) untuk wa.me
  whatsapp_label: string;
  whatsapp_greeting: string;
  whatsapp_prefilled_text: string;
  whatsapp_link: string | null;         // siap-pakai href ke wa.me

  /** Pembayaran transfer manual — info rekening yang ditampilkan ke customer. */
  manual_transfer_enabled: boolean;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  bank_branch: string | null;
  bank_extra_note: string | null;

  /** COD (Cash on Delivery) — toggle + parameter nominal. */
  cod_enabled: boolean;
  cod_min_total: number;
  cod_max_total: number | null;
  cod_extra_fee: number;
  cod_extra_note: string | null;

  /** Threshold global "stok hampir habis" untuk indikator di storefront. */
  low_stock_threshold: number;

  /** Apakah Biteship sudah diaktifkan admin (paralel dengan RajaOngkir). */
  biteship_enabled: boolean;
  /** Provider default yang dipilih duluan di checkout. */
  default_shipping_provider: 'rajaongkir' | 'biteship' | 'manual';
}

/**
 * Info rekening tujuan transfer manual yang ditemani oleh response
 * `GET /orders/{orderNumber}` (kalau order tersebut pakai metode `manual_transfer`).
 * Bisa juga muncul di response `POST /orders/checkout` saat pembeli baru
 * memilih transfer manual.
 */
export interface BankAccountInfo {
  enabled: boolean;
  bank_name: string | null;
  account_number: string | null;
  account_holder: string | null;
  branch: string | null;
  note: string | null;
}
export interface SiteSettingsAdmin extends Omit<SiteSettings, 'whatsapp_number' | 'whatsapp_link'> {
  whatsapp_number: string | null;            // input mentah admin
  whatsapp_number_normalized: string | null; // hasil normalisasi (read-only preview)
  whatsapp_link: string | null;

  /** Sender info — admin only, untuk label pengiriman PDF. */
  sender_name: string | null;
  sender_phone: string | null;
  sender_address: string | null;
  sender_city: string | null;
  sender_postal_code: string | null;
}
