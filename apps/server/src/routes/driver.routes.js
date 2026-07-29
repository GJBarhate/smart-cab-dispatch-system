"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.driverRouter = void 0;
var _express = require("express");
var _zod = require("zod");
var _Driver = require("../models/Driver");
var _Trip = require("../models/Trip");
var _Guest = require("../models/Guest");
var _QueueEntry = require("../models/QueueEntry");
var _asyncHandler = require("../middleware/asyncHandler");
var _validate = require("../middleware/validate");
var _auth = require("../middleware/auth");
var _errors = require("../utils/errors");
var _geo = require("../utils/geo");
var _TripService = require("../services/dispatch/TripService");
var _NotificationService = require("../services/NotificationService");
var _RoutingService = require("../services/routing/RoutingService");
const driverRouter = (0, _express.Router)();
exports.driverRouter = driverRouter;
driverRouter.use(_auth.requireAuth, (0, _auth.requireRole)('driver'));
function driverId(req) {
  const id = req.user?.driverId;
  if (!id) throw new _errors.ForbiddenError('No driver identity on token');
  return id;
}
driverRouter.get('/me', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const driver = await _Driver.Driver.findById(driverId(req));
  if (!driver) throw new _errors.StaleSessionError('Driver');
  res.json({
    ok: true,
    data: driver
  });
}));
const statusSchema = _zod.z.object({
  action: _zod.z.enum(['online', 'offline', 'request_break'])
});
driverRouter.patch('/status', (0, _validate.validate)({
  body: statusSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const did = driverId(req);
  const {
    action
  } = req.body;
  if (action === 'online') {
    await _Driver.Driver.updateOne({
      _id: did
    }, {
      $set: {
        status: 'idle'
      }
    });
  } else if (action === 'offline') {
    await _Driver.Driver.updateOne({
      _id: did
    }, {
      $set: {
        status: 'offline'
      }
    });
  } else {
    const driver = await _Driver.Driver.findById(did);
    if (!driver) throw new _errors.StaleSessionError('Driver');
    if (driver.currentTripId) throw new _errors.ConflictError('Cannot break while on a trip');
    const until = new Date(Date.now() + (driver.break?.tripsSinceBreak ? 20 : 20) * 60_000);
    await _Driver.Driver.updateOne({
      _id: did
    }, {
      $set: {
        status: 'on_break',
        'break.onBreakUntil': until,
        'break.tripsSinceBreak': 0
      }
    });
    _NotificationService.NotificationService.driverBreak(did, {
      driverId: did,
      until: until.toISOString(),
      reason: 'requested'
    });
  }
  const driver = await _Driver.Driver.findById(did);
  res.json({
    ok: true,
    data: driver
  });
}));
driverRouter.get('/trip/current', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const did = driverId(req);
  const driver = await _Driver.Driver.findById(did);
  if (!driver?.currentTripId) throw new _errors.NotFoundError('Trip');
  const trip = await _Trip.Trip.findOne({
    _id: driver.currentTripId,
    driverId: did
  });
  if (!trip) throw new _errors.NotFoundError('Trip');
  res.json({
    ok: true,
    data: trip
  });
}));
async function findOwnTrip(tripId, did) {
  const trip = await _Trip.Trip.findOne({
    _id: tripId,
    driverId: did
  });
  if (!trip) throw new _errors.NotFoundError('Trip');
  return trip;
}
driverRouter.post('/trip/:id/accept', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const did = driverId(req);
  await findOwnTrip(req.params.id, did);

  // The driver is expected to start moving immediately on accept, so the
  // trip advances straight through ACCEPTED to EN_ROUTE_PICKUP in one call —
  // there's no separate "start driving" action in the API surface (§9.3).
  await _TripService.TripService.transition(req.params.id, 'accepted', did);
  const trip = await _TripService.TripService.transition(req.params.id, 'en_route_pickup', did);
  await _Driver.Driver.updateOne({
    _id: did
  }, {
    $set: {
      status: 'en_route_pickup'
    }
  });
  const firstStop = trip.stops.find(s => s.status === 'pending');
  let etaSeconds = 0;
  if (firstStop) {
    const driver = await _Driver.Driver.findById(did);
    if (driver) {
      const eta = await _RoutingService.RoutingService.eta({
        lat: driver.currentLocation.coordinates[1],
        lng: driver.currentLocation.coordinates[0]
      }, {
        lat: firstStop.coordinates.coordinates[1],
        lng: firstStop.coordinates.coordinates[0]
      });
      etaSeconds = eta.durationSeconds;
    }
  }
  for (const g of trip.guests) {
    _NotificationService.NotificationService.tripAssigned(g.guestId.toString(), {
      trip: trip.toJSON(),
      driver: {
        name: trip.vehicleSnapshot?.model ?? '',
        phone: '',
        vehicleNumber: trip.vehicleSnapshot?.number ?? ''
      },
      etaSeconds
    });
  }
  _NotificationService.NotificationService.tripStatus(trip._id.toString(), {
    tripId: trip._id.toString(),
    status: trip.status,
    at: new Date().toISOString()
  });
  res.json({
    ok: true,
    data: trip
  });
}));
const rejectSchema = _zod.z.object({
  reason: _zod.z.string().min(1)
});
driverRouter.post('/trip/:id/reject', (0, _validate.validate)({
  body: rejectSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const did = driverId(req);
  const existing = await findOwnTrip(req.params.id, did);
  const {
    reason
  } = req.body;
  const trip = await _TripService.TripService.transition(req.params.id, 'rejected', did);
  trip.rejectionReason = reason;
  await trip.save();
  const guestIds = existing.guests.map(g => g.guestId);
  await _TripService.TripService.releaseDriver(did);

  // Blacklist this driver against the QueueEntry id(s) that fed this trip —
  // Feasibility.check compares rejectedEntryIds against demand.id, which is
  // the QueueEntry id, not a guest id.
  const entries = await _QueueEntry.QueueEntry.find({
    guestIds: {
      $in: guestIds
    },
    status: 'assigned'
  });
  await _Driver.Driver.updateOne({
    _id: did
  }, {
    $push: {
      rejectedEntryIds: {
        $each: entries.map(e => e._id)
      }
    },
    $inc: {
      'stats.rejections': 1
    }
  });
  for (const entry of entries) {
    await _QueueEntry.QueueEntry.updateOne({
      _id: entry._id
    }, {
      $set: {
        status: 'waiting',
        enqueuedAt: new Date(Date.now() - 15 * 60_000)
      },
      $push: {
        rejectedDriverIds: did
      }
    });
  }
  await _TripService.TripService.requeueGuests(guestIds.map(g => g.toString()), 'driver_rejected');
  _NotificationService.NotificationService.tripStatus(trip._id.toString(), {
    tripId: trip._id.toString(),
    status: 'rejected',
    at: new Date().toISOString()
  });
  res.json({
    ok: true,
    data: trip
  });
}));
driverRouter.post('/trip/:id/arrived', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const did = driverId(req);
  const existing = await findOwnTrip(req.params.id, did);
  const nextStop = existing.stops.find(s => s.status === 'pending');
  if (!nextStop) throw new _errors.ConflictError('No pending stop to arrive at');
  const trip = await _TripService.TripService.transition(req.params.id, 'at_pickup', did);
  const stopDoc = trip.stops.find(s => s.seq === nextStop.seq);
  if (stopDoc) {
    stopDoc.status = 'arrived';
    stopDoc.actualAt = new Date();
  }
  await trip.save();
  _NotificationService.NotificationService.tripStatus(trip._id.toString(), {
    tripId: trip._id.toString(),
    status: 'at_pickup',
    at: new Date().toISOString(),
    stopSeq: nextStop.seq
  });
  res.json({
    ok: true,
    data: trip
  });
}));
const boardSchema = _zod.z.object({
  guestIds: _zod.z.array(_zod.z.string()).min(1)
});
driverRouter.post('/trip/:id/board', (0, _validate.validate)({
  body: boardSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const did = driverId(req);
  await findOwnTrip(req.params.id, did);
  const {
    guestIds
  } = req.body;
  const trip = await _TripService.TripService.transition(req.params.id, 'boarded', did);
  const now = new Date();
  for (const g of trip.guests) {
    if (guestIds.includes(g.guestId.toString())) g.boardedAt = now;
  }
  for (const stop of trip.stops) {
    if (stop.kind === 'pickup' && stop.guestIds.some(g => guestIds.includes(g.toString()))) {
      stop.status = 'done';
      stop.actualAt = now;
    }
  }
  await trip.save();
  await _Guest.Guest.updateMany({
    _id: {
      $in: guestIds
    }
  }, {
    $set: {
      status: 'in_transit'
    }
  });
  _NotificationService.NotificationService.tripStatus(trip._id.toString(), {
    tripId: trip._id.toString(),
    status: 'boarded',
    at: now.toISOString()
  });
  res.json({
    ok: true,
    data: trip
  });
}));
const dropSchema = _zod.z.object({
  guestIds: _zod.z.array(_zod.z.string()).min(1),
  stopSeq: _zod.z.number().int()
});
driverRouter.post('/trip/:id/drop', (0, _validate.validate)({
  body: dropSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const did = driverId(req);
  const trip = await findOwnTrip(req.params.id, did);
  const {
    guestIds,
    stopSeq
  } = req.body;
  const now = new Date();
  const stop = trip.stops.find(s => s.seq === stopSeq);
  if (!stop) throw new _errors.NotFoundError('Stop');
  stop.status = 'done';
  stop.actualAt = now;
  for (const g of trip.guests) {
    if (guestIds.includes(g.guestId.toString())) g.droppedAt = now;
  }
  const allDropsDone = trip.stops.filter(s => s.kind === 'drop').every(s => s.status === 'done');
  if (allDropsDone) {
    await trip.save();
    const completed = await _TripService.TripService.transition(req.params.id, 'completed', did);
    await _Guest.Guest.updateMany({
      _id: {
        $in: trip.guests.map(g => g.guestId)
      }
    }, {
      $set: {
        status: 'completed',
        currentTripId: null
      }
    });
    await _Driver.Driver.updateOne({
      _id: did
    }, {
      $set: {
        status: 'idle',
        currentTripId: null
      },
      $inc: {
        'stats.tripsCompleted': 1,
        'stats.guestsServed': trip.guests.length
      }
    });
    _NotificationService.NotificationService.tripStatus(completed._id.toString(), {
      tripId: completed._id.toString(),
      status: 'completed',
      at: now.toISOString(),
      stopSeq
    });
    res.json({
      ok: true,
      data: completed
    });
    return;
  }
  await trip.save();
  await _Guest.Guest.updateMany({
    _id: {
      $in: guestIds
    }
  }, {
    $set: {
      status: 'completed',
      currentTripId: null
    }
  });
  _NotificationService.NotificationService.tripStatus(trip._id.toString(), {
    tripId: trip._id.toString(),
    status: trip.status,
    at: now.toISOString(),
    stopSeq
  });
  res.json({
    ok: true,
    data: trip
  });
}));
const locationSchema = _zod.z.object({
  lat: _zod.z.number(),
  lng: _zod.z.number(),
  heading: _zod.z.number().optional(),
  speed: _zod.z.number().optional()
});
driverRouter.post('/location', (0, _validate.validate)({
  body: locationSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const did = driverId(req);
  const {
    lat,
    lng,
    heading,
    speed
  } = req.body;
  await _Driver.Driver.updateOne({
    _id: did
  }, {
    $set: {
      currentLocation: (0, _geo.toGeoPoint)({
        lat,
        lng
      }),
      locationUpdatedAt: new Date(),
      heading: heading ?? 0,
      speedKmph: speed ?? 0
    }
  });
  res.json({
    ok: true,
    data: {
      updated: true
    }
  });
}));
driverRouter.get('/summary', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const driver = await _Driver.Driver.findById(driverId(req));
  if (!driver) throw new _errors.StaleSessionError('Driver');
  const tripsToday = await _Trip.Trip.countDocuments({
    driverId: driver._id,
    status: 'completed',
    completedAt: {
      $gte: new Date(new Date().setHours(0, 0, 0, 0))
    }
  });
  res.json({
    ok: true,
    data: {
      tripsToday,
      tripsCompleted: driver.stats?.tripsCompleted ?? 0,
      guestsServed: driver.stats?.guestsServed ?? 0,
      tripsSinceBreak: driver.break?.tripsSinceBreak ?? 0,
      onBreakUntil: driver.break?.onBreakUntil ?? null
    }
  });
}));
