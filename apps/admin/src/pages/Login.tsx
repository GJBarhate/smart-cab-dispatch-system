import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { AuthApi } from '../api/endpoints';
import { useAuthStore } from '../store/authStore';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';

const APP_NAME = (import.meta.env.VITE_APP_NAME as string) || 'EventRide Ops';

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await AuthApi.login(identifier.trim(), password);
      if (res.role !== 'admin' && res.role !== 'driver') {
        throw new ApiError(403, 'FORBIDDEN', 'This portal is for admin and driver accounts only.');
      }
      setSession(res);
      navigate(res.role === 'driver' ? '/driver' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ops-50 via-white to-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ops-600 text-white shadow-lg shadow-ops-200">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-gray-500">Admin &amp; driver sign in</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="identifier">
              Email or phone
            </label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="admin@sahyadri.events or driver phone"
              className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm focus:border-ops-500 focus:outline-none focus:ring-1 focus:ring-ops-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm focus:border-ops-500 focus:outline-none focus:ring-1 focus:ring-ops-500"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] text-gray-400">
          Demo — admin: admin@sahyadri.events / Admin@1234 · drivers: seeded phone / Driver@1234
        </p>
      </div>
    </div>
  );
}
