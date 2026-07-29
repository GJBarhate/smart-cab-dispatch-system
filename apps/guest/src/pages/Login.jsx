import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Car, Clock, Sparkles } from 'lucide-react';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';
import { ApiError, consumeSessionExpired } from '../api/client';
import { Button } from '../components/ui/Button';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { Aurora, TiltCard } from '../components/ui/Aurora';
const APP_NAME = import.meta.env.VITE_APP_NAME || 'EventRide';
export default function Login() {
  const [bookingRef, setBookingRef] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore(s => s.setAuth);
  const navigate = useNavigate();
  // Read once on mount and clear, so it shows exactly one time.
  const [sessionExpired] = useState(consumeSessionExpired);
  const canSubmit = bookingRef.trim().length > 0 && phone.trim().length >= 6 && !loading;
  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.guestLogin(bookingRef.trim().toUpperCase(), phone.trim());
      setAuth(res.token, res.name);
      navigate('/', {
        replace: true
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  }
  return <div className="relative flex h-full flex-col justify-center overflow-hidden bg-canvas px-6 py-10">
      <Aurora />

      <div className="relative mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/40 ring-1 ring-white/25">
            <Car className="h-9 w-9" />
          </div>
          {/* text-ink, not text-brand-900: the -900 step stays near-navy in
              dark mode and would sit almost invisibly on the dark canvas. */}
          <h1 className="text-2xl font-bold text-ink">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted">Sign in with your booking details</p>
        </div>

        {sessionExpired && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800" role="status">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>You were signed out to keep your booking secure. Sign in again to see your ride.</span>
          </div>}

        <TiltCard className="rounded-2xl">
          <form onSubmit={handleSubmit} className="er-glass space-y-4 rounded-2xl p-5">
            <div>
              <label htmlFor="bookingRef" className="mb-1 block text-sm font-medium text-muted">
                Booking reference
              </label>
              <input id="bookingRef" autoCapitalize="characters" autoComplete="off" autoCorrect="off" placeholder="EVT-1001" value={bookingRef} onChange={e => setBookingRef(e.target.value.toUpperCase())} className="min-h-[52px] w-full rounded-xl border border-line bg-surface/80 px-4 text-lg font-semibold uppercase tracking-wide text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </div>

            <div>
              <label htmlFor="phone" className="mb-1 block text-sm font-medium text-muted">
                Phone number
              </label>
              <input id="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="7000010000" value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d+]/g, ''))} className="min-h-[52px] w-full rounded-xl border border-line bg-surface/80 px-4 text-lg text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </div>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

            <Button type="submit" fullWidth loading={loading} disabled={!canSubmit}>
              Sign in
            </Button>

            <button type="button" onClick={async () => {
            setBookingRef('EVT-1001');
            setPhone('7000010000');
            setError(null);
            setLoading(true);
            try {
              const res = await authApi.guestLogin('EVT-1001', '7000010000');
              setAuth(res.token, res.name);
              navigate('/', {
                replace: true
              });
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
              setLoading(false);
            }
          }} className="mx-auto flex min-h-[36px] items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700">
              <Sparkles className="h-3.5 w-3.5" />
              Use demo credentials
            </button>
          </form>
        </TiltCard>

        <p className="mt-6 text-center text-xs text-faint">
          Your booking reference and phone are on your event confirmation. No password needed.
        </p>

        {/* Appearance is otherwise only reachable from Profile, which is behind
            the login — so a guest who prefers dark needs it here too. */}
        <div className="mt-5 flex justify-center">
          <ThemeToggle />
        </div>
      </div>
    </div>;
}
