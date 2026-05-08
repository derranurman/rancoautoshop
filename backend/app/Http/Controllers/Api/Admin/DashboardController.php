<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function summary(): JsonResponse
    {
        $today = now()->startOfDay();
        $startMonth = now()->startOfMonth();

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
        ]);
    }

    /** Laporan penjualan harian 30 hari terakhir. */
    public function salesReport(): JsonResponse
    {
        $from = now()->subDays(29)->startOfDay();
        $rows = Order::selectRaw("DATE(paid_at) as date, COUNT(*) as orders, SUM(total) as revenue")
            ->whereNotNull('paid_at')
            ->where('paid_at', '>=', $from)
            ->groupBy('date')->orderBy('date')
            ->get();

        return response()->json(['data' => $rows]);
    }
}
