import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { AuthApi } from '../api/endpoints';
import { useAuthStore } from '../store/authStore';
import { ApiError, consumeSessionExpired } from '../api/client';
import { Button } from '../components/ui/Button';
import { PasswordInput } from '../components/ui/PasswordInput';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { Aurora, TiltCard } from '../components/ui/Aurora';
const APP_NAME = import.meta.env.VITE_APP_NAME || 'EventRide Ops';
export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore(s => s.setSession);
  const navigate = useNavigate();
  // Read once on mount and clear, so the notice doesn't reappear on re-render
  // or linger after a failed sign-in attempt.
  const [sessionExpired] = useState(consumeSessionExpired);
  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await AuthApi.login(identifier.trim(), password);
      if (res.role !== 'admin' && res.role !== 'driver') {
        throw new ApiError(403, 'FORBIDDEN', 'This portal is for admin and driver accounts only.');
      }
      setSession(res);
      navigate(res.role === 'driver' ? '/driver' : '/', {
        replace: true
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }
  return <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4">
      <Aurora />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ops-600 text-white shadow-lg shadow-ops-600/40 ring-1 ring-white/25">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-xl font-bold text-ink">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted">Admin &amp; driver sign in</p>
        </div>

        {sessionExpired && <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800" role="status">
            <Clock size={14} className="mt-px shrink-0" />
            <span>Your session expired for security. Sign in again to pick up where you left off.</span>
          </div>}

        <TiltCard className="rounded-2xl">
          <form onSubmit={onSubmit} className="er-glass space-y-4 rounded-2xl p-6">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="identifier">
                Email or phone
              </label>
              <input id="identifier" type="text" autoComplete="username" required value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="admin@sahyadri.events or driver phone" className="input" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted" htmlFor="password">
                Password
              </label>
              <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">
                {error}
              </p>}

            <Button type="submit" size="lg" className="w-full" loading={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              Sign in
            </Button>

            <div className="flex gap-2">
              <button type="button" onClick={async () => {
              setIdentifier('admin@sahyadri.events');
              setPassword('Admin@1234');
              setError(null);
              setLoading(true);
              try {
                const res = await AuthApi.login('admin@sahyadri.events', 'Admin@1234');
                if (res.role !== 'admin' && res.role !== 'driver') {
                  throw new ApiError(403, 'FORBIDDEN', 'This portal is for admin and driver accounts only.');
                }
                setSession(res);
                navigate(res.role === 'driver' ? '/driver' : '/', {
                  replace: true
                });
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
                setLoading(false);
              }
            }} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ops-100 px-3 py-1.5 text-xs font-medium text-ops-700">
                <Sparkles className="h-3.5 w-3.5" />
                Demo Admin
              </button>
              <button type="button" onClick={async () => {
              setIdentifier('9876543000');
              setPassword('Driver@1234');
              setError(null);
              setLoading(true);
              try {
                const res = await AuthApi.login('9876543000', 'Driver@1234');
                if (res.role !== 'admin' && res.role !== 'driver') {
                  throw new ApiError(403, 'FORBIDDEN', 'This portal is for admin and driver accounts only.');
                }
                setSession(res);
                navigate(res.role === 'driver' ? '/driver' : '/', {
                  replace: true
                });
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
                setLoading(false);
              }
            }} className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-700">
                <Sparkles className="h-3.5 w-3.5" />
                Demo Driver
              </button>
            </div>
          </form>
        </TiltCard>

        <p className="mt-4 text-center text-[11px] text-faint">
          Demo — admin: admin@sahyadri.events / Admin@1234 · drivers: seeded phone / Driver@1234
        </p>

        {/* The toggle also lives in the shell, but a user who prefers dark
            shouldn't have to sign in through a bright screen first. */}
        <div className="mt-5 flex justify-center">
          <ThemeToggle />
        </div>
      </div>
    </div>;
}
