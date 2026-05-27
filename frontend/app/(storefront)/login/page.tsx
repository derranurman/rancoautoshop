'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/lib/stores';

type Mode = 'email' | 'phone';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>('email');

  // Email/password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Phone / OTP
  const [phone, setPhone] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');

  async function onEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      login(res.data.token, res.data.user);
      toast.success('Selamat datang kembali');
      router.push('/');
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }

  async function onRequestOtp() {
    if (!phone) return;
    setLoading(true);
    try {
      await api.post('/auth/otp/request', { phone });
      toast.success('Kode OTP dikirim via WhatsApp. Cek log Laravel jika pakai dev mode.');
      setOtpRequested(true);
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }

  async function onVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/otp/verify', { phone, code: otp, name: name || undefined });
      login(res.data.token, res.data.user);
      toast.success('Berhasil masuk');
      router.push('/');
    } catch (e) { toast.error(apiError(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-4">Masuk</h1>

      <div className="card p-5 space-y-4">
        <div className="flex gap-2">
          <button onClick={() => setMode('email')} className={`btn flex-1 ${mode === 'email' ? 'bg-ink text-white' : 'bg-gray-100'}`}>Email</button>
          <button onClick={() => setMode('phone')} className={`btn flex-1 ${mode === 'phone' ? 'bg-ink text-white' : 'bg-gray-100'}`}>No. HP (OTP WA)</button>
        </div>

        {mode === 'email' ? (
          <form onSubmit={onEmailLogin} className="space-y-3">
            <div><label className="label">Email</label>
              <input type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div><label className="label">Password</label>
              <input type="password" className="input" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <button disabled={loading} className="btn-primary w-full">{loading ? 'Memproses...' : 'Masuk'}</button>
          </form>
        ) : (
          <div className="space-y-3">
            <div><label className="label">No. HP (WhatsApp)</label>
              <input className="input" placeholder="08xxxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            {otpRequested && (
              <>
                <div><label className="label">Nama (untuk akun baru)</label>
                  <input className="input" placeholder="opsional" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div><label className="label">Kode OTP</label>
                  <input className="input tracking-[0.5em] text-center" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} />
                </div>
              </>
            )}
            {!otpRequested ? (
              <button onClick={onRequestOtp} disabled={loading || !phone} className="btn-primary w-full">
                {loading ? 'Mengirim...' : 'Kirim OTP'}
              </button>
            ) : (
              <form onSubmit={onVerifyOtp}>
                <button disabled={loading || otp.length !== 6} className="btn-primary w-full">
                  {loading ? 'Memverifikasi...' : 'Masuk'}
                </button>
              </form>
            )}
          </div>
        )}

        <div className="text-sm text-gray-600 text-center">
          Belum punya akun? <Link href="/register" className="text-brand font-medium">Daftar</Link>
        </div>
      </div>
    </div>
  );
}
