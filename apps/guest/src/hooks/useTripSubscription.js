import { useEffect } from 'react';
import { useSocket } from './useSocket';
import { ClientEvents } from '../shared';

/** Joins the Socket.IO room for a trip so trip:status / trip:eta / driver:position start flowing.
 * Re-subscribes on every reconnect since rooms don't survive a disconnect. */
export function useTripSubscription(tripId) {
  const socket = useSocket();
  useEffect(() => {
    if (!socket || !tripId) return;
    const subscribe = () => socket.emit(ClientEvents.TRIP_SUBSCRIBE, {
      tripId
    });
    subscribe();
    socket.on('connect', subscribe);
    return () => {
      socket.off('connect', subscribe);
    };
  }, [socket, tripId]);
}
