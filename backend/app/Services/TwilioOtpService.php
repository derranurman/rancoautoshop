<?php

namespace App\Services;

use App\Models\OtpCode;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * WhatsApp OTP delivered via Twilio.
 *
 * In local dev when Twilio creds are missing, logs the OTP so you can test
 * the flow without sending real messages.
 */
class TwilioOtpService
{
    protected ?string $sid;
    protected ?string $token;
    protected ?string $from;

    public function __construct()
    {
        $this->sid   = config('services.twilio.sid');
        $this->token = config('services.twilio.token');
        $this->from  = config('services.twilio.whatsapp_from');
    }

    public function enabled(): bool
    {
        return $this->sid && $this->token && $this->from;
    }

    /** Generate & send a fresh OTP. Returns the OTP row. */
    public function send(string $phone): OtpCode
    {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        // Invalidate older unused OTPs for this phone
        OtpCode::where('phone', $phone)->whereNull('consumed_at')->update(['consumed_at' => now()]);

        $otp = OtpCode::create([
            'phone'      => $phone,
            'code_hash'  => Hash::make($code),
            'expires_at' => now()->addMinutes(5),
            'attempts'   => 0,
        ]);

        $body = "Ranco Autoshop: kode OTP kamu adalah {$code}. Berlaku 5 menit. JANGAN bagikan ke siapa pun.";

        if (! $this->enabled()) {
            Log::info("[DEV OTP] phone={$phone} code={$code}");
            return $otp;
        }

        try {
            Http::withBasicAuth($this->sid, $this->token)
                ->asForm()
                ->post("https://api.twilio.com/2010-04-01/Accounts/{$this->sid}/Messages.json", [
                    'From' => $this->from,
                    'To'   => "whatsapp:{$phone}",
                    'Body' => $body,
                ])->throw();
        } catch (\Throwable $e) {
            Log::error('Twilio send failed: '.$e->getMessage());
        }

        return $otp;
    }

    /** Verify OTP for phone. Returns true if valid & unused. */
    public function verify(string $phone, string $code): bool
    {
        $otp = OtpCode::where('phone', $phone)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->latest('id')
            ->first();

        if (! $otp) return false;

        $otp->increment('attempts');
        if ($otp->attempts > 6) {
            $otp->update(['consumed_at' => now()]);
            return false;
        }

        if (! Hash::check($code, $otp->code_hash)) {
            return false;
        }

        $otp->update(['consumed_at' => now()]);
        return true;
    }
}
