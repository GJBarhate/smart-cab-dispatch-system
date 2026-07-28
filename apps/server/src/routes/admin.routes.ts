import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { parse as parseCsv } from 'csv-parse/sync';
import { User } from '../models/User';
import { Driver } from '../models/Driver';
import { Guest } from '../models/Guest';
import { Location } from '../models/Location';
import { EventConfig } from '../models/EventConfig';
import { Trip } from '../models/Trip';
import { RideRequest } from '../models/RideRequest';
import { QueueEntry } from '../models/QueueEntry';
import { Alert } from '../models/Alert';
import { AuditLog } from '../models/AuditLog';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { NotFoundError, ConflictError } from '../utils/errors';
import { toGeoPoint } from '../utils/geo';
import { env } from '../config/env';
import { TripService } from '../services/dispatch/TripService';
import { DispatchEngine } from '../services/dispatch/DispatchEngine';
import { AuditService } from '../services/AuditService';
import { NotificationService } from '../services/NotificationService';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

function audit(req: any, action: string, entityType: string, entityId: string | null, before?: unknown, after?: unknown) {
  return AuditService.log({ actorId: req.user.sub, actorRole: 'admin', action, entityType, entityId, before, after, ip: req.ip });
}

// ---------- Dashboard ----------

adminRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [guestsByStatus, driversByStatus, queueDepth, unassignableCount, tripsToday, alerts] = await Promise.all([
      Guest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Driver.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      QueueEntry.countDocuments({ status: 'waiting' }),
      QueueEntry.countDocuments({ status: 'failed' }),
      Trip.countDocuments({ status: 'completed', completedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
      Alert.find({ acknowledged: false }).sort({ createdAt: -1 }).limit(20)
    ]);

    const waitingEntries = await QueueEntry.find({ status: 'waiting' }).select('enqueuedAt').lean();
    const now = Date.now();
    const waitMinutes = waitingEntries.map((e) => (now - new Date(e.enqueuedAt as any).getTime()) / 60_000);
    const avgWaitMin = waitMinutes.length ? waitMinutes.reduce((a, b) => a + b, 0) / waitMinutes.length : 0;
    const oldestWaitMin = waitMinutes.length ? Math.max(...waitMinutes) : 0;

    const liveDrivers = await Driver.find({ isActive: true }).select('name status currentLocation heading vehicle');

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
        guestsByStatus: Object.fromEntries(guestsByStatus.map((g: any) => [g._id, g.count])),
        driversByStatus: Object.fromEntries(driversByStatus.map((d: any) => [d._id, d.count])),
        liveDrivers,
        alerts
      }
    });
  })
);

// ---------- Drivers ----------

adminRouter.get(
  '/drivers',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    const drivers = await Driver.find(filter).sort({ name: 1 });
    res.json({ ok: true, data: drivers });
  })
);

const createDriverSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  licenseNo: z.string().default(''),
  vehicleNumber: z.string().min(1),
  vehicleModel: z.string().default(''),
  vehicleColour: z.string().default(''),
  vehicleType: z.enum(['sedan', 'suv', 'tempo', 'bus']),
  seats: z.number().int().min(1),
  luggage: z.number().int().min(0),
  shiftStartAt: z.string().optional(),
  shiftEndAt: z.string().optional()
});

function randomPassword(): string {
  return Math.random().toString(36).slice(-8) + '!1A';
}

adminRouter.post(
  '/drivers',
  validate({ body: createDriverSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createDriverSchema>;
    const password = randomPassword();
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    const user = await User.create({ name: body.name, phone: body.phone, role: 'driver', passwordHash, isActive: true });
    const driver = await Driver.create({
      userId: user._id,
      name: body.name,
      phone: body.phone,
      licenseNo: body.licenseNo,
      vehicle: { number: body.vehicleNumber, model: body.vehicleModel, colour: body.vehicleColour, type: body.vehicleType },
      capacity: { seats: body.seats, luggage: body.luggage },
      status: 'offline',
      shift: {
        startAt: body.shiftStartAt ? new Date(body.shiftStartAt) : null,
        endAt: body.shiftEndAt ? new Date(body.shiftEndAt) : null
      },
      isActive: true
    });
    await User.updateOne({ _id: user._id }, { $set: { driverId: driver._id } });

    await audit(req, 'driver.create', 'Driver', driver._id.toString(), null, driver.toJSON());
    res.status(201).json({ ok: true, data: { driver, generatedPassword: password } });
  })
);

const updateDriverSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),
  status: z.enum(['offline', 'idle', 'suspended']).optional(),
  capacity: z.object({ seats: z.number().int().min(1), luggage: z.number().int().min(0) }).optional()
});

adminRouter.patch(
  '/drivers/:id',
  validate({ body: updateDriverSchema }),
  asyncHandler(async (req, res) => {
    const before = await Driver.findById(req.params.id);
    if (!before) throw new NotFoundError('Driver');

    const driver = await Driver.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });

    if (req.body.status === 'suspended' && before.currentTripId) {
      const trip = await Trip.findById(before.currentTripId);
      if (trip) {
        const guestIds = trip.guests.map((g) => g.guestId.toString());
        await TripService.requeueGuests(guestIds, 'driver_suspended');
        await Trip.updateOne({ _id: trip._id }, { $set: { status: 'cancelled', cancellationReason: 'driver_suspended', cancelledAt: new Date() } });
        await QueueEntry.updateMany({ guestIds: { $in: guestIds } }, { $set: { status: 'waiting', enqueuedAt: new Date(Date.now() - 15 * 60_000) } });
      }
    }

    await audit(req, 'driver.update', 'Driver', req.params.id, before.toJSON(), driver?.toJSON());
    res.json({ ok: true, data: driver });
  })
);

adminRouter.post(
  '/drivers/:id/break',
  asyncHandler(async (req, res) => {
    const minutes = 20;
    const until = new Date(Date.now() + minutes * 60_000);
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'on_break', 'break.onBreakUntil': until, 'break.tripsSinceBreak': 0 } },
      { new: true }
    );
    if (!driver) throw new NotFoundError('Driver');

    NotificationService.driverBreak(req.params.id, { driverId: req.params.id, until: until.toISOString(), reason: 'admin_forced' });
    await audit(req, 'driver.break', 'Driver', req.params.id, null, { until });
    res.json({ ok: true, data: driver });
  })
);

// ---------- Guests ----------

adminRouter.get(
  '/guests',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.accommodationId) filter.accommodationId = req.query.accommodationId;
    const guests = await Guest.find(filter).sort({ createdAt: -1 }).limit(500);
    res.json({ ok: true, data: guests });
  })
);

const createGuestSchema = z.object({
  bookingRef: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().optional(),
  groupSize: z.number().int().min(1).default(1),
  luggageCount: z.number().int().min(0).default(1),
  isVip: z.boolean().default(false),
  accommodationId: z.string().optional(),
  specialNeeds: z.string().default('')
});

adminRouter.post(
  '/guests',
  validate({ body: createGuestSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createGuestSchema>;
    const guest = await Guest.create({
      ...body,
      priorityTier: body.isVip ? 3 : 1,
      status: 'registered'
    });
    await audit(req, 'guest.create', 'Guest', guest._id.toString(), null, guest.toJSON());
    res.status(201).json({ ok: true, data: guest });
  })
);

const updateGuestSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  accommodationId: z.string().optional(),
  arrival: z.record(z.any()).optional(),
  departure: z.record(z.any()).optional(),
  specialNeeds: z.string().optional()
});

adminRouter.patch(
  '/guests/:id',
  validate({ body: updateGuestSchema }),
  asyncHandler(async (req, res) => {
    const before = await Guest.findById(req.params.id);
    if (!before) throw new NotFoundError('Guest');

    const guest = await Guest.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });

    // Arrival-detail changes invalidate any waiting queue entry's timing —
    // re-queue at boosted priority rather than let it dispatch against stale data.
    if (req.body.arrival) {
      await QueueEntry.updateMany(
        { guestIds: req.params.id, status: 'waiting' },
        { $set: { enqueuedAt: new Date(Date.now() - 10 * 60_000) } }
      );
    }

    await audit(req, 'guest.update', 'Guest', req.params.id, before.toJSON(), guest?.toJSON());
    res.json({ ok: true, data: guest });
  })
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

adminRouter.post(
  '/guests/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ConflictError('No file uploaded (field name: file)');

    const rows: Array<Record<string, string>> = parseCsv(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });

    let created = 0;
    const errors: Array<{ row: number; message: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const existing = await Guest.findOne({ bookingRef: row.bookingRef?.toUpperCase() });
        if (existing) continue;

        await Guest.create({
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
        errors.push({ row: i + 1, message: err instanceof Error ? err.message : 'unknown error' });
      }
    }

    await audit(req, 'guest.import', 'Guest', null, null, { created, errors: errors.length });
    res.json({ ok: true, data: { created, errors } });
  })
);

// ---------- On-demand requests ----------

adminRouter.get(
  '/requests',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    const requests = await RideRequest.find(filter).sort({ requestedAt: 1 }).populate('guestId');
    res.json({ ok: true, data: requests });
  })
);

adminRouter.post(
  '/requests/:id/approve',
  asyncHandler(async (req, res) => {
    const request = await RideRequest.findById(req.params.id);
    if (!request) throw new NotFoundError('Request');
    if (request.status !== 'pending_approval') throw new ConflictError('Request already decided');

    const guest = await Guest.findById(request.guestId);
    if (!guest) throw new NotFoundError('Guest');

    const now = new Date();
    const entry = await QueueEntry.create({
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
    request.decidedBy = req.user!.sub as any;
    request.decidedAt = now;
    await request.save();

    await audit(req, 'request.approve', 'RideRequest', request._id.toString(), null, { entryId: entry._id.toString() });

    const matched = await DispatchEngine.matchEntryNow(entry._id.toString(), 'greedy_realtime');
    if (matched) {
      const freshGuest = await Guest.findById(guest._id);
      request.status = 'matched';
      request.tripId = (freshGuest?.currentTripId ?? null) as any;
      await request.save();
    }

    NotificationService.requestStatus(guest._id.toString(), { requestId: request._id.toString(), status: request.status });
    res.json({ ok: true, data: request });
  })
);

const declineSchema = z.object({ reason: z.string().min(1) });

adminRouter.post(
  '/requests/:id/decline',
  validate({ body: declineSchema }),
  asyncHandler(async (req, res) => {
    const request = await RideRequest.findById(req.params.id);
    if (!request) throw new NotFoundError('Request');
    if (request.status !== 'pending_approval') throw new ConflictError('Request already decided');

    request.status = 'declined';
    request.declineReason = req.body.reason;
    request.decidedBy = req.user!.sub as any;
    request.decidedAt = new Date();
    await request.save();

    await Guest.updateOne({ _id: request.guestId }, { $set: { status: 'registered' } });
    await audit(req, 'request.decline', 'RideRequest', request._id.toString(), null, { reason: req.body.reason });

    NotificationService.requestStatus(request.guestId.toString(), { requestId: request._id.toString(), status: 'declined', reason: req.body.reason });
    res.json({ ok: true, data: request });
  })
);

// ---------- Trips ----------

adminRouter.get(
  '/trips',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    const trips = await Trip.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ ok: true, data: trips });
  })
);

const manualTripSchema = z.object({
  driverId: z.string(),
  guestIds: z.array(z.string()).min(1),
  pickupLat: z.number(),
  pickupLng: z.number(),
  pickupLabel: z.string().default(''),
  dropoffLat: z.number(),
  dropoffLng: z.number(),
  dropoffLabel: z.string().default(''),
  type: z.string().default('ON_DEMAND')
});

adminRouter.post(
  '/trips/manual',
  validate({ body: manualTripSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof manualTripSchema>;
    const driver = await Driver.findById(body.driverId);
    if (!driver) throw new NotFoundError('Driver');

    const guests = await Guest.find({ _id: { $in: body.guestIds } });
    const guestLineItems = guests.map((g) => ({ guestId: g._id.toString(), name: g.name, seats: g.groupSize, luggage: g.luggageCount }));
    const seats = guestLineItems.reduce((s, g) => s + g.seats, 0);
    const luggage = guestLineItems.reduce((s, g) => s + g.luggage, 0);

    const trip = await TripService.createFromAssignment({
      type: body.type,
      driverId: body.driverId,
      entryIds: [],
      guests: guestLineItems,
      stops: [
        { kind: 'pickup', guestIds: body.guestIds, locationId: null, coordinates: { lat: body.pickupLat, lng: body.pickupLng }, label: body.pickupLabel },
        { kind: 'drop', guestIds: body.guestIds, locationId: null, coordinates: { lat: body.dropoffLat, lng: body.dropoffLng }, label: body.dropoffLabel }
      ],
      vehicleSnapshot: { number: driver.vehicle!.number, model: driver.vehicle!.model, seats: driver.capacity!.seats, luggage: driver.capacity!.luggage },
      capacityUsed: { seats, luggage },
      deadlineAt: new Date(Date.now() + 90 * 60_000),
      strategy: 'manual_override',
      score: 0,
      costBreakdown: { eta: 0, lateness: 0, priority: 0, idle: 0, capacityWaste: 0, breakUrgency: 0, rejectionHistory: 0, detour: 0, total: 0 },
      candidatesConsidered: 1,
      decidedBy: req.user!.sub,
      sourceRequestId: null
    });

    await audit(req, 'trip.manual_create', 'Trip', trip._id.toString(), null, trip.toJSON());
    res.status(201).json({ ok: true, data: trip });
  })
);

const reassignSchema = z.object({ driverId: z.string() });

adminRouter.post(
  '/trips/:id/reassign',
  validate({ body: reassignSchema }),
  asyncHandler(async (req, res) => {
    const trip = await Trip.findById(req.params.id);
    if (!trip) throw new NotFoundError('Trip');

    const newDriver = await Driver.findById(req.body.driverId);
    if (!newDriver) throw new NotFoundError('Driver');

    const oldDriverId = trip.driverId?.toString();
    if (oldDriverId) await TripService.releaseDriver(oldDriverId);

    const claimed = await TripService.claimDriver(req.body.driverId, trip._id);
    if (!claimed) throw new ConflictError('Target driver is already on a trip');

    trip.driverId = newDriver._id;
    trip.vehicleSnapshot = { number: newDriver.vehicle!.number, model: newDriver.vehicle!.model, seats: newDriver.capacity!.seats, luggage: newDriver.capacity!.luggage };
    // Set the three fields by path rather than rebuilding the object with a
    // spread. `assignmentMeta` is a Mongoose nested path, not a plain object:
    // spreading it drops the nested `costBreakdown`, which then casts as
    // undefined and fails the whole save with a 500. Setting by path touches
    // only these keys, so the engine's original cost figures survive — they are
    // exactly what the "Why this driver?" explanation reads back.
    trip.set('assignmentMeta.strategy', 'manual_override');
    trip.set('assignmentMeta.decidedBy', req.user!.sub);
    trip.set('assignmentMeta.decidedAt', new Date());
    trip.timeline.push({ at: new Date(), type: 'reassigned', actor: req.user!.sub, payload: { from: oldDriverId, to: req.body.driverId } });
    await trip.save();

    await audit(req, 'trip.reassign', 'Trip', trip._id.toString(), { driverId: oldDriverId }, { driverId: req.body.driverId });

    for (const g of trip.guests) {
      NotificationService.tripAssigned(g.guestId.toString(), {
        trip: trip.toJSON(),
        driver: { name: newDriver.name, phone: newDriver.phone, vehicleNumber: newDriver.vehicle!.number },
        etaSeconds: 0
      });
    }

    res.json({ ok: true, data: trip });
  })
);

const cancelSchema = z.object({ reason: z.string().min(1) });

adminRouter.post(
  '/trips/:id/cancel',
  validate({ body: cancelSchema }),
  asyncHandler(async (req, res) => {
    const existing = await Trip.findById(req.params.id);
    if (!existing) throw new NotFoundError('Trip');

    // Route handlers never set trip.status directly (plan.md §6.2) — go
    // through the state machine so an invalid transition (e.g. cancelling an
    // already-completed trip) surfaces as a 409 instead of silently
    // corrupting the trip.
    const trip = await TripService.transition(req.params.id, 'cancelled', req.user!.sub);
    trip.cancellationReason = req.body.reason;
    trip.timeline.push({ at: new Date(), type: 'cancelled', actor: req.user!.sub, payload: { reason: req.body.reason } });
    await trip.save();

    const guestIds = trip.guests.map((g) => g.guestId.toString());
    await TripService.requeueGuests(guestIds, 'admin_cancelled');
    if (trip.driverId) await TripService.releaseDriver(trip.driverId.toString());
    await QueueEntry.updateMany({ guestIds: { $in: guestIds } }, { $set: { status: 'waiting', enqueuedAt: new Date(Date.now() - 15 * 60_000) } });

    await audit(req, 'trip.cancel', 'Trip', trip._id.toString(), null, { reason: req.body.reason });
    NotificationService.tripStatus(trip._id.toString(), { tripId: trip._id.toString(), status: 'cancelled', at: new Date().toISOString() });

    res.json({ ok: true, data: trip });
  })
);

// ---------- Queue ----------

adminRouter.get(
  '/queue',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    const entries = await QueueEntry.find(filter).sort({ priorityScore: -1 });
    res.json({ ok: true, data: entries });
  })
);

adminRouter.post(
  '/queue/:id/boost',
  asyncHandler(async (req, res) => {
    const entry = await QueueEntry.findByIdAndUpdate(
      req.params.id,
      { $set: { priorityScore: 1000, enqueuedAt: new Date(Date.now() - 60 * 60_000) } },
      { new: true }
    );
    if (!entry) throw new NotFoundError('QueueEntry');
    await audit(req, 'queue.boost', 'QueueEntry', req.params.id);
    res.json({ ok: true, data: entry });
  })
);

// ---------- Locations ----------

adminRouter.get(
  '/locations',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, data: await Location.find({}).sort({ name: 1 }) });
  })
);

const createLocationSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['airport', 'railway_station', 'accommodation', 'venue', 'custom']),
  address: z.string().default(''),
  lat: z.number(),
  lng: z.number(),
  geofenceRadiusM: z.number().default(150)
});

adminRouter.post(
  '/locations',
  validate({ body: createLocationSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createLocationSchema>;
    const location = await Location.create({
      name: body.name,
      type: body.type,
      address: body.address,
      coordinates: toGeoPoint({ lat: body.lat, lng: body.lng }),
      geofenceRadiusM: body.geofenceRadiusM
    });
    await audit(req, 'location.create', 'Location', location._id.toString(), null, location.toJSON());
    res.status(201).json({ ok: true, data: location });
  })
);

const updateLocationSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  isActive: z.boolean().optional(),
  geofenceRadiusM: z.number().optional()
});

adminRouter.patch(
  '/locations/:id',
  validate({ body: updateLocationSchema }),
  asyncHandler(async (req, res) => {
    const location = await Location.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!location) throw new NotFoundError('Location');
    await audit(req, 'location.update', 'Location', req.params.id, null, location.toJSON());
    res.json({ ok: true, data: location });
  })
);

// ---------- Config ----------

adminRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const cfg = await EventConfig.findOne({ singleton: 'singleton' });
    if (!cfg) throw new NotFoundError('EventConfig');
    res.json({ ok: true, data: cfg });
  })
);

const updateConfigSchema = z.object({
  dispatch: z.record(z.any()).optional(),
  traffic: z.record(z.any()).optional(),
  featureFlags: z.record(z.any()).optional()
});

adminRouter.patch(
  '/config',
  validate({ body: updateConfigSchema }),
  asyncHandler(async (req, res) => {
    const before = await EventConfig.findOne({ singleton: 'singleton' });
    if (!before) throw new NotFoundError('EventConfig');

    const patch: Record<string, unknown> = {};
    for (const [section, values] of Object.entries(req.body as Record<string, Record<string, unknown>>)) {
      for (const [key, value] of Object.entries(values)) {
        patch[`${section}.${key}`] = value;
      }
    }

    const cfg = await EventConfig.findOneAndUpdate({ singleton: 'singleton' }, { $set: patch }, { new: true });
    await audit(req, 'config.update', 'EventConfig', before._id.toString(), before.toJSON(), cfg?.toJSON());
    res.json({ ok: true, data: cfg });
  })
);

// ---------- Alerts ----------

adminRouter.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.acknowledged !== undefined) filter.acknowledged = req.query.acknowledged === 'true';
    const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ ok: true, data: alerts });
  })
);

adminRouter.post(
  '/alerts/:id/ack',
  asyncHandler(async (req, res) => {
    const alert = await Alert.findByIdAndUpdate(
      req.params.id,
      { $set: { acknowledged: true, acknowledgedBy: req.user!.sub, acknowledgedAt: new Date() } },
      { new: true }
    );
    if (!alert) throw new NotFoundError('Alert');
    res.json({ ok: true, data: alert });
  })
);

// ---------- Analytics ----------

const WAIT_BUCKETS = [
  { label: '0-5', min: 0, max: 5 },
  { label: '5-10', min: 5, max: 10 },
  { label: '10-15', min: 10, max: 15 },
  { label: '15-20', min: 15, max: 20 },
  { label: '20-30', min: 20, max: 30 },
  { label: '30+', min: 30, max: Infinity }
];

// Signed ETA error in minutes (predicted - actual): negative means the guest
// was told a shorter wait than they got.
const ETA_BUCKETS = [
  { label: '< -5', min: -Infinity, max: -5 },
  { label: '-5..-2', min: -5, max: -2 },
  { label: '-2..0', min: -2, max: 0 },
  { label: '0..2', min: 0, max: 2 },
  { label: '2..5', min: 2, max: 5 },
  { label: '> 5', min: 5, max: Infinity }
];

function bucketise<T extends { label: string; min: number; max: number }>(buckets: T[], values: number[]) {
  return buckets.map((b) => ({
    bucket: b.label,
    count: values.filter((v) => v >= b.min && v < b.max).length
  }));
}

adminRouter.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    const completedTrips = await Trip.find({ status: 'completed' })
      .select('metrics assignmentMeta guests createdAt completedAt route driverId')
      .lean();

    const waits = completedTrips.map((t: any) => t.metrics?.guestWaitMinutes ?? 0).filter((n: number) => n > 0);
    const sorted = [...waits].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    const avgWait = waits.length ? waits.reduce((a: number, b: number) => a + b, 0) / waits.length : 0;

    const sharedTrips = completedTrips.filter((t: any) => t.guests.length > 1);
    const sharedRidePct = completedTrips.length ? (sharedTrips.length / completedTrips.length) * 100 : 0;

    const byStrategy: Record<string, number> = {};
    for (const t of completedTrips as any[]) {
      const s = t.assignmentMeta?.strategy ?? 'unknown';
      byStrategy[s] = (byStrategy[s] ?? 0) + 1;
    }

    // Wait-time distribution — the shape matters more than the mean when
    // arrivals are bursty, because a good average can still hide a long tail.
    const waitDistribution = bucketise(WAIT_BUCKETS, waits);

    // ETA accuracy: metrics.etaAccuracySec is the signed predicted-minus-actual
    // error recorded at completion.
    const etaErrorsMin = completedTrips
      .map((t: any) => (t.metrics?.etaAccuracySec ?? 0) / 60)
      .filter((n: number) => Number.isFinite(n));
    const etaAccuracyDistribution = bucketise(ETA_BUCKETS, etaErrorsMin);
    const withinTwoMin = etaErrorsMin.filter((e) => Math.abs(e) <= 2).length;
    const etaWithin2MinPct = etaErrorsMin.length ? (withinTwoMin / etaErrorsMin.length) * 100 : 0;

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

    const buckets: Array<{ at: Date; hour: string; trips: number; guests: number }> = [];
    const indexByKey = new Map<number, number>();
    for (let i = HOURS_BACK - 1; i >= 0; i--) {
      const at = new Date(hourStart.getTime() - i * 60 * 60_000);
      indexByKey.set(at.getTime(), buckets.length);
      buckets.push({ at, hour: `${String(at.getHours()).padStart(2, '0')}:00`, trips: 0, guests: 0 });
    }

    for (const t of completedTrips as any[]) {
      const at = t.completedAt ?? t.createdAt;
      if (!at) continue;
      const slot = new Date(at);
      slot.setMinutes(0, 0, 0);
      const idx = indexByKey.get(slot.getTime());
      if (idx === undefined) continue; // older than the window
      buckets[idx].trips += 1;
      buckets[idx].guests += t.guests.length;
    }

    const tripsByHour = buckets.map(({ hour, trips, guests }) => ({ hour, trips, guests }));

    // Minutes saved by sharing. A shared trip carrying N guests replaces N
    // separate trips, so the saving is the (N-1) journeys not driven, less the
    // detour actually incurred to combine them. The baseline is the median
    // single-guest trip so one outlier airport run can't inflate it.
    const soloDurations = completedTrips
      .filter((t: any) => t.guests.length === 1 && (t.route?.durationSeconds ?? 0) > 0)
      .map((t: any) => t.route.durationSeconds / 60)
      .sort((a: number, b: number) => a - b);
    const medianSoloMin = soloDurations.length ? soloDurations[Math.floor(soloDurations.length / 2)] : 0;

    let detourSavedMin = 0;
    for (const t of sharedTrips as any[]) {
      detourSavedMin += (t.guests.length - 1) * medianSoloMin - (t.metrics?.detourAddedMin ?? 0);
    }
    detourSavedMin = Math.max(0, detourSavedMin);

    const driverCount = await Driver.countDocuments({ isActive: true });
    const busyDrivers = await Driver.countDocuments({ status: { $in: ['assigned', 'en_route_pickup', 'at_pickup', 'on_trip'] } });

    // Per-driver completed-trip counts, so utilisation can be read as a
    // distribution rather than a single fleet-wide percentage.
    const driverDocs = await Driver.find({ isActive: true }).select('name stats').lean();
    const tripsPerDriver = driverDocs
      .map((d: any) => ({ name: d.name.split(' ')[0], trips: d.stats?.tripsCompleted ?? 0 }))
      .sort((a, b) => b.trips - a.trips);

    res.json({
      ok: true,
      data: {
        avgWaitMin: Number(avgWait.toFixed(1)),
        p95WaitMin: Number(p95.toFixed(1)),
        sharedRidePct: Number(sharedRidePct.toFixed(1)),
        driverUtilisationPct: driverCount ? Number(((busyDrivers / driverCount) * 100).toFixed(1)) : 0,
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
  })
);

// ---------- Audit ----------

adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const pageSize = Math.min(100, Number(req.query.pageSize ?? 50));
    const [entries, total] = await Promise.all([
      AuditLog.find({})
        .sort({ at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      AuditLog.countDocuments({})
    ]);
    res.json({ ok: true, data: entries, meta: { page, pageSize, total } });
  })
);
