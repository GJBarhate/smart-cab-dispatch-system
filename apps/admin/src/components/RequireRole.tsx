import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import type { AuthRole } from '../store/authStore';

// A driver hitting an admin route (or vice versa) is redirected straight to
// their home screen — it never mounts the other role's components even
// briefly (plan.md §12.1). The server independently enforces the same rule
// on every API call; this is UX polish, not the security boundary.
export function RequireRole({ role }: { role: AuthRole }) {
  const currentRole = useAuthStore((s) => s.role);

  if (currentRole !== role) {
    return <Navigate to={currentRole === 'driver' ? '/driver' : '/'} replace />;
  }
  return <Outlet />;
}
