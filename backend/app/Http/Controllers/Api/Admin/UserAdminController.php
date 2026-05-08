<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserAdminController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = User::query()->where('role', User::ROLE_CUSTOMER);
        if ($s = $request->string('search')->trim()->value()) {
            $q->where(fn ($qq) => $qq->where('name', 'like', "%{$s}%")
                ->orWhere('email', 'like', "%{$s}%")
                ->orWhere('phone', 'like', "%{$s}%"));
        }
        return response()->json($q->latest()->paginate($request->integer('per_page', 20)));
    }

    public function show(User $user): JsonResponse
    {
        $stats = [
            'orders'  => $user->orders()->count(),
            'spent'   => (int) $user->orders()
                ->whereIn('status', [Order::STATUS_PAID, Order::STATUS_PACKED, Order::STATUS_SHIPPED, Order::STATUS_DELIVERED])
                ->sum('total'),
            'recent_orders' => $user->orders()->latest()->limit(10)->get(),
        ];
        return response()->json(['data' => $user, 'stats' => $stats]);
    }

    public function toggleSuspend(User $user): JsonResponse
    {
        $user->update(['is_active' => ! $user->is_active]);
        return response()->json(['data' => $user]);
    }
}
