"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.registerHandlers = registerHandlers;
var _Driver = require("../models/Driver");
var _Trip = require("../models/Trip");
var _geo = require("../utils/geo");
var _env = require("../config/env");
var _logger = require("../config/logger");
var _rooms = require("./rooms");
var _shared = require("../shared");
// driverId -> last time we persisted a location to Mongo (in-memory, per §10.3 —
// protects the Atlas M0 write budget: relay every emit, persist at most every
// LOCATION_PERSIST_THROTTLE_MS per driver).
const lastPersistedAt = new Map();
function registerHandlers(io, socket, user) {
  socket.on(_shared.ClientEvents.DRIVER_LOCATION, async payload => {
    if (user.role !== 'driver' || !user.driverId) return;
    const {
      lat,
      lng,
      heading,
      speedKmph
    } = payload;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    const driver = await _Driver.Driver.findById(user.driverId).select('currentTripId').lean();
    if (!driver) return;
    const at = new Date().toISOString();

    // Always relay to interested rooms immediately for a smooth live map.
    if (driver.currentTripId) {
      io.to(_rooms.rooms.trip(driver.currentTripId.toString())).emit(_shared.ServerEvents.DRIVER_POSITION, {
        driverId: user.driverId,
        lat,
        lng,
        heading,
        at
      });
    }
    io.to(_rooms.rooms.admin()).emit(_shared.ServerEvents.DRIVER_POSITION, {
      driverId: user.driverId,
      lat,
      lng,
      heading,
      at
    });

    // Throttle the actual Mongo write.
    const last = lastPersistedAt.get(user.driverId) ?? 0;
    if (Date.now() - last < _env.env.LOCATION_PERSIST_THROTTLE_MS) return;
    lastPersistedAt.set(user.driverId, Date.now());
    try {
      await _Driver.Driver.updateOne({
        _id: user.driverId
      }, {
        $set: {
          currentLocation: (0, _geo.toGeoPoint)({
            lat,
            lng
          }),
          locationUpdatedAt: new Date(),
          heading: heading ?? 0,
          speedKmph: speedKmph ?? 0
        }
      });
    } catch (err) {
      _logger.logger.error({
        err
      }, 'failed to persist driver location');
    }
  });
  socket.on(_shared.ClientEvents.TRIP_SUBSCRIBE, async payload => {
    const {
      tripId
    } = payload ?? {};
    if (!tripId) return;
    if (user.role === 'admin') {
      socket.join(_rooms.rooms.trip(tripId));
      return;
    }
    const trip = await _Trip.Trip.findById(tripId).select('driverId guests').lean();
    if (!trip) return;
    if (user.role === 'driver' && trip.driverId?.toString() === user.driverId) {
      socket.join(_rooms.rooms.trip(tripId));
      return;
    }
    if (user.role === 'guest' && trip.guests?.some(g => g.guestId?.toString() === user.guestId)) {
      socket.join(_rooms.rooms.trip(tripId));
    }
  });
  socket.on(_shared.ClientEvents.ADMIN_SUBSCRIBE_MAP, () => {
    if (user.role === 'admin') socket.join(_rooms.rooms.admin());
  });
}
