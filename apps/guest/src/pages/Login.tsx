import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Sparkles } from 'lucide-react';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';

const APP_NAME = import.meta.env.VITE_APP_NAME || 'EventRide';

export default function Login(): JSX.Element {
  const [bookingRef, setBookingRef] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const canSubmit = bookingRef.trim().length > 0 && phone.trim().length >= 6 && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.guestLogin(bookingRef.trim().toUpperCase(), phone.trim());
      setAuth(res.token, res.name);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col justify-center bg-brand-50 px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg">
            <Car className="h-9 w-9" />
          </div>
          <h1 className="text-2xl font-bold text-brand-900">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in with your booking details</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="bookingRef" className="mb-1 block text-sm font-medium text-gray-700">
              Booking reference
            </label>
            <input
              id="bookingRef"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              placeholder="EVT-1001"
              value={bookingRef}
              onChange={(e) => setBookingRef(e.target.value.toUpperCase())}
              className="min-h-[52px] w-full rounded-xl border border-gray-300 bg-white px-4 text-lg font-semibold uppercase tracking-wide text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>

          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
              Phone number
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="7000010000"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
              className="min-h-[52px] w-full rounded-xl border border-gray-300 bg-white px-4 text-lg text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <Button type="submit" fullWidth loading={loading} disabled={!canSubmit}>
            Sign in
          </Button>

          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={() => {
                setBookingRef('EVT-1001');
                setPhone('7000010000');
              }}
              className="mx-auto flex min-h-[36px] items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Use demo credentials
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          Your booking reference and phone are on your event confirmation. No password needed.
        </p>
      </div>
    </div>
  );
}
