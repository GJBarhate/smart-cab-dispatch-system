import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, LogOut, MapPinned, Phone, User } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { CardSkeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { InstallPrompt } from '../components/InstallPrompt';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { useGuestMe } from '../hooks/useGuestQueries';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';

function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  async function request() {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  return { permission, request };
}

export default function Profile(): JSX.Element {
  const { data: guest, isLoading, error, refetch } = useGuestMe();
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const { permission, request } = useNotificationPermission();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } catch {
      // best-effort — clear local state regardless
    }
    logout();
    navigate('/login', { replace: true });
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <CardSkeleton />
      </div>
    );
  }

  if (error || !guest) {
    return (
      <div className="p-4">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 pb-6">
      <h1 className="text-xl font-bold text-ink">Profile</h1>

      <InstallPrompt />

      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
            <User className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold text-ink">{guest.name}</p>
            <p className="text-sm text-muted">{guest.bookingRef}</p>
          </div>
          {guest.isVip && <Badge tone="warning">VIP</Badge>}
        </div>

        <div className="mt-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <Phone className="h-4 w-4" /> {guest.phone}
          </div>
          {guest.accommodationId && (
            <div className="flex items-center gap-2 text-muted">
              <MapPinned className="h-4 w-4" /> {guest.accommodationId.name}
            </div>
          )}
          {guest.groupSize > 1 && <p className="text-muted">Group of {guest.groupSize}</p>}
          {guest.specialNeeds && <p className="text-muted">Special needs: {guest.specialNeeds}</p>}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {permission === 'granted' ? <Bell className="h-5 w-5 text-brand-600" /> : <BellOff className="h-5 w-5 text-faint" />}
            <div>
              <p className="text-sm font-medium text-ink">Ride notifications</p>
              <p className="text-xs text-muted">
                {permission === 'granted' && 'Enabled — you\'ll be notified when a driver is assigned.'}
                {permission === 'denied' && 'Blocked in your browser settings.'}
                {permission === 'default' && 'Get notified the moment a driver is assigned.'}
              </p>
            </div>
          </div>
          {permission === 'default' && (
            <Button variant="secondary" className="min-h-[36px] px-3 py-1 text-sm" onClick={request}>
              Enable
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink">Appearance</p>
            <p className="text-xs text-muted">Follows your device by default.</p>
          </div>
          <ThemeToggle />
        </div>
      </Card>

      <Button variant="danger" fullWidth onClick={() => setLogoutOpen(true)}>
        <LogOut className="mr-1.5 inline h-4 w-4" /> Log out
      </Button>

      <ConfirmDialog
        open={logoutOpen}
        title="Log out?"
        message="You'll need to sign in again with your booking ref and phone number."
        confirmLabel="Log out"
        danger
        loading={loggingOut}
        onConfirm={handleLogout}
        onCancel={() => setLogoutOpen(false)}
      />
    </div>
  );
}
