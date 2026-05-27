<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

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

    /** Admin menambah akun pelanggan baru langsung dari panel. */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'     => ['required', 'string', 'max:120'],
            'email'    => ['nullable', 'email', Rule::unique('users', 'email')],
            'phone'    => ['nullable', 'string', 'max:20', Rule::unique('users', 'phone')],
            'password' => ['required', 'string', 'min:3'],
            'is_active'=> ['sometimes', 'boolean'],
        ]);

        if (empty($data['email']) && empty($data['phone'])) {
            throw ValidationException::withMessages([
                'email' => 'Email atau nomor HP minimal salah satu wajib diisi.',
            ]);
        }

        $user = User::create([
            'name'      => $data['name'],
            'email'     => $data['email'] ?? null,
            'phone'     => $data['phone'] ?? null,
            'password'  => Hash::make($data['password']),
            'role'      => User::ROLE_CUSTOMER,
            'is_active' => $data['is_active'] ?? true,
        ]);

        return response()->json(['data' => $user], 201);
    }

    /** Edit data pelanggan; password opsional (kosongkan = tidak diubah). */
    public function update(Request $request, User $user): JsonResponse
    {
        abort_unless($user->role === User::ROLE_CUSTOMER, 403, 'Hanya pelanggan yang bisa diedit di sini.');

        $data = $request->validate([
            'name'     => ['sometimes', 'string', 'max:120'],
            'email'    => ['sometimes', 'nullable', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            'phone'    => ['sometimes', 'nullable', 'string', 'max:20', Rule::unique('users', 'phone')->ignore($user->id)],
            'password' => ['sometimes', 'nullable', 'string', 'min:3'],
            'is_active'=> ['sometimes', 'boolean'],
        ]);

        if (! empty($data['password'])) {
            $user->password = Hash::make($data['password']);
        }
        unset($data['password']);

        $user->fill($data)->save();

        return response()->json(['data' => $user->fresh()]);
    }

    /**
     * Hapus pelanggan. Kalau pelanggan masih punya riwayat pesanan kita
     * tolak hard-delete supaya laporan penjualan tidak rusak — admin masih
     * bisa men-suspend akun lewat tombol terpisah.
     */
    public function destroy(User $user): JsonResponse
    {
        abort_unless($user->role === User::ROLE_CUSTOMER, 403, 'Hanya pelanggan yang bisa dihapus di sini.');

        if ($user->orders()->exists()) {
            throw ValidationException::withMessages([
                'user' => 'Pelanggan ini memiliki riwayat pesanan. Suspend saja, tidak bisa dihapus permanen.',
            ]);
        }

        $user->tokens()->delete();
        $user->addresses()->delete();
        $user->cart()?->delete();
        $user->delete();

        return response()->json(['message' => 'Pelanggan dihapus.']);
    }

    public function toggleSuspend(User $user): JsonResponse
    {
        $user->update(['is_active' => ! $user->is_active]);
        return response()->json(['data' => $user]);
    }
}
