import { Server, Socket } from 'socket.io';
import { Driver } from '../models/Driver';
import { Trip } from '../models/Trip';
import { toGeoPoint } from '../utils/geo';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { rooms } from './rooms';
import { ClientEvents, ServerEvents } from '../shared';
import type { JwtPayload } from '../shared';

// driverId -> last time we persisted a location to Mongo (in-memory, per §10.3 —
// protects the Atlas M0 write budget: relay every emit, persist at most every
// LOCATION_PERSIST_THROTTLE_MS per driver).
const lastPersistedAt = new Map<string, number>();

export function registerHandlers(io: Server, socket: Socket, user: JwtPayload): void {
  socket.on(ClientEvents.DRIVER_LOCATION, async (payload: { lat: number; lng: number; heading?: number; speedKmph?: number }) => {
    if (user.role !== 'driver' || !user.driverId) return;
    const { lat, lng, heading, speedKmph } = payload;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;

    const driver = await Driver.findById(user.driverId).select('currentTripId').lean();
    if (!driver) return;

    const at = new Date().toISOString();

    // Always relay to interested rooms immediately for a smooth live map.
    if (driver.currentTripId) {
      io.to(rooms.trip(driver.currentTripId.toString())).emit(ServerEvents.DRIVER_POSITION, {
        driverId: user.driverId,
        lat,
        lng,
        heading,
        at
      });
    }
    io.to(rooms.admin()).emit(ServerEvents.DRIVER_POSITION, { driverId: user.driverId, lat, lng, heading, at });

    // Throttle the actual Mongo write.
    const last = lastPersistedAt.get(user.driverId) ?? 0;
    if (Date.now() - last < env.LOCATION_PERSIST_THROTTLE_MS) return;
    lastPersistedAt.set(user.driverId, Date.now());

    try {
      await Driver.updateOne(
        { _id: user.driverId },
        {
          $set: {
            currentLocation: toGeoPoint({ lat, lng }),
            locationUpdatedAt: new Date(),
            heading: heading ?? 0,
            speedKmph: speedKmph ?? 0
          }
        }
      );
    } catch (err) {
      logger.error({ err }, 'failed to persist driver location');
    }
  });

  socket.on(ClientEvents.TRIP_SUBSCRIBE, async (payload: { tripId: string }) => {
    const { tripId } = payload ?? {};
    if (!tripId) return;

    if (user.role === 'admin') {
      socket.join(rooms.trip(tripId));
      return;
    }

    const trip = await Trip.findById(tripId).select('driverId guests').lean();
    if (!trip) return;

    if (user.role === 'driver' && trip.driverId?.toString() === user.driverId) {
      socket.join(rooms.trip(tripId));
      return;
    }

    if (user.role === 'guest' && trip.guests?.some((g) => g.guestId?.toString() === user.guestId)) {
      socket.join(rooms.trip(tripId));
    }
  });

  socket.on(ClientEvents.ADMIN_SUBSCRIBE_MAP, () => {
    if (user.role === 'admin') socket.join(rooms.admin());
  });
}
