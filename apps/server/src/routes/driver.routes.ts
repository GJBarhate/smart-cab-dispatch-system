import { Router } from 'express';
import { z } from 'zod';
import { Driver } from '../models/Driver';
import { Trip } from '../models/Trip';
import { Guest } from '../models/Guest';
import { QueueEntry } from '../models/QueueEntry';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { NotFoundError, ConflictError, ForbiddenError, StaleSessionError } from '../utils/errors';
import { toGeoPoint } from '../utils/geo';
import { TripService } from '../services/dispatch/TripService';
import { NotificationService } from '../services/NotificationService';
import { RoutingService } from '../services/routing/RoutingService';

export const driverRouter = Router();

driverRouter.use(requireAuth, requireRole('driver'));

function driverId(req: { user?: { driverId?: string } }): string {
  const id = req.user?.driverId;
  if (!id) throw new ForbiddenError('No driver identity on token');
  return id;
}

driverRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const driver = await Driver.findById(driverId(req));
    if (!driver) throw new StaleSessionError('Driver');
    res.json({ ok: true, data: driver });
  })
);

const statusSchema = z.object({ action: z.enum(['online', 'offline', 'request_break']) });

driverRouter.patch(
  '/status',
  validate({ body: statusSchema }),
  asyncHandler(async (req, res) => {
    const did = driverId(req);
    const { action } = req.body as z.infer<typeof statusSchema>;

    if (action === 'online') {
      await Driver.updateOne({ _id: did }, { $set: { status: 'idle' } });
    } else if (action === 'offline') {
      await Driver.updateOne({ _id: did }, { $set: { status: 'offline' } });
    } else {
      const driver = await Driver.findById(did);
      if (!driver) throw new StaleSessionError('Driver');
      if (driver.currentTripId) throw new ConflictError('Cannot break while on a trip');

      const until = new Date(Date.now() + (driver.break?.tripsSinceBreak ? 20 : 20) * 60_000);
      await Driver.updateOne(
        { _id: did },
        { $set: { status: 'on_break', 'break.onBreakUntil': until, 'break.tripsSinceBreak': 0 } }
      );
      NotificationService.driverBreak(did, { driverId: did, until: until.toISOString(), reason: 'requested' });
    }

    const driver = await Driver.findById(did);
    res.json({ ok: true, data: driver });
  })
);

driverRouter.get(
  '/trip/current',
  asyncHandler(async (req, res) => {
    const did = driverId(req);
    const driver = await Driver.findById(did);
    if (!driver?.currentTripId) throw new NotFoundError('Trip');

    const trip = await Trip.findOne({ _id: driver.currentTripId, driverId: did });
    if (!trip) throw new NotFoundError('Trip');
    res.json({ ok: true, data: trip });
  })
);

async function findOwnTrip(tripId: string, did: string) {
  const trip = await Trip.findOne({ _id: tripId, driverId: did });
  if (!trip) throw new NotFoundError('Trip');
  return trip;
}

driverRouter.post(
  '/trip/:id/accept',
  asyncHandler(async (req, res) => {
    const did = driverId(req);
    await findOwnTrip(req.params.id, did);

    // The driver is expected to start moving immediately on accept, so the
    // trip advances straight through ACCEPTED to EN_ROUTE_PICKUP in one call —
    // there's no separate "start driving" action in the API surface (§9.3).
    await TripService.transition(req.params.id, 'accepted', did);
    const trip = await TripService.transition(req.params.id, 'en_route_pickup', did);
    await Driver.updateOne({ _id: did }, { $set: { status: 'en_route_pickup' } });

    const firstStop = trip.stops.find((s) => s.status === 'pending');
    let etaSeconds = 0;
    if (firstStop) {
      const driver = await Driver.findById(did);
      if (driver) {
        const eta = await RoutingService.eta(
          { lat: driver.currentLocation!.coordinates[1], lng: driver.currentLocation!.coordinates[0] },
          { lat: firstStop.coordinates.coordinates[1], lng: firstStop.coordinates.coordinates[0] }
        );
        etaSeconds = eta.durationSeconds;
      }
    }

    for (const g of trip.guests) {
      NotificationService.tripAssigned(g.guestId.toString(), {
        trip: trip.toJSON(),
        driver: { name: trip.vehicleSnapshot?.model ?? '', phone: '', vehicleNumber: trip.vehicleSnapshot?.number ?? '' },
        etaSeconds
      });
    }
    NotificationService.tripStatus(trip._id.toString(), { tripId: trip._id.toString(), status: trip.status, at: new Date().toISOString() });

    res.json({ ok: true, data: trip });
  })
);

const rejectSchema = z.object({ reason: z.string().min(1) });

driverRouter.post(
  '/trip/:id/reject',
  validate({ body: rejectSchema }),
  asyncHandler(async (req, res) => {
    const did = driverId(req);
    const existing = await findOwnTrip(req.params.id, did);
    const { reason } = req.body as z.infer<typeof rejectSchema>;

    const trip = await TripService.transition(req.params.id, 'rejected', did);
    trip.rejectionReason = reason;
    await trip.save();

    const guestIds = existing.guests.map((g) => g.guestId);
    await TripService.releaseDriver(did);

    // Blacklist this driver against the QueueEntry id(s) that fed this trip —
    // Feasibility.check compares rejectedEntryIds against demand.id, which is
    // the QueueEntry id, not a guest id.
    const entries = await QueueEntry.find({ guestIds: { $in: guestIds }, status: 'assigned' });
    await Driver.updateOne(
      { _id: did },
      { $push: { rejectedEntryIds: { $each: entries.map((e) => e._id) } }, $inc: { 'stats.rejections': 1 } }
    );

    for (const entry of entries) {
      await QueueEntry.updateOne(
        { _id: entry._id },
        {
          $set: { status: 'waiting', enqueuedAt: new Date(Date.now() - 15 * 60_000) },
          $push: { rejectedDriverIds: did }
        }
      );
    }
    await TripService.requeueGuests(
      guestIds.map((g) => g.toString()),
      'driver_rejected'
    );

    NotificationService.tripStatus(trip._id.toString(), { tripId: trip._id.toString(), status: 'rejected', at: new Date().toISOString() });

    res.json({ ok: true, data: trip });
  })
);

driverRouter.post(
  '/trip/:id/arrived',
  asyncHandler(async (req, res) => {
    const did = driverId(req);
    const existing = await findOwnTrip(req.params.id, did);
    const nextStop = existing.stops.find((s) => s.status === 'pending');
    if (!nextStop) throw new ConflictError('No pending stop to arrive at');

    const trip = await TripService.transition(req.params.id, 'at_pickup', did);
    const stopDoc = trip.stops.find((s) => s.seq === nextStop.seq);
    if (stopDoc) {
      stopDoc.status = 'arrived';
      stopDoc.actualAt = new Date();
    }
    await trip.save();

    NotificationService.tripStatus(trip._id.toString(), { tripId: trip._id.toString(), status: 'at_pickup', at: new Date().toISOString(), stopSeq: nextStop.seq });
    res.json({ ok: true, data: trip });
  })
);

const boardSchema = z.object({ guestIds: z.array(z.string()).min(1) });

driverRouter.post(
  '/trip/:id/board',
  validate({ body: boardSchema }),
  asyncHandler(async (req, res) => {
    const did = driverId(req);
    await findOwnTrip(req.params.id, did);
    const { guestIds } = req.body as z.infer<typeof boardSchema>;

    const trip = await TripService.transition(req.params.id, 'boarded', did);
    const now = new Date();
    for (const g of trip.guests) {
      if (guestIds.includes(g.guestId.toString())) g.boardedAt = now;
    }
    for (const stop of trip.stops) {
      if (stop.kind === 'pickup' && stop.guestIds.some((g) => guestIds.includes(g.toString()))) {
        stop.status = 'done';
        stop.actualAt = now;
      }
    }
    await trip.save();
    await Guest.updateMany({ _id: { $in: guestIds } }, { $set: { status: 'in_transit' } });

    NotificationService.tripStatus(trip._id.toString(), { tripId: trip._id.toString(), status: 'boarded', at: now.toISOString() });
    res.json({ ok: true, data: trip });
  })
);

const dropSchema = z.object({ guestIds: z.array(z.string()).min(1), stopSeq: z.number().int() });

driverRouter.post(
  '/trip/:id/drop',
  validate({ body: dropSchema }),
  asyncHandler(async (req, res) => {
    const did = driverId(req);
    const trip = await findOwnTrip(req.params.id, did);
    const { guestIds, stopSeq } = req.body as z.infer<typeof dropSchema>;

    const now = new Date();
    const stop = trip.stops.find((s) => s.seq === stopSeq);
    if (!stop) throw new NotFoundError('Stop');
    stop.status = 'done';
    stop.actualAt = now;

    for (const g of trip.guests) {
      if (guestIds.includes(g.guestId.toString())) g.droppedAt = now;
    }

    const allDropsDone = trip.stops.filter((s) => s.kind === 'drop').every((s) => s.status === 'done');

    if (allDropsDone) {
      await trip.save();
      const completed = await TripService.transition(req.params.id, 'completed', did);
      await Guest.updateMany({ _id: { $in: trip.guests.map((g) => g.guestId) } }, { $set: { status: 'completed', currentTripId: null } });
      await Driver.updateOne(
        { _id: did },
        { $set: { status: 'idle', currentTripId: null }, $inc: { 'stats.tripsCompleted': 1, 'stats.guestsServed': trip.guests.length } }
      );
      NotificationService.tripStatus(completed._id.toString(), { tripId: completed._id.toString(), status: 'completed', at: now.toISOString(), stopSeq });
      res.json({ ok: true, data: completed });
      return;
    }

    await trip.save();
    await Guest.updateMany({ _id: { $in: guestIds } }, { $set: { status: 'completed', currentTripId: null } });
    NotificationService.tripStatus(trip._id.toString(), { tripId: trip._id.toString(), status: trip.status, at: now.toISOString(), stopSeq });
    res.json({ ok: true, data: trip });
  })
);

const locationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  heading: z.number().optional(),
  speed: z.number().optional()
});

driverRouter.post(
  '/location',
  validate({ body: locationSchema }),
  asyncHandler(async (req, res) => {
    const did = driverId(req);
    const { lat, lng, heading, speed } = req.body as z.infer<typeof locationSchema>;
    await Driver.updateOne(
      { _id: did },
      { $set: { currentLocation: toGeoPoint({ lat, lng }), locationUpdatedAt: new Date(), heading: heading ?? 0, speedKmph: speed ?? 0 } }
    );
    res.json({ ok: true, data: { updated: true } });
  })
);

driverRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const driver = await Driver.findById(driverId(req));
    if (!driver) throw new StaleSessionError('Driver');

    const tripsToday = await Trip.countDocuments({
      driverId: driver._id,
      status: 'completed',
      completedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
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
  })
);
