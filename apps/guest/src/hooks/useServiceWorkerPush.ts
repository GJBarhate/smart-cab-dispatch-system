import { useEffect, useRef } from 'react';
import { guestApi } from '../api/guest';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function subscribeForPush(): Promise<void> {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });
    }
    await guestApi.pushSubscribe(subscription.toJSON());
  } catch (err) {
    // Non-fatal — in-app socket toasts remain the primary notification path.
    // eslint-disable-next-line no-console
    console.warn('Push subscription failed, continuing with in-app notifications only.', err);
  }
}

/**
 * Requests notification permission the FIRST time the guest transitions into
 * the "assigned" state (a meaningful moment, not page load — asking on load
 * gets auto-denied and can never be re-prompted by the page).
 */
export function useAssignedNotificationPrompt(status: string | undefined): void {
  const hasPrompted = useRef(false);
  const previousStatus = useRef<string | undefined>(undefined);

  useEffect(() => {
    const becameAssigned = status === 'assigned' && previousStatus.current !== 'assigned';
    previousStatus.current = status;

    if (!becameAssigned || hasPrompted.current) return;
    if (typeof Notification === 'undefined') return;

    hasPrompted.current = true;

    if (Notification.permission === 'granted') {
      void subscribeForPush();
      return;
    }
    if (Notification.permission === 'denied') return;

    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted') void subscribeForPush();
    });
  }, [status]);
}
