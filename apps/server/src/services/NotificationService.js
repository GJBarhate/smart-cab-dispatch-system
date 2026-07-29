"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NotificationService = void 0;
var _io = require("../realtime/io");
var _rooms = require("../realtime/rooms");
var _shared = require("../shared");
// Centralised Socket.IO emission. Every dispatch/trip mutation that matters
// to a client goes through here so the room list in plan.md §10.2 stays the
// single place events fan out from — no stray `io.emit` anywhere else.

function safeEmit(fn) {
  try {
    fn();
  } catch {
    // Socket.IO not initialised (e.g. under test) — never let a notification failure break a mutation.
  }
}
const NotificationService = {
  tripOffered(driverId, payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.driver(driverId)).emit(_shared.ServerEvents.TRIP_OFFERED, payload));
  },
  tripAssigned(guestId, payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.guest(guestId)).emit(_shared.ServerEvents.TRIP_ASSIGNED, payload));
  },
  tripStatus(tripId, payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.trip(tripId)).to(_rooms.rooms.admin()).emit(_shared.ServerEvents.TRIP_STATUS, payload));
  },
  tripEta(tripId, payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.trip(tripId)).to(_rooms.rooms.admin()).emit(_shared.ServerEvents.TRIP_ETA, payload));
  },
  requestStatus(guestId, payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.guest(guestId)).to(_rooms.rooms.admin()).emit(_shared.ServerEvents.REQUEST_STATUS, payload));
  },
  queueUpdate(payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.admin()).emit(_shared.ServerEvents.QUEUE_UPDATE, payload));
  },
  dispatchTick(payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.admin()).emit(_shared.ServerEvents.DISPATCH_TICK, payload));
  },
  adminAlert(payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.admin()).emit(_shared.ServerEvents.ADMIN_ALERT, payload));
  },
  driverBreak(driverId, payload) {
    safeEmit(() => (0, _io.getIo)().to(_rooms.rooms.driver(driverId)).to(_rooms.rooms.admin()).emit(_shared.ServerEvents.DRIVER_BREAK, payload));
  }
};
exports.NotificationService = NotificationService;
