<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\TwilioOtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Laravel\Socialite\Facades\Socialite;

class AuthController extends Controller
{
    // -------------------- Customer: register (email/password) --------------------
    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name'     => ['required', 'string', 'max:120'],
            'email'    => ['required', 'email', Rule::unique('users', 'email')],
            'phone'    => ['nullable', 'string', 'max:20', Rule::unique('users', 'phone')],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        $user = User::create([
            'name'     => $data['name'],
            'email'    => $data['email'],
            'phone'    => $data['phone'] ?? null,
            'password' => Hash::make($data['password']),
            'role'     => User::ROLE_CUSTOMER,
            'is_active' => true,
        ]);

        $token = $user->createToken('customer')->plainTextToken;

        return response()->json(['user' => $user, 'token' => $token], 201);
    }

    // -------------------- Customer: login (email/password) --------------------
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email'    => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if (! $user || ! Hash::check($data['password'], (string) $user->password)) {
            throw ValidationException::withMessages(['email' => 'Email atau password salah.']);
        }
        if (! $user->is_active) {
            throw ValidationException::withMessages(['email' => 'Akun kamu dinonaktifkan.']);
        }
        if ($user->role !== User::ROLE_CUSTOMER) {
            throw ValidationException::withMessages(['email' => 'Silakan login melalui halaman admin.']);
        }

        $token = $user->createToken('customer')->plainTextToken;

        return response()->json(['user' => $user, 'token' => $token]);
    }

    // -------------------- Admin: login (terpisah, hanya role=admin) --------------------
    public function adminLogin(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email'    => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if (! $user || ! Hash::check($data['password'], (string) $user->password)) {
            throw ValidationException::withMessages(['email' => 'Kredensial admin tidak valid.']);
        }
        if ($user->role !== User::ROLE_ADMIN || ! $user->is_active) {
            throw ValidationException::withMessages(['email' => 'Akses ditolak. Hanya admin yang diperbolehkan.']);
        }

        $token = $user->createToken('admin', ['admin'])->plainTextToken;

        return response()->json(['user' => $user, 'token' => $token]);
    }

    // -------------------- Logout --------------------
    public function logout(Request $request): JsonResponse
    {
        $request->user()?->currentAccessToken()?->delete();
        return response()->json(['message' => 'Logged out']);
    }

    // -------------------- Me --------------------
    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $request->user()]);
    }

    /**
     * Update the authenticated user's profile.
     *
     * Fields are individually optional so the same endpoint can be used to
     * "add a phone number for the first time" when the user registered via
     * email/Google, or to rename, etc. Uniqueness is enforced ignoring the
     * current user's row.
     */
    public function updateProfile(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name'  => ['sometimes', 'string', 'max:120'],
            'email' => ['sometimes', 'nullable', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            'phone' => ['sometimes', 'nullable', 'string', 'regex:/^\+?\d{8,15}$/', Rule::unique('users', 'phone')->ignore($user->id)],
        ]);

        if (array_key_exists('phone', $data) && $data['phone']) {
            $data['phone'] = $this->normalizePhone($data['phone']);
            // Re-check uniqueness after normalization (e.g. "08..." vs "+628...").
            $clash = User::where('phone', $data['phone'])->where('id', '!=', $user->id)->exists();
            if ($clash) {
                throw ValidationException::withMessages(['phone' => 'Nomor HP sudah digunakan.']);
            }
        }

        $user->fill($data)->save();

        return response()->json(['user' => $user->fresh()]);
    }

    // -------------------- Phone OTP: request --------------------
    public function requestOtp(Request $request, TwilioOtpService $otp): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'regex:/^\+?\d{8,15}$/'],
        ]);
        $phone = $this->normalizePhone($data['phone']);
        $otp->send($phone);
        return response()->json(['message' => 'OTP dikirim via WhatsApp.', 'phone' => $phone]);
    }

    // -------------------- Phone OTP: verify & login/register --------------------
    public function verifyOtp(Request $request, TwilioOtpService $otp): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string'],
            'code'  => ['required', 'digits:6'],
            'name'  => ['nullable', 'string', 'max:120'],
        ]);
        $phone = $this->normalizePhone($data['phone']);

        if (! $otp->verify($phone, $data['code'])) {
            throw ValidationException::withMessages(['code' => 'Kode OTP tidak valid / sudah kadaluarsa.']);
        }

        $user = User::firstOrCreate(
            ['phone' => $phone],
            [
                'name'              => $data['name'] ?? ('User '.substr($phone, -4)),
                'role'              => User::ROLE_CUSTOMER,
                'is_active'         => true,
                'phone_verified_at' => now(),
            ]
        );
        if (! $user->phone_verified_at) {
            $user->update(['phone_verified_at' => now()]);
        }
        if (! $user->is_active) {
            throw ValidationException::withMessages(['phone' => 'Akun dinonaktifkan.']);
        }

        $token = $user->createToken('customer')->plainTextToken;
        return response()->json(['user' => $user, 'token' => $token]);
    }

    // -------------------- Google OAuth (Socialite) --------------------
    public function googleRedirect()
    {
        return Socialite::driver('google')->stateless()->redirect();
    }

    public function googleCallback(Request $request): JsonResponse
    {
        try {
            $g = Socialite::driver('google')->stateless()->user();
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Google login gagal: '.$e->getMessage()], 400);
        }

        $user = User::where('google_id', $g->getId())
            ->orWhere('email', $g->getEmail())
            ->first();

        if (! $user) {
            $user = User::create([
                'name'              => $g->getName() ?: 'Google User',
                'email'             => $g->getEmail(),
                'google_id'         => $g->getId(),
                'avatar'            => $g->getAvatar(),
                'role'              => User::ROLE_CUSTOMER,
                'is_active'         => true,
                'email_verified_at' => now(),
            ]);
        } else {
            $user->update([
                'google_id' => $g->getId(),
                'avatar'    => $user->avatar ?: $g->getAvatar(),
            ]);
        }

        $token = $user->createToken('customer')->plainTextToken;

        // Redirect back to frontend with the token in the hash fragment
        $frontend = rtrim(env('FRONTEND_URL', 'http://localhost:3000'), '/');
        $redirect = "{$frontend}/login/callback#token={$token}";

        if ($request->expectsJson()) {
            return response()->json(['user' => $user, 'token' => $token, 'redirect' => $redirect]);
        }
        return redirect()->away($redirect);
    }

    protected function normalizePhone(string $phone): string
    {
        $p = preg_replace('/[^0-9+]/', '', $phone);
        // "08xxxx" → "+628xxxx"
        if (str_starts_with($p, '0')) {
            $p = '+62'.substr($p, 1);
        } elseif (str_starts_with($p, '62')) {
            $p = '+'.$p;
        } elseif (! str_starts_with($p, '+')) {
            $p = '+'.$p;
        }
        return $p;
    }
}
