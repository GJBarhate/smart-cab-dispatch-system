"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.adminRouter = void 0;
var _express = require("express");
var _zod = require("zod");
var _bcryptjs = _interopRequireDefault(require("bcryptjs"));
var _multer = _interopRequireDefault(require("multer"));
var _sync = require("csv-parse/sync");
var _User = require("../models/User");
var _Driver = require("../models/Driver");
var _Guest = require("../models/Guest");
var _Location = require("../models/Location");
var _EventConfig = require("../models/EventConfig");
var _Trip = require("../models/Trip");
var _RideRequest = require("../models/RideRequest");
var _QueueEntry = require("../models/QueueEntry");
var _Alert = require("../models/Alert");
var _AuditLog = require("../models/AuditLog");
var _asyncHandler = require("../middleware/asyncHandler");
var _validate = require("../middleware/validate");
var _auth = require("../middleware/auth");
var _errors = require("../utils/errors");
var _geo = require("../utils/geo");
var _env = require("../config/env");
var _TripService = require("../services/dispatch/TripService");
var _DispatchEngine = require("../services/dispatch/DispatchEngine");
var _AuditService = require("../services/AuditService");
var _NotificationService = require("../services/NotificationService");
function _interopRequireDefault(e) {
  return e && e.__esModule ? e : {
    default: e
  };
}
const adminRouter = (0, _express.Router)();
exports.adminRouter = adminRouter;
adminRouter.use(_auth.requireAuth, (0, _auth.requireRole)('admin'));
function audit(req, action, entityType, entityId, before, after) {
  return _AuditService.AuditService.log({
    actorId: req.user.sub,
    actorRole: 'admin',
    action,
    entityType,
    entityId,
    before,
    after,
    ip: req.ip
  });
}

// ---------- Dashboard ----------

adminRouter.get('/dashboard', (0, _asyncHandler.asyncHandler)(async (_req, res) => {
  const [guestsByStatus, driversByStatus, queueDepth, unassignableCount, tripsToday, alerts] = await Promise.all([_Guest.Guest.aggregate([{
    $group: {
      _id: '$status',
      count: {
        $sum: 1
      }
    }
  }]), _Driver.Driver.aggregate([{
    $group: {
      _id: '$status',
      count: {
        $sum: 1
      }
    }
  }]), _QueueEntry.QueueEntry.countDocuments({
    status: 'waiting'
  }), _QueueEntry.QueueEntry.countDocuments({
    status: 'failed'
  }), _Trip.Trip.countDocuments({
    status: 'completed',
    completedAt: {
      $gte: new Date(new Date().setHours(0, 0, 0, 0))
    }
  }), _Alert.Alert.find({
    acknowledged: false
  }).sort({
    createdAt: -1
  }).limit(20)]);
  const waitingEntries = await _QueueEntry.QueueEntry.find({
    status: 'waiting'
  }).select('enqueuedAt').lean();
  const now = Date.now();
  const waitMinutes = waitingEntries.map(e => (now - new Date(e.enqueuedAt).getTime()) / 60_000);
  const avgWaitMin = waitMinutes.length ? waitMinutes.reduce((a, b) => a + b, 0) / waitMinutes.length : 0;
  const oldestWaitMin = waitMinutes.length ? Math.max(...waitMinutes) : 0;
  const liveDrivers = await _Driver.Driver.find({
    isActive: true
  }).select('name status currentLocation heading vehicle');
  res.json({
    ok: true,
    data: {
      kpis: {
        guestsWaiting: queueDepth,
        avgWaitMin: Number(avgWaitMin.toFixed(1)),
        oldestWaitMin: Number(oldestWaitMin.toFixed(1)),
        unassignable: unassignableCount,
        tripsCompletedToday: tripsToday
      },
      guestsByStatus: Object.fromEntries(guestsByStatus.map(g => [g._id, g.count])),
      driversByStatus: Object.fromEntries(driversByStatus.map(d => [d._id, d.count])),
      liveDrivers,
      alerts
    }
  });
}));

// ---------- Drivers ----------

adminRouter.get('/drivers', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const drivers = await _Driver.Driver.find(filter).sort({
    name: 1
  });
  res.json({
    ok: true,
    data: drivers
  });
}));
const createDriverSchema = _zod.z.object({
  name: _zod.z.string().min(1),
  phone: _zod.z.string().min(1),
  licenseNo: _zod.z.string().default(''),
  vehicleNumber: _zod.z.string().min(1),
  vehicleModel: _zod.z.string().default(''),
  vehicleColour: _zod.z.string().default(''),
  vehicleType: _zod.z.enum(['sedan', 'suv', 'tempo', 'bus']),
  seats: _zod.z.number().int().min(1),
  luggage: _zod.z.number().int().min(0),
  shiftStartAt: _zod.z.string().optional(),
  shiftEndAt: _zod.z.string().optional()
});
function randomPassword() {
  return Math.random().toString(36).slice(-8) + '!1A';
}
adminRouter.post('/drivers', (0, _validate.validate)({
  body: createDriverSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const body = req.body;
  const password = randomPassword();
  const passwordHash = await _bcryptjs.default.hash(password, _env.env.BCRYPT_ROUNDS);
  const user = await _User.User.create({
    name: body.name,
    phone: body.phone,
    role: 'driver',
    passwordHash,
    isActive: true
  });
  const driver = await _Driver.Driver.create({
    userId: user._id,
    name: body.name,
    phone: body.phone,
    licenseNo: body.licenseNo,
    vehicle: {
      number: body.vehicleNumber,
      model: body.vehicleModel,
      colour: body.vehicleColour,
      type: body.vehicleType
    },
    capacity: {
      seats: body.seats,
      luggage: body.luggage
    },
    status: 'offline',
    shift: {
      startAt: body.shiftStartAt ? new Date(body.shiftStartAt) : null,
      endAt: body.shiftEndAt ? new Date(body.shiftEndAt) : null
    },
    isActive: true
  });
  await _User.User.updateOne({
    _id: user._id
  }, {
    $set: {
      driverId: driver._id
    }
  });
  await audit(req, 'driver.create', 'Driver', driver._id.toString(), null, driver.toJSON());
  res.status(201).json({
    ok: true,
    data: {
      driver,
      generatedPassword: password
    }
  });
}));
const updateDriverSchema = _zod.z.object({
  name: _zod.z.string().optional(),
  phone: _zod.z.string().optional(),
  isActive: _zod.z.boolean().optional(),
  status: _zod.z.enum(['offline', 'idle', 'suspended']).optional(),
  capacity: _zod.z.object({
    seats: _zod.z.number().int().min(1),
    luggage: _zod.z.number().int().min(0)
  }).optional()
});
adminRouter.patch('/drivers/:id', (0, _validate.validate)({
  body: updateDriverSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const before = await _Driver.Driver.findById(req.params.id);
  if (!before) throw new _errors.NotFoundError('Driver');
  const driver = await _Driver.Driver.findByIdAndUpdate(req.params.id, {
    $set: req.body
  }, {
    new: true
  });
  if (req.body.status === 'suspended' && before.currentTripId) {
    const trip = await _Trip.Trip.findById(before.currentTripId);
    if (trip) {
      const guestIds = trip.guests.map(g => g.guestId.toString());
      await _TripService.TripService.requeueGuests(guestIds, 'driver_suspended');
      await _Trip.Trip.updateOne({
        _id: trip._id
      }, {
        $set: {
          status: 'cancelled',
          cancellationReason: 'driver_suspended',
          cancelledAt: new Date()
        }
      });
      await _QueueEntry.QueueEntry.updateMany({
        guestIds: {
          $in: guestIds
        }
      }, {
        $set: {
          status: 'waiting',
          enqueuedAt: new Date(Date.now() - 15 * 60_000)
        }
      });
    }
  }
  await audit(req, 'driver.update', 'Driver', req.params.id, before.toJSON(), driver?.toJSON());
  res.json({
    ok: true,
    data: driver
  });
}));
adminRouter.post('/drivers/:id/break', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const minutes = 20;
  const until = new Date(Date.now() + minutes * 60_000);
  const driver = await _Driver.Driver.findByIdAndUpdate(req.params.id, {
    $set: {
      status: 'on_break',
      'break.onBreakUntil': until,
      'break.tripsSinceBreak': 0
    }
  }, {
    new: true
  });
  if (!driver) throw new _errors.NotFoundError('Driver');
  _NotificationService.NotificationService.driverBreak(req.params.id, {
    driverId: req.params.id,
    until: until.toISOString(),
    reason: 'admin_forced'
  });
  await audit(req, 'driver.break', 'Driver', req.params.id, null, {
    until
  });
  res.json({
    ok: true,
    data: driver
  });
}));

// ---------- Guests ----------

adminRouter.get('/guests', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.accommodationId) filter.accommodationId = req.query.accommodationId;
  const guests = await _Guest.Guest.find(filter).sort({
    createdAt: -1
  }).limit(500);
  res.json({
    ok: true,
    data: guests
  });
}));
const createGuestSchema = _zod.z.object({
  bookingRef: _zod.z.string().min(1),
  name: _zod.z.string().min(1),
  phone: _zod.z.string().min(1),
  email: _zod.z.string().optional(),
  groupSize: _zod.z.number().int().min(1).default(1),
  luggageCount: _zod.z.number().int().min(0).default(1),
  isVip: _zod.z.boolean().default(false),
  accommodationId: _zod.z.string().optional(),
  specialNeeds: _zod.z.string().default('')
});
adminRouter.post('/guests', (0, _validate.validate)({
  body: createGuestSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const body = req.body;
  const guest = await _Guest.Guest.create({
    ...body,
    priorityTier: body.isVip ? 3 : 1,
    status: 'registered'
  });
  await audit(req, 'guest.create', 'Guest', guest._id.toString(), null, guest.toJSON());
  res.status(201).json({
    ok: true,
    data: guest
  });
}));
const updateGuestSchema = _zod.z.object({
  name: _zod.z.string().optional(),
  phone: _zod.z.string().optional(),
  accommodationId: _zod.z.string().optional(),
  arrival: _zod.z.record(_zod.z.any()).optional(),
  departure: _zod.z.record(_zod.z.any()).optional(),
  specialNeeds: _zod.z.string().optional()
});
adminRouter.patch('/guests/:id', (0, _validate.validate)({
  body: updateGuestSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const before = await _Guest.Guest.findById(req.params.id);
  if (!before) throw new _errors.NotFoundError('Guest');
  const guest = await _Guest.Guest.findByIdAndUpdate(req.params.id, {
    $set: req.body
  }, {
    new: true
  });

  // Arrival-detail changes invalidate any waiting queue entry's timing —
  // re-queue at boosted priority rather than let it dispatch against stale data.
  if (req.body.arrival) {
    await _QueueEntry.QueueEntry.updateMany({
      guestIds: req.params.id,
      status: 'waiting'
    }, {
      $set: {
        enqueuedAt: new Date(Date.now() - 10 * 60_000)
      }
    });
  }
  await audit(req, 'guest.update', 'Guest', req.params.id, before.toJSON(), guest?.toJSON());
  res.json({
    ok: true,
    data: guest
  });
}));
const upload = (0, _multer.default)({
  storage: _multer.default.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024
  }
});
adminRouter.post('/guests/import', upload.single('file'), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  if (!req.file) throw new _errors.ConflictError('No file uploaded (field name: file)');
  const rows = (0, _sync.parse)(req.file.buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  let created = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const existing = await _Guest.Guest.findOne({
        bookingRef: row.bookingRef?.toUpperCase()
      });
      if (existing) continue;
      await _Guest.Guest.create({
        bookingRef: row.bookingRef,
        name: row.name,
        phone: row.phone,
        groupSize: Number(row.groupSize ?? 1),
        luggageCount: Number(row.luggageCount ?? 1),
        isVip: row.isVip === 'true',
        priorityTier: row.isVip === 'true' ? 3 : 1,
        status: 'registered'
      });
      created++;
    } catch (err) {
      errors.push({
        row: i + 1,
        message: err instanceof Error ? err.message : 'unknown error'
      });
    }
  }
  await audit(req, 'guest.import', 'Guest', null, null, {
    created,
    errors: errors.length
  });
  res.json({
    ok: true,
    data: {
      created,
      errors
    }
  });
}));

// ---------- On-demand requests ----------

adminRouter.get('/requests', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const requests = await _RideRequest.RideRequest.find(filter).sort({
    requestedAt: 1
  }).populate('guestId');
  res.json({
    ok: true,
    data: requests
  });
}));
adminRouter.post('/requests/:id/approve', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const request = await _RideRequest.RideRequest.findById(req.params.id);
  if (!request) throw new _errors.NotFoundError('Request');
  if (request.status !== 'pending_approval') throw new _errors.ConflictError('Request already decided');
  const guest = await _Guest.Guest.findById(request.guestId);
  if (!guest) throw new _errors.NotFoundError('Guest');
  const now = new Date();
  const entry = await _QueueEntry.QueueEntry.create({
    type: 'ON_DEMAND',
    guestIds: [guest._id],
    seats: request.passengerCount,
    luggage: request.luggageCount,
    pickup: request.pickup,
    dropoff: request.dropoff,
    earliestAt: now,
    deadlineAt: new Date(now.getTime() + 60 * 60_000),
    enqueuedAt: now,
    priorityTier: guest.priorityTier,
    status: 'waiting',
    sourceRequestId: request._id
  });
  request.status = 'approved';
  request.decidedBy = req.user.sub;
  request.decidedAt = now;
  await request.save();
  await audit(req, 'request.approve', 'RideRequest', request._id.toString(), null, {
    entryId: entry._id.toString()
  });
  const matched = await _DispatchEngine.DispatchEngine.matchEntryNow(entry._id.toString(), 'greedy_realtime');
  if (matched) {
    const freshGuest = await _Guest.Guest.findById(guest._id);
    request.status = 'matched';
    request.tripId = freshGuest?.currentTripId ?? null;
    await request.save();
  }
  _NotificationService.NotificationService.requestStatus(guest._id.toString(), {
    requestId: request._id.toString(),
    status: request.status
  });
  res.json({
    ok: true,
    data: request
  });
}));
const declineSchema = _zod.z.object({
  reason: _zod.z.string().min(1)
});
adminRouter.post('/requests/:id/decline', (0, _validate.validate)({
  body: declineSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const request = await _RideRequest.RideRequest.findById(req.params.id);
  if (!request) throw new _errors.NotFoundError('Request');
  if (request.status !== 'pending_approval') throw new _errors.ConflictError('Request already decided');
  request.status = 'declined';
  request.declineReason = req.body.reason;
  request.decidedBy = req.user.sub;
  request.decidedAt = new Date();
  await request.save();
  await _Guest.Guest.updateOne({
    _id: request.guestId
  }, {
    $set: {
      status: 'registered'
    }
  });
  await audit(req, 'request.decline', 'RideRequest', request._id.toString(), null, {
    reason: req.body.reason
  });
  _NotificationService.NotificationService.requestStatus(request.guestId.toString(), {
    requestId: request._id.toString(),
    status: 'declined',
    reason: req.body.reason
  });
  res.json({
    ok: true,
    data: request
  });
}));

// ---------- Trips ----------

adminRouter.get('/trips', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const trips = await _Trip.Trip.find(filter).sort({
    createdAt: -1
  }).limit(200);
  res.json({
    ok: true,
    data: trips
  });
}));
const manualTripSchema = _zod.z.object({
  driverId: _zod.z.string(),
  guestIds: _zod.z.array(_zod.z.string()).min(1),
  pickupLat: _zod.z.number(),
  pickupLng: _zod.z.number(),
  pickupLabel: _zod.z.string().default(''),
  dropoffLat: _zod.z.number(),
  dropoffLng: _zod.z.number(),
  dropoffLabel: _zod.z.string().default(''),
  type: _zod.z.string().default('ON_DEMAND')
});
adminRouter.post('/trips/manual', (0, _validate.validate)({
  body: manualTripSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const body = req.body;
  const driver = await _Driver.Driver.findById(body.driverId);
  if (!driver) throw new _errors.NotFoundError('Driver');
  const guests = await _Guest.Guest.find({
    _id: {
      $in: body.guestIds
    }
  });
  const guestLineItems = guests.map(g => ({
    guestId: g._id.toString(),
    name: g.name,
    seats: g.groupSize,
    luggage: g.luggageCount
  }));
  const seats = guestLineItems.reduce((s, g) => s + g.seats, 0);
  const luggage = guestLineItems.reduce((s, g) => s + g.luggage, 0);
  const trip = await _TripService.TripService.createFromAssignment({
    type: body.type,
    driverId: body.driverId,
    entryIds: [],
    guests: guestLineItems,
    stops: [{
      kind: 'pickup',
      guestIds: body.guestIds,
      locationId: null,
      coordinates: {
        lat: body.pickupLat,
        lng: body.pickupLng
      },
      label: body.pickupLabel
    }, {
      kind: 'drop',
      guestIds: body.guestIds,
      locationId: null,
      coordinates: {
        lat: body.dropoffLat,
        lng: body.dropoffLng
      },
      label: body.dropoffLabel
    }],
    vehicleSnapshot: {
      number: driver.vehicle.number,
      model: driver.vehicle.model,
      seats: driver.capacity.seats,
      luggage: driver.capacity.luggage
    },
    capacityUsed: {
      seats,
      luggage
    },
    deadlineAt: new Date(Date.now() + 90 * 60_000),
    strategy: 'manual_override',
    score: 0,
    costBreakdown: {
      eta: 0,
      lateness: 0,
      priority: 0,
      idle: 0,
      capacityWaste: 0,
      breakUrgency: 0,
      rejectionHistory: 0,
      detour: 0,
      total: 0
    },
    candidatesConsidered: 1,
    decidedBy: req.user.sub,
    sourceRequestId: null
  });
  await audit(req, 'trip.manual_create', 'Trip', trip._id.toString(), null, trip.toJSON());
  res.status(201).json({
    ok: true,
    data: trip
  });
}));
const reassignSchema = _zod.z.object({
  driverId: _zod.z.string()
});
adminRouter.post('/trips/:id/reassign', (0, _validate.validate)({
  body: reassignSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const trip = await _Trip.Trip.findById(req.params.id);
  if (!trip) throw new _errors.NotFoundError('Trip');
  const newDriver = await _Driver.Driver.findById(req.body.driverId);
  if (!newDriver) throw new _errors.NotFoundError('Driver');
  const oldDriverId = trip.driverId?.toString();
  if (oldDriverId) await _TripService.TripService.releaseDriver(oldDriverId);
  const claimed = await _TripService.TripService.claimDriver(req.body.driverId, trip._id);
  if (!claimed) throw new _errors.ConflictError('Target driver is already on a trip');
  trip.driverId = newDriver._id;
  trip.vehicleSnapshot = {
    number: newDriver.vehicle.number,
    model: newDriver.vehicle.model,
    seats: newDriver.capacity.seats,
    luggage: newDriver.capacity.luggage
  };
  // Set the three fields by path rather than rebuilding the object with a
  // spread. `assignmentMeta` is a Mongoose nested path, not a plain object:
  // spreading it drops the nested `costBreakdown`, which then casts as
  // undefined and fails the whole save with a 500. Setting by path touches
  // only these keys, so the engine's original cost figures survive — they are
  // exactly what the "Why this driver?" explanation reads back.
  trip.set('assignmentMeta.strategy', 'manual_override');
  trip.set('assignmentMeta.decidedBy', req.user.sub);
  trip.set('assignmentMeta.decidedAt', new Date());
  trip.timeline.push({
    at: new Date(),
    type: 'reassigned',
    actor: req.user.sub,
    payload: {
      from: oldDriverId,
      to: req.body.driverId
    }
  });
  await trip.save();
  await audit(req, 'trip.reassign', 'Trip', trip._id.toString(), {
    driverId: oldDriverId
  }, {
    driverId: req.body.driverId
  });
  for (const g of trip.guests) {
    _NotificationService.NotificationService.tripAssigned(g.guestId.toString(), {
      trip: trip.toJSON(),
      driver: {
        name: newDriver.name,
        phone: newDriver.phone,
        vehicleNumber: newDriver.vehicle.number
      },
      etaSeconds: 0
    });
  }
  res.json({
    ok: true,
    data: trip
  });
}));
const cancelSchema = _zod.z.object({
  reason: _zod.z.string().min(1)
});
adminRouter.post('/trips/:id/cancel', (0, _validate.validate)({
  body: cancelSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const existing = await _Trip.Trip.findById(req.params.id);
  if (!existing) throw new _errors.NotFoundError('Trip');

  // Route handlers never set trip.status directly (plan.md §6.2) — go
  // through the state machine so an invalid transition (e.g. cancelling an
  // already-completed trip) surfaces as a 409 instead of silently
  // corrupting the trip.
  const trip = await _TripService.TripService.transition(req.params.id, 'cancelled', req.user.sub);
  trip.cancellationReason = req.body.reason;
  trip.timeline.push({
    at: new Date(),
    type: 'cancelled',
    actor: req.user.sub,
    payload: {
      reason: req.body.reason
    }
  });
  await trip.save();
  const guestIds = trip.guests.map(g => g.guestId.toString());
  await _TripService.TripService.requeueGuests(guestIds, 'admin_cancelled');
  if (trip.driverId) await _TripService.TripService.releaseDriver(trip.driverId.toString());
  await _QueueEntry.QueueEntry.updateMany({
    guestIds: {
      $in: guestIds
    }
  }, {
    $set: {
      status: 'waiting',
      enqueuedAt: new Date(Date.now() - 15 * 60_000)
    }
  });
  await audit(req, 'trip.cancel', 'Trip', trip._id.toString(), null, {
    reason: req.body.reason
  });
  _NotificationService.NotificationService.tripStatus(trip._id.toString(), {
    tripId: trip._id.toString(),
    status: 'cancelled',
    at: new Date().toISOString()
  });
  res.json({
    ok: true,
    data: trip
  });
}));

// ---------- Queue ----------

adminRouter.get('/queue', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const entries = await _QueueEntry.QueueEntry.find(filter).sort({
    priorityScore: -1
  });
  res.json({
    ok: true,
    data: entries
  });
}));
adminRouter.post('/queue/:id/boost', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const entry = await _QueueEntry.QueueEntry.findByIdAndUpdate(req.params.id, {
    $set: {
      priorityScore: 1000,
      enqueuedAt: new Date(Date.now() - 60 * 60_000)
    }
  }, {
    new: true
  });
  if (!entry) throw new _errors.NotFoundError('QueueEntry');
  await audit(req, 'queue.boost', 'QueueEntry', req.params.id);
  res.json({
    ok: true,
    data: entry
  });
}));

// ---------- Locations ----------

adminRouter.get('/locations', (0, _asyncHandler.asyncHandler)(async (_req, res) => {
  res.json({
    ok: true,
    data: await _Location.Location.find({}).sort({
      name: 1
    })
  });
}));
const createLocationSchema = _zod.z.object({
  name: _zod.z.string().min(1),
  type: _zod.z.enum(['airport', 'railway_station', 'accommodation', 'venue', 'custom']),
  address: _zod.z.string().default(''),
  lat: _zod.z.number(),
  lng: _zod.z.number(),
  geofenceRadiusM: _zod.z.number().default(150)
});
adminRouter.post('/locations', (0, _validate.validate)({
  body: createLocationSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const body = req.body;
  const location = await _Location.Location.create({
    name: body.name,
    type: body.type,
    address: body.address,
    coordinates: (0, _geo.toGeoPoint)({
      lat: body.lat,
      lng: body.lng
    }),
    geofenceRadiusM: body.geofenceRadiusM
  });
  await audit(req, 'location.create', 'Location', location._id.toString(), null, location.toJSON());
  res.status(201).json({
    ok: true,
    data: location
  });
}));
const updateLocationSchema = _zod.z.object({
  name: _zod.z.string().optional(),
  address: _zod.z.string().optional(),
  isActive: _zod.z.boolean().optional(),
  geofenceRadiusM: _zod.z.number().optional()
});
adminRouter.patch('/locations/:id', (0, _validate.validate)({
  body: updateLocationSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const location = await _Location.Location.findByIdAndUpdate(req.params.id, {
    $set: req.body
  }, {
    new: true
  });
  if (!location) throw new _errors.NotFoundError('Location');
  await audit(req, 'location.update', 'Location', req.params.id, null, location.toJSON());
  res.json({
    ok: true,
    data: location
  });
}));

// ---------- Config ----------

adminRouter.get('/config', (0, _asyncHandler.asyncHandler)(async (_req, res) => {
  const cfg = await _EventConfig.EventConfig.findOne({
    singleton: 'singleton'
  });
  if (!cfg) throw new _errors.NotFoundError('EventConfig');
  res.json({
    ok: true,
    data: cfg
  });
}));
const updateConfigSchema = _zod.z.object({
  dispatch: _zod.z.record(_zod.z.any()).optional(),
  traffic: _zod.z.record(_zod.z.any()).optional(),
  featureFlags: _zod.z.record(_zod.z.any()).optional()
});
adminRouter.patch('/config', (0, _validate.validate)({
  body: updateConfigSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const before = await _EventConfig.EventConfig.findOne({
    singleton: 'singleton'
  });
  if (!before) throw new _errors.NotFoundError('EventConfig');
  const patch = {};
  for (const [section, values] of Object.entries(req.body)) {
    for (const [key, value] of Object.entries(values)) {
      patch[`${section}.${key}`] = value;
    }
  }
  const cfg = await _EventConfig.EventConfig.findOneAndUpdate({
    singleton: 'singleton'
  }, {
    $set: patch
  }, {
    new: true
  });
  await audit(req, 'config.update', 'EventConfig', before._id.toString(), before.toJSON(), cfg?.toJSON());
  res.json({
    ok: true,
    data: cfg
  });
}));

// ---------- Alerts ----------

adminRouter.get('/alerts', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const filter = {};
  if (req.query.acknowledged !== undefined) filter.acknowledged = req.query.acknowledged === 'true';
  const alerts = await _Alert.Alert.find(filter).sort({
    createdAt: -1
  }).limit(200);
  res.json({
    ok: true,
    data: alerts
  });
}));
adminRouter.post('/alerts/:id/ack', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const alert = await _Alert.Alert.findByIdAndUpdate(req.params.id, {
    $set: {
      acknowledged: true,
      acknowledgedBy: req.user.sub,
      acknowledgedAt: new Date()
    }
  }, {
    new: true
  });
  if (!alert) throw new _errors.NotFoundError('Alert');
  res.json({
    ok: true,
    data: alert
  });
}));

// ---------- Analytics ----------

const WAIT_BUCKETS = [{
  label: '0-5',
  min: 0,
  max: 5
}, {
  label: '5-10',
  min: 5,
  max: 10
}, {
  label: '10-15',
  min: 10,
  max: 15
}, {
  label: '15-20',
  min: 15,
  max: 20
}, {
  label: '20-30',
  min: 20,
  max: 30
}, {
  label: '30+',
  min: 30,
  max: Infinity
}];

// Signed ETA error in minutes (predicted - actual): negative means the guest
// was told a shorter wait than they got.
const ETA_BUCKETS = [{
  label: '< -5',
  min: -Infinity,
  max: -5
}, {
  label: '-5..-2',
  min: -5,
  max: -2
}, {
  label: '-2..0',
  min: -2,
  max: 0
}, {
  label: '0..2',
  min: 0,
  max: 2
}, {
  label: '2..5',
  min: 2,
  max: 5
}, {
  label: '> 5',
  min: 5,
  max: Infinity
}];
function bucketise(buckets, values) {
  return buckets.map(b => ({
    bucket: b.label,
    count: values.filter(v => v >= b.min && v < b.max).length
  }));
}
adminRouter.get('/analytics', (0, _asyncHandler.asyncHandler)(async (_req, res) => {
  const completedTrips = await _Trip.Trip.find({
    status: 'completed'
  }).select('metrics assignmentMeta guests createdAt completedAt route driverId').lean();
  const waits = completedTrips.map(t => t.metrics?.guestWaitMinutes ?? 0).filter(n => n > 0);
  const sorted = [...waits].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
  const sharedTrips = completedTrips.filter(t => t.guests.length > 1);
  const sharedRidePct = completedTrips.length ? sharedTrips.length / completedTrips.length * 100 : 0;
  const byStrategy = {};
  for (const t of completedTrips) {
    const s = t.assignmentMeta?.strategy ?? 'unknown';
    byStrategy[s] = (byStrategy[s] ?? 0) + 1;
  }

  // Wait-time distribution — the shape matters more than the mean when
  // arrivals are bursty, because a good average can still hide a long tail.
  const waitDistribution = bucketise(WAIT_BUCKETS, waits);

  // ETA accuracy: metrics.etaAccuracySec is the signed predicted-minus-actual
  // error recorded at completion.
  const etaErrorsMin = completedTrips.map(t => (t.metrics?.etaAccuracySec ?? 0) / 60).filter(n => Number.isFinite(n));
  const etaAccuracyDistribution = bucketise(ETA_BUCKETS, etaErrorsMin);
  const withinTwoMin = etaErrorsMin.filter(e => Math.abs(e) <= 2).length;
  const etaWithin2MinPct = etaErrorsMin.length ? withinTwoMin / etaErrorsMin.length * 100 : 0;

  // Throughput over the last 12 hours — the utilisation curve.
  //
  // Buckets are keyed by absolute hour, not hour-of-day: grouping by
  // getHours() and sorting 0..23 puts last night's 22:00 bar to the right of
  // this morning's 01:00 one whenever the window straddles midnight. Empty
  // hours are emitted as zeroes so the line stays continuous instead of
  // interpolating across a quiet stretch.
  const HOURS_BACK = 12;
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  const buckets = [];
  const indexByKey = new Map();
  for (let i = HOURS_BACK - 1; i >= 0; i--) {
    const at = new Date(hourStart.getTime() - i * 60 * 60_000);
    indexByKey.set(at.getTime(), buckets.length);
    buckets.push({
      at,
      hour: `${String(at.getHours()).padStart(2, '0')}:00`,
      trips: 0,
      guests: 0
    });
  }
  for (const t of completedTrips) {
    const at = t.completedAt ?? t.createdAt;
    if (!at) continue;
    const slot = new Date(at);
    slot.setMinutes(0, 0, 0);
    const idx = indexByKey.get(slot.getTime());
    if (idx === undefined) continue; // older than the window
    buckets[idx].trips += 1;
    buckets[idx].guests += t.guests.length;
  }
  const tripsByHour = buckets.map(({
    hour,
    trips,
    guests
  }) => ({
    hour,
    trips,
    guests
  }));

  // Minutes saved by sharing. A shared trip carrying N guests replaces N
  // separate trips, so the saving is the (N-1) journeys not driven, less the
  // detour actually incurred to combine them. The baseline is the median
  // single-guest trip so one outlier airport run can't inflate it.
  const soloDurations = completedTrips.filter(t => t.guests.length === 1 && (t.route?.durationSeconds ?? 0) > 0).map(t => t.route.durationSeconds / 60).sort((a, b) => a - b);
  const medianSoloMin = soloDurations.length ? soloDurations[Math.floor(soloDurations.length / 2)] : 0;
  let detourSavedMin = 0;
  for (const t of sharedTrips) {
    detourSavedMin += (t.guests.length - 1) * medianSoloMin - (t.metrics?.detourAddedMin ?? 0);
  }
  detourSavedMin = Math.max(0, detourSavedMin);
  const driverCount = await _Driver.Driver.countDocuments({
    isActive: true
  });
  const busyDrivers = await _Driver.Driver.countDocuments({
    status: {
      $in: ['assigned', 'en_route_pickup', 'at_pickup', 'on_trip']
    }
  });

  // Per-driver completed-trip counts, so utilisation can be read as a
  // distribution rather than a single fleet-wide percentage.
  const driverDocs = await _Driver.Driver.find({
    isActive: true
  }).select('name stats').lean();
  const tripsPerDriver = driverDocs.map(d => ({
    name: d.name.split(' ')[0],
    trips: d.stats?.tripsCompleted ?? 0
  })).sort((a, b) => b.trips - a.trips);
  res.json({
    ok: true,
    data: {
      avgWaitMin: Number(avgWait.toFixed(1)),
      p95WaitMin: Number(p95.toFixed(1)),
      sharedRidePct: Number(sharedRidePct.toFixed(1)),
      driverUtilisationPct: driverCount ? Number((busyDrivers / driverCount * 100).toFixed(1)) : 0,
      assignmentsByStrategy: byStrategy,
      tripsCompleted: completedTrips.length,
      waitDistribution,
      etaAccuracyDistribution,
      etaWithin2MinPct: Number(etaWithin2MinPct.toFixed(1)),
      tripsByHour,
      tripsPerDriver,
      detourSavedMin: Math.round(detourSavedMin),
      sharedTripCount: sharedTrips.length
    }
  });
}));

// ---------- Audit ----------

adminRouter.get('/audit', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const pageSize = Math.min(100, Number(req.query.pageSize ?? 50));
  const [entries, total] = await Promise.all([_AuditLog.AuditLog.find({}).sort({
    at: -1
  }).skip((page - 1) * pageSize).limit(pageSize), _AuditLog.AuditLog.countDocuments({})]);
  res.json({
    ok: true,
    data: entries,
    meta: {
      page,
      pageSize,
      total
    }
  });
}));
