import { Router } from 'express';
import { z } from 'zod';
import { Guest } from '../models/Guest';
import { Trip } from '../models/Trip';
import { RideRequest } from '../models/RideRequest';
import { Location } from '../models/Location';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/errors';
import { toGeoPoint } from '../utils/geo';

export const guestRouter = Router();

guestRouter.use(requireAuth, requireRole('guest'));

function guestId(req: { user?: { guestId?: string } }): string {
  const id = req.user?.guestId;
  if (!id) throw new ForbiddenError('No guest identity on token');
  return id;
}

guestRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const guest = await Guest.findById(guestId(req)).populate('accommodationId').populate('arrival.pickupLocationId');
    if (!guest) throw new NotFoundError('Guest');
    res.json({ ok: true, data: guest });
  })
);

guestRouter.get(
  '/trip/current',
  asyncHandler(async (req, res) => {
    const guest = await Guest.findById(guestId(req));
    if (!guest) throw new NotFoundError('Guest');

    if (!guest.currentTripId) {
      res.json({ ok: true, data: null });
      return;
    }

    const trip = await Trip.findById(guest.currentTripId).populate('driverId');
    if (!trip) {
      res.json({ ok: true, data: null });
      return;
    }

    const coPassengers = trip.guests.filter((g) => g.guestId.toString() !== guestId(req));
    res.json({ ok: true, data: { trip, coPassengers: coPassengers.map((g) => ({ name: g.name })) } });
  })
);

guestRouter.get(
  '/trip/history',
  asyncHandler(async (req, res) => {
    const trips = await Trip.find({ 'guests.guestId': guestId(req), status: { $in: ['completed', 'cancelled'] } }).sort({
      createdAt: -1
    });
    res.json({ ok: true, data: trips });
  })
);

const createRequestSchema = z.object({
  pickupLocationId: z.string().optional(),
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  pickupLabel: z.string().default(''),
  dropoffLocationId: z.string().optional(),
  dropoffLat: z.number().optional(),
  dropoffLng: z.number().optional(),
  dropoffLabel: z.string().default(''),
  passengerCount: z.number().int().min(1).default(1),
  luggageCount: z.number().int().min(0).default(1),
  reason: z.string().default(''),
  notes: z.string().default('')
});

async function resolveCoordinates(locationId: string | undefined, lat: number | undefined, lng: number | undefined) {
  if (locationId) {
    const loc = await Location.findById(locationId);
    if (!loc) throw new NotFoundError('Location');
    return { locationId: loc._id, coordinates: loc.coordinates };
  }
  if (typeof lat === 'number' && typeof lng === 'number') {
    return { locationId: null, coordinates: toGeoPoint({ lat, lng }) };
  }
  throw new NotFoundError('Location');
}

guestRouter.post(
  '/requests',
  validate({ body: createRequestSchema }),
  asyncHandler(async (req, res) => {
    const gid = guestId(req);

    const existing = await RideRequest.findOne({ guestId: gid, status: 'pending_approval' });
    if (existing) throw new ConflictError('A ride request is already pending approval');

    const body = req.body as z.infer<typeof createRequestSchema>;
    const pickup = await resolveCoordinates(body.pickupLocationId, body.pickupLat, body.pickupLng);
    const dropoff = await resolveCoordinates(body.dropoffLocationId, body.dropoffLat, body.dropoffLng);

    const request = await RideRequest.create({
      guestId: gid,
      pickup: { locationId: pickup.locationId, coordinates: pickup.coordinates, label: body.pickupLabel },
      dropoff: { locationId: dropoff.locationId, coordinates: dropoff.coordinates, label: body.dropoffLabel },
      passengerCount: body.passengerCount,
      luggageCount: body.luggageCount,
      reason: body.reason,
      notes: body.notes,
      status: 'pending_approval',
      expiresAt: new Date(Date.now() + 30 * 60_000)
    });

    await Guest.updateOne({ _id: gid }, { $set: { status: 'queued', waitingSince: new Date() } });

    res.status(201).json({ ok: true, data: request });
  })
);

guestRouter.get(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const request = await RideRequest.findOne({ _id: req.params.id, guestId: guestId(req) });
    if (!request) throw new NotFoundError('Request');
    res.json({ ok: true, data: request });
  })
);

guestRouter.delete(
  '/requests/:id',
  asyncHandler(async (req, res) => {
    const request = await RideRequest.findOne({ _id: req.params.id, guestId: guestId(req) });
    if (!request) throw new NotFoundError('Request');
    if (request.status !== 'pending_approval') throw new ConflictError('Only a pending request can be cancelled');

    request.status = 'expired';
    await request.save();
    res.json({ ok: true, data: request });
  })
);

const pushSubscribeSchema = z.object({ subscription: z.record(z.any()) });

guestRouter.post(
  '/push/subscribe',
  validate({ body: pushSubscribeSchema }),
  asyncHandler(async (req, res) => {
    await Guest.updateOne({ _id: guestId(req) }, { $set: { pushSubscription: req.body.subscription } });
    res.json({ ok: true, data: { subscribed: true } });
  })
);

const rateSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().optional() });

guestRouter.post(
  '/trip/:id/rate',
  validate({ body: rateSchema }),
  asyncHandler(async (req, res) => {
    const trip = await Trip.findOne({ _id: req.params.id, 'guests.guestId': guestId(req) });
    if (!trip) throw new NotFoundError('Trip');
    if (trip.status !== 'completed') throw new ConflictError('Only a completed trip can be rated');

    trip.timeline.push({ at: new Date(), type: 'rated', actor: guestId(req), payload: req.body });
    await trip.save();
    res.json({ ok: true, data: { rated: true } });
  })
);
