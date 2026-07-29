"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DriverStateService = void 0;
var _Driver = require("../../models/Driver");
var _Trip = require("../../models/Trip");
var _RoutingService = require("../routing/RoutingService");
var _geo = require("../../utils/geo");
var _time = require("../../utils/time");
// Bridges Mongoose Driver documents and the pure DispatchDriver shape the
// scoring path consumes (plan.md §8.2 step 1). Also refreshes predictedFreeAt
// / predictedFreeLocation for busy drivers so the batch matrix call can be
// scored against where a driver *will* be, not just where they are now.

const BUSY_STATUSES = ['assigned', 'en_route_pickup', 'at_pickup', 'on_trip'];
const STOP_SERVICE_TIME_SEC = 180;
const DriverStateService = {
  /** Walks each busy driver's remaining stops to estimate when/where they free up. */
  async refreshPredictedFreeState() {
    const busyDrivers = await _Driver.Driver.find({
      status: {
        $in: BUSY_STATUSES
      },
      currentTripId: {
        $ne: null
      }
    });

    // Each driver's own stop chain must stay sequential (each leg's origin is
    // the previous stop), but different drivers are independent — running
    // them concurrently keeps one tick from paying N x (network latency)
    // when there are N busy drivers, which matters a lot given OSRM's public
    // demo server has no SLA (plan.md §16.26).
    await Promise.all(busyDrivers.map(async driver => {
      const trip = await _Trip.Trip.findById(driver.currentTripId).lean();
      if (!trip) return;
      const pendingStops = trip.stops.filter(s => s.status !== 'done').sort((a, b) => a.seq - b.seq);
      if (pendingStops.length === 0) {
        await _Driver.Driver.updateOne({
          _id: driver._id
        }, {
          $set: {
            predictedFreeAt: new Date(),
            predictedFreeLocation: driver.currentLocation
          }
        });
        return;
      }
      let cursor = (0, _geo.toLatLng)(driver.currentLocation);
      let cumulativeSeconds = 0;
      for (const stop of pendingStops) {
        const dest = (0, _geo.toLatLng)(stop.coordinates);
        const {
          durationSeconds
        } = await _RoutingService.RoutingService.eta(cursor, dest);
        cumulativeSeconds += durationSeconds + STOP_SERVICE_TIME_SEC;
        cursor = dest;
      }
      await _Driver.Driver.updateOne({
        _id: driver._id
      }, {
        $set: {
          predictedFreeAt: new Date(Date.now() + cumulativeSeconds * 1000),
          predictedFreeLocation: (0, _geo.toGeoPoint)(cursor)
        }
      });
    }));
  },
  /** Idle drivers eligible to receive a new trip within the tick's batch horizon. */
  async listEligibleDrivers(cfg, now = new Date()) {
    const horizonAt = new Date(now.getTime() + cfg.batchHorizonMin * 60_000);
    const drivers = await _Driver.Driver.find({
      isActive: true,
      status: {
        $in: ['idle', 'assigned', 'on_trip']
      },
      $or: [{
        'break.onBreakUntil': null
      }, {
        'break.onBreakUntil': {
          $lte: now
        }
      }],
      predictedFreeAt: {
        $lte: horizonAt
      }
    });
    return drivers.map(doc => ({
      doc,
      plain: DriverStateService.toDispatchDriver(doc, now)
    }));
  },
  toDispatchDriver(driver, now = new Date()) {
    // An idle driver's predictedFreeAt is the moment they last became free —
    // there's no separate "became idle at" field, so it doubles as that
    // marker once status settles back to 'idle'.
    const idleMinutes = driver.status === 'idle' && driver.predictedFreeAt && driver.predictedFreeAt.getTime() <= now.getTime() ? Math.max(0, (0, _time.minutesBetween)(driver.predictedFreeAt, now)) : 0;
    return {
      id: driver._id.toString(),
      status: driver.status,
      vehicleType: driver.vehicle.type,
      capacitySeats: driver.capacity.seats,
      capacityLuggage: driver.capacity.luggage,
      usedSeats: 0,
      usedLuggage: 0,
      location: (0, _geo.toLatLng)(driver.currentLocation),
      predictedFreeAt: driver.predictedFreeAt ?? now,
      predictedFreeLocation: (0, _geo.toLatLng)(driver.predictedFreeLocation ?? driver.currentLocation),
      shiftEndAt: driver.shift?.endAt ?? null,
      tripsSinceBreak: driver.break?.tripsSinceBreak ?? 0,
      minutesSinceBreak: driver.break?.minutesSinceBreak ?? 0,
      onBreakUntil: driver.break?.onBreakUntil ?? null,
      idleMinutes,
      rejectedEntryIds: (driver.rejectedEntryIds ?? []).map(id => id.toString())
    };
  }
};
exports.DriverStateService = DriverStateService;
