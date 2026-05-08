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
}

export interface Product {
  id: number;
  slug: string;
  name: string;
  price: number;
  operational_cost: number;
  selling_price: number;
  stock: number;
  weight: number;
  images: string[];
  description?: string;
  category?: { id: number; name: string; slug: string } | null;
}

export interface CartItem {
  id: number;
  product_id: number;
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
}

export interface Cart {
  id: number;
  items: CartItem[];
  total_items: number;
  subtotal: number;
  total_weight: number;
}

export type OrderStatus =
  | 'pending' | 'paid' | 'packed' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderItem {
  id: number;
  product_id: number | null;
  product_name: string;
  price_snapshot: number;
  operational_cost_snapshot: number;
  quantity: number;
  subtotal: number;
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
  created_at: string;
  items?: OrderItem[];
}
