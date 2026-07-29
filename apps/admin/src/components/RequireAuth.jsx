import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

// Client-side gating is UX only — the server enforces auth/role independently
// on every route (plan.md §12.1). Never treat this as a security boundary.
export function RequireAuth() {
  const token = useAuthStore(s => s.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" state={{
      from: location
    }} replace />;
  }
  return <Outlet />;
}
