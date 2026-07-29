"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.guestRouter = void 0;
var _express = require("express");
var _zod = require("zod");
var _Guest = require("../models/Guest");
var _Trip = require("../models/Trip");
var _RideRequest = require("../models/RideRequest");
var _Location = require("../models/Location");
var _asyncHandler = require("../middleware/asyncHandler");
var _validate = require("../middleware/validate");
var _auth = require("../middleware/auth");
var _errors = require("../utils/errors");
var _geo = require("../utils/geo");
const guestRouter = (0, _express.Router)();
exports.guestRouter = guestRouter;
guestRouter.use(_auth.requireAuth, (0, _auth.requireRole)('guest'));
function guestId(req) {
  const id = req.user?.guestId;
  if (!id) throw new _errors.ForbiddenError('No guest identity on token');
  return id;
}

// Read-only, structured location list so the guest app's "Request a ride" screen
// can offer a picker (venue / airport / station / other accommodations) instead
// of letting a guest free-type coordinates. No dispatch/matching code is touched.
guestRouter.get('/locations', (0, _asyncHandler.asyncHandler)(async (_req, res) => {
  const locations = await _Location.Location.find({
    isActive: true
  }).select('name type address coordinates').sort({
    type: 1,
    name: 1
  });
  res.json({
    ok: true,
    data: locations
  });
}));
guestRouter.get('/me', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const guest = await _Guest.Guest.findById(guestId(req)).populate('accommodationId').populate('arrival.pickupLocationId');
  if (!guest) throw new _errors.StaleSessionError('Guest');
  res.json({
    ok: true,
    data: guest
  });
}));
guestRouter.get('/trip/current', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const guest = await _Guest.Guest.findById(guestId(req));
  if (!guest) throw new _errors.StaleSessionError('Guest');
  if (!guest.currentTripId) {
    res.json({
      ok: true,
      data: null
    });
    return;
  }
  const trip = await _Trip.Trip.findById(guest.currentTripId).populate('driverId');
  if (!trip) {
    res.json({
      ok: true,
      data: null
    });
    return;
  }
  const coPassengers = trip.guests.filter(g => g.guestId.toString() !== guestId(req));
  res.json({
    ok: true,
    data: {
      trip,
      coPassengers: coPassengers.map(g => ({
        name: g.name
      }))
    }
  });
}));
guestRouter.get('/trip/history', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const trips = await _Trip.Trip.find({
    'guests.guestId': guestId(req),
    status: {
      $in: ['completed', 'cancelled']
    }
  }).sort({
    createdAt: -1
  });
  res.json({
    ok: true,
    data: trips
  });
}));
const createRequestSchema = _zod.z.object({
  pickupLocationId: _zod.z.string().optional(),
  pickupLat: _zod.z.number().optional(),
  pickupLng: _zod.z.number().optional(),
  pickupLabel: _zod.z.string().default(''),
  dropoffLocationId: _zod.z.string().optional(),
  dropoffLat: _zod.z.number().optional(),
  dropoffLng: _zod.z.number().optional(),
  dropoffLabel: _zod.z.string().default(''),
  passengerCount: _zod.z.number().int().min(1).default(1),
  luggageCount: _zod.z.number().int().min(0).default(1),
  reason: _zod.z.string().default(''),
  notes: _zod.z.string().default('')
});
async function resolveCoordinates(locationId, lat, lng) {
  if (locationId) {
    const loc = await _Location.Location.findById(locationId);
    if (!loc) throw new _errors.NotFoundError('Location');
    return {
      locationId: loc._id,
      coordinates: loc.coordinates
    };
  }
  if (typeof lat === 'number' && typeof lng === 'number') {
    return {
      locationId: null,
      coordinates: (0, _geo.toGeoPoint)({
        lat,
        lng
      })
    };
  }
  throw new _errors.NotFoundError('Location');
}
guestRouter.post('/requests', (0, _validate.validate)({
  body: createRequestSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const gid = guestId(req);
  const existing = await _RideRequest.RideRequest.findOne({
    guestId: gid,
    status: 'pending_approval'
  });
  if (existing) throw new _errors.ConflictError('A ride request is already pending approval');
  const body = req.body;
  const pickup = await resolveCoordinates(body.pickupLocationId, body.pickupLat, body.pickupLng);
  const dropoff = await resolveCoordinates(body.dropoffLocationId, body.dropoffLat, body.dropoffLng);
  const request = await _RideRequest.RideRequest.create({
    guestId: gid,
    pickup: {
      locationId: pickup.locationId,
      coordinates: pickup.coordinates,
      label: body.pickupLabel
    },
    dropoff: {
      locationId: dropoff.locationId,
      coordinates: dropoff.coordinates,
      label: body.dropoffLabel
    },
    passengerCount: body.passengerCount,
    luggageCount: body.luggageCount,
    reason: body.reason,
    notes: body.notes,
    status: 'pending_approval',
    expiresAt: new Date(Date.now() + 30 * 60_000)
  });
  await _Guest.Guest.updateOne({
    _id: gid
  }, {
    $set: {
      status: 'queued',
      waitingSince: new Date()
    }
  });
  res.status(201).json({
    ok: true,
    data: request
  });
}));
guestRouter.get('/requests/:id', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const request = await _RideRequest.RideRequest.findOne({
    _id: req.params.id,
    guestId: guestId(req)
  });
  if (!request) throw new _errors.NotFoundError('Request');
  res.json({
    ok: true,
    data: request
  });
}));
guestRouter.delete('/requests/:id', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const request = await _RideRequest.RideRequest.findOne({
    _id: req.params.id,
    guestId: guestId(req)
  });
  if (!request) throw new _errors.NotFoundError('Request');
  if (request.status !== 'pending_approval') throw new _errors.ConflictError('Only a pending request can be cancelled');
  request.status = 'expired';
  await request.save();
  // The guest's status was flipped to 'queued' when the request was
  // raised (POST /requests) — revert it now that nothing is pending.
  await _Guest.Guest.updateOne({
    _id: guestId(req),
    status: 'queued'
  }, {
    $set: {
      status: 'registered'
    }
  });
  res.json({
    ok: true,
    data: request
  });
}));
const pushSubscribeSchema = _zod.z.object({
  subscription: _zod.z.record(_zod.z.any())
});
guestRouter.post('/push/subscribe', (0, _validate.validate)({
  body: pushSubscribeSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  await _Guest.Guest.updateOne({
    _id: guestId(req)
  }, {
    $set: {
      pushSubscription: req.body.subscription
    }
  });
  res.json({
    ok: true,
    data: {
      subscribed: true
    }
  });
}));
const rateSchema = _zod.z.object({
  rating: _zod.z.number().int().min(1).max(5),
  comment: _zod.z.string().optional()
});
guestRouter.post('/trip/:id/rate', (0, _validate.validate)({
  body: rateSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const trip = await _Trip.Trip.findOne({
    _id: req.params.id,
    'guests.guestId': guestId(req)
  });
  if (!trip) throw new _errors.NotFoundError('Trip');
  if (trip.status !== 'completed') throw new _errors.ConflictError('Only a completed trip can be rated');
  trip.timeline.push({
    at: new Date(),
    type: 'rated',
    actor: guestId(req),
    payload: req.body
  });
  await trip.save();
  res.json({
    ok: true,
    data: {
      rated: true
    }
  });
}));
