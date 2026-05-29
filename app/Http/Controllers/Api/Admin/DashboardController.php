<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function summary(): JsonResponse
    {
        $today = now()->startOfDay();
        $startMonth = now()->startOfMonth();
        $globalThreshold = (int) (SiteSetting::current()->low_stock_threshold ?? 5);

        // Stok rendah: per produk, pakai threshold lokal kalau ada, kalau tidak
        // pakai global. Stok 0 ikut dihitung sebagai low-stock supaya admin
        // langsung lihat dari dashboard berapa SKU yang perlu re-stock.
        $lowStockCount = (int) Product::query()
            ->where('is_active', true)
            ->where(function ($outer) use ($globalThreshold) {
                $outer->where(function ($q) {
                    $q->whereNotNull('low_stock_threshold')
                      ->whereColumn('stock', '<=', 'low_stock_threshold');
                })->orWhere(function ($q) use ($globalThreshold) {
                    $q->whereNull('low_stock_threshold')
                      ->where('stock', '<=', $globalThreshold);
                });
            })
            ->count();
        $outOfStockCount = (int) Product::where('is_active', true)->where('stock', '<=', 0)->count();

        return response()->json([
            'totals' => [
                'products'  => Product::count(),
                'customers' => User::where('role', User::ROLE_CUSTOMER)->count(),
                'orders'    => Order::count(),
                'revenue'   => (int) Order::whereIn('status', [
                    Order::STATUS_PAID, Order::STATUS_PACKED, Order::STATUS_SHIPPED, Order::STATUS_DELIVERED,
                ])->sum('total'),
            ],
            'today' => [
                'orders'  => Order::where('created_at', '>=', $today)->count(),
                'revenue' => (int) Order::where('paid_at', '>=', $today)->sum('total'),
            ],
            'this_month' => [
                'orders'  => Order::where('created_at', '>=', $startMonth)->count(),
                'revenue' => (int) Order::where('paid_at', '>=', $startMonth)->sum('total'),
            ],
            'orders_by_status' => Order::select('status', DB::raw('count(*) as count'))
                ->groupBy('status')->pluck('count', 'status'),
            'inventory' => [
                'low_stock_count'    => $lowStockCount,
                'out_of_stock_count' => $outOfStockCount,
                'global_threshold'   => $globalThreshold,
            ],
        ]);
    }

    /** Laporan penjualan per item: filter rentang tanggal dari–sampai. */
    public function salesReport(Request $request): JsonResponse
    {
        $data = $request->validate([
            'from' => ['nullable', 'date'],
            'to'   => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        // Default: 30 hari terakhir bila admin tidak mengisi filter.
        $from = ! empty($data['from'])
            ? \Illuminate\Support\Carbon::parse($data['from'])->startOfDay()
            : now()->subDays(29)->startOfDay();
        $to = ! empty($data['to'])
            ? \Illuminate\Support\Carbon::parse($data['to'])->endOfDay()
            : now()->endOfDay();

        $rows = DB::table('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->leftJoin('users', 'users.id', '=', 'orders.user_id')
            ->whereNotNull('orders.paid_at')
            ->whereIn('orders.status', [
                Order::STATUS_PAID, Order::STATUS_PACKED,
                Order::STATUS_SHIPPED, Order::STATUS_DELIVERED,
            ])
            ->whereBetween('orders.paid_at', [$from, $to])
            ->orderBy('orders.paid_at', 'desc')
            ->orderBy('order_items.id', 'desc')
            ->get([
                'orders.paid_at as paid_at',
                'orders.order_number as order_number',
                'order_items.product_name as product_name',
                'order_items.quantity as quantity',
                'order_items.price_snapshot as price_snapshot',
                'order_items.operational_cost_snapshot as operational_cost_snapshot',
                'order_items.subtotal as subtotal',
                'orders.recipient_name as recipient_name',
                'orders.recipient_phone as recipient_phone',
                'users.name as user_name',
                'users.phone as user_phone',
            ])
            ->map(function ($r) {
                $unit = (int) $r->price_snapshot + (int) $r->operational_cost_snapshot;
                return [
                    'date'           => $r->paid_at,
                    'order_number'   => $r->order_number,
                    'product_name'   => $r->product_name,
                    'quantity'       => (int) $r->quantity,
                    'unit_price'     => $unit,
                    'selling_price'  => (int) $r->subtotal, // harga jual per baris (qty × harga jual unit)
                    'buyer_name'     => $r->recipient_name ?: $r->user_name,
                    'buyer_phone'    => $r->recipient_phone ?: $r->user_phone,
                ];
            });

        return response()->json([
            'data' => $rows,
            'meta' => [
                'from'           => $from->toDateString(),
                'to'             => $to->toDateString(),
                'total_orders'   => $rows->pluck('order_number')->unique()->count(),
                'total_revenue'  => (int) $rows->sum('selling_price'),
                'total_quantity' => (int) $rows->sum('quantity'),
            ],
        ]);
    }
}
