// Centralised Socket.IO emission. Every dispatch/trip mutation that matters
// to a client goes through here so the room list in plan.md §10.2 stays the
// single place events fan out from — no stray `io.emit` anywhere else.
import { getIo } from '../realtime/io';
import { rooms } from '../realtime/rooms';
import { ServerEvents } from '../shared';
import type {
  AdminAlertPayload,
  DispatchTickPayload,
  DriverBreakPayload,
  QueueUpdatePayload,
  RequestStatusPayload,
  TripAssignedPayload,
  TripEtaPayload,
  TripOfferedPayload,
  TripStatusPayload
} from '../shared';

function safeEmit(fn: () => void): void {
  try {
    fn();
  } catch {
    // Socket.IO not initialised (e.g. under test) — never let a notification failure break a mutation.
  }
}

export const NotificationService = {
  tripOffered(driverId: string, payload: TripOfferedPayload): void {
    safeEmit(() => getIo().to(rooms.driver(driverId)).emit(ServerEvents.TRIP_OFFERED, payload));
  },

  tripAssigned(guestId: string, payload: TripAssignedPayload): void {
    safeEmit(() => getIo().to(rooms.guest(guestId)).emit(ServerEvents.TRIP_ASSIGNED, payload));
  },

  tripStatus(tripId: string, payload: TripStatusPayload): void {
    safeEmit(() => getIo().to(rooms.trip(tripId)).to(rooms.admin()).emit(ServerEvents.TRIP_STATUS, payload));
  },

  tripEta(tripId: string, payload: TripEtaPayload): void {
    safeEmit(() => getIo().to(rooms.trip(tripId)).to(rooms.admin()).emit(ServerEvents.TRIP_ETA, payload));
  },

  requestStatus(guestId: string, payload: RequestStatusPayload): void {
    safeEmit(() => getIo().to(rooms.guest(guestId)).to(rooms.admin()).emit(ServerEvents.REQUEST_STATUS, payload));
  },

  queueUpdate(payload: QueueUpdatePayload): void {
    safeEmit(() => getIo().to(rooms.admin()).emit(ServerEvents.QUEUE_UPDATE, payload));
  },

  dispatchTick(payload: DispatchTickPayload): void {
    safeEmit(() => getIo().to(rooms.admin()).emit(ServerEvents.DISPATCH_TICK, payload));
  },

  adminAlert(payload: AdminAlertPayload): void {
    safeEmit(() => getIo().to(rooms.admin()).emit(ServerEvents.ADMIN_ALERT, payload));
  },

  driverBreak(driverId: string, payload: DriverBreakPayload): void {
    safeEmit(() => getIo().to(rooms.driver(driverId)).to(rooms.admin()).emit(ServerEvents.DRIVER_BREAK, payload));
  }
};
