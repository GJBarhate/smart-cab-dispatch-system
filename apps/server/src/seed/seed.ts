// Idempotent seed script for "Sahyadri Tech Summit 2026" (plan.md §17).
// Run with `npm run seed -w server`. Pass `--fresh` to drop collections first.
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { User, Driver, Guest, Location, EventConfig, DistanceCache, AuditLog, Trip, RideRequest, QueueEntry, Lock, Alert, Counter } from '../models';
import { RoutingService } from '../services/routing/RoutingService';
import { DistanceCacheService } from '../services/routing/DistanceCacheService';
import { toLatLng, toGeoPoint } from '../utils/geo';
import type { LatLng } from '../utils/geo';
import { LocationType, VehicleType, PriorityTier } from '../shared';
import { seedDemoState } from './demoState';

const FRESH = process.argv.includes('--fresh');
// Demo state (trip history, live trips, pending approvals, queue backlog) is
// on by default — without it every ops screen renders its empty state, which
// is correct behaviour but impossible to demo or grade. `--no-demo` gives a
// clean slate for anyone who wants to drive the system purely by hand.
const WITH_DEMO = !process.argv.includes('--no-demo');

// The event is anchored to the day the seed runs rather than to plan.md's
// fixed 10-14 Aug window. A grader seeding on any other date would otherwise
// land outside every phase, with no arrival due and nothing for the engine to
// do. Place, coordinates and duration are unchanged; only the origin moves.
const DAY1 = new Date();
DAY1.setHours(0, 0, 0, 0);
const day = (n: number, hours = 0, minutes = 0): Date =>
  new Date(DAY1.getTime() + n * 24 * 60 * 60_000 + hours * 60 * 60_000 + minutes * 60_000);

const LOCATIONS = [
  { name: 'Pune International Airport (T1)', type: LocationType.AIRPORT, lng: 73.9089, lat: 18.5793 },
  { name: 'Pune Junction Railway Station', type: LocationType.RAILWAY_STATION, lng: 73.8745, lat: 18.5286 },
  { name: 'Sahyadri Convention Centre', type: LocationType.VENUE, lng: 73.7997, lat: 18.559 },
  { name: 'Hotel Aurora, Koregaon Park', type: LocationType.ACCOMMODATION, lng: 73.893, lat: 18.5362 },
  { name: 'Grand Meridian, Hinjewadi', type: LocationType.ACCOMMODATION, lng: 73.738, lat: 18.5913 },
  { name: 'Riverside Suites, Kalyani Nagar', type: LocationType.ACCOMMODATION, lng: 73.901, lat: 18.548 }
] as const;

const DRIVER_NAMES = [
  'Ramesh Kulkarni', 'Suresh Patil', 'Ganesh Jadhav', 'Vikram Deshmukh', 'Anil Shinde', 'Prakash More',
  'Sanjay Pawar', 'Deepak Gaikwad', 'Ravindra Bhosale', 'Ashok Chavan', 'Nitin Wagh', 'Sunil Kadam'
];

const GUEST_NAMES = [
  'Aarav Sharma', 'Vivaan Gupta', 'Aditya Singh', 'Vihaan Mehta', 'Arjun Rao', 'Reyansh Nair', 'Krishna Iyer',
  'Ishaan Kapoor', 'Rohan Malhotra', 'Kabir Chopra', 'Ananya Reddy', 'Diya Menon', 'Saanvi Joshi', 'Aadhya Bose',
  'Myra Kulkarni', 'Anika Verma', 'Pari Agarwal', 'Riya Sinha', 'Kiara Bhatt', 'Ira Desai', 'Neha Trivedi',
  'Priya Ramesh', 'Karan Malhotra', 'Aryan Khanna', 'Sara Fernandes', 'Zara Khan', 'Rahul Bajaj', 'Varun Oberoi',
  'Simran Kaur', 'Tanvi Rane', 'Yash Thakur', 'Om Prakash', 'Devika Nambiar', 'Aisha Qureshi', 'Manav Suri',
  'Kavya Pillai', 'Nikhil Bhatia', 'Shreya Dutta', 'Amit Saxena', 'Pooja Hegde'
];

function plate(i: number): string {
  const letters = String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + ((i + 7) % 26));
  return `MH-12-${letters}-${1000 + i}`;
}

async function dropAll(): Promise<void> {
  logger.info('--fresh: dropping collections');
  await Promise.all([
    User.deleteMany({}),
    Driver.deleteMany({}),
    Guest.deleteMany({}),
    Location.deleteMany({}),
    EventConfig.deleteMany({}),
    DistanceCache.deleteMany({}),
    AuditLog.deleteMany({}),
    Trip.deleteMany({}),
    RideRequest.deleteMany({}),
    QueueEntry.deleteMany({}),
    Lock.deleteMany({}),
    Alert.deleteMany({}),
    Counter.deleteMany({})
  ]);
}

async function seedLocations(): Promise<Record<string, InstanceType<typeof Location>>> {
  const byName: Record<string, InstanceType<typeof Location>> = {};
  for (const l of LOCATIONS) {
    const doc = await Location.findOneAndUpdate(
      { name: l.name },
      {
        $setOnInsert: {
          name: l.name,
          type: l.type,
          coordinates: toGeoPoint({ lat: l.lat, lng: l.lng }),
          geofenceRadiusM: 150,
          isActive: true
        }
      },
      { upsert: true, new: true }
    );
    byName[l.name] = doc;
  }
  return byName;
}

async function precomputeStaticMatrix(locations: InstanceType<typeof Location>[]): Promise<void> {
  const points: LatLng[] = locations.map((l) => toLatLng(l.coordinates as any));
  const { durations, distances } = await RoutingService.matrix(points, points);
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < points.length; j++) {
      await DistanceCacheService.set(
        points[i],
        points[j],
        { durationSeconds: durations[i][j], distanceMeters: distances[i][j], provider: 'seed-static' },
        { isStatic: true }
      );
    }
  }
  logger.info({ cells: points.length * points.length }, 'static location matrix precomputed');
}

async function seedAdmin(): Promise<{ email: string; password: string }> {
  const email = 'admin@sahyadri.events';
  const password = 'Admin@1234';
  const existing = await User.findOne({ email });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
    await User.create({ name: 'Ops Admin', email, role: 'admin', passwordHash, isActive: true });
  }
  return { email, password };
}

async function seedDrivers(): Promise<Array<{ phone: string; password: string; name: string; plate: string }>> {
  const password = 'Driver@1234';
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  const fleet: Array<{ type: (typeof VehicleType)[keyof typeof VehicleType]; seats: number; luggage: number }> = [
    ...Array(6).fill({ type: VehicleType.SEDAN, seats: 4, luggage: 3 }),
    ...Array(4).fill({ type: VehicleType.SUV, seats: 6, luggage: 5 }),
    ...Array(2).fill({ type: VehicleType.TEMPO, seats: 12, luggage: 12 })
  ];

  const spread = LOCATIONS.filter((l) => l.type === LocationType.ACCOMMODATION);
  const credentials: Array<{ phone: string; password: string; name: string; plate: string }> = [];

  for (let i = 0; i < fleet.length; i++) {
    const name = DRIVER_NAMES[i];
    const phone = `98765${String(43000 + i).padStart(5, '0')}`;
    const vehicleNumber = plate(i);
    const spot = spread[i % spread.length];

    let user = await User.findOne({ phone });
    if (!user) {
      user = await User.create({ name, phone, role: 'driver', passwordHash, isActive: true });
    }

    const existingDriver = await Driver.findOne({ userId: user._id });
    if (!existingDriver) {
      const driver = await Driver.create({
        userId: user._id,
        name,
        phone,
        licenseNo: `DL-PN-${2020 + i}-${100000 + i}`,
        vehicle: { number: vehicleNumber, model: fleet[i].type === 'tempo' ? 'Force Traveller' : fleet[i].type === 'suv' ? 'Toyota Innova' : 'Maruti Dzire', colour: 'White', type: fleet[i].type },
        capacity: { seats: fleet[i].seats, luggage: fleet[i].luggage },
        status: 'idle',
        currentLocation: toGeoPoint({ lat: spot.lat, lng: spot.lng }),
        locationUpdatedAt: new Date(),
        predictedFreeAt: new Date(),
        predictedFreeLocation: toGeoPoint({ lat: spot.lat, lng: spot.lng }),
        shift: { startAt: day(0, 6), endAt: day(0, 22) },
        isActive: true
      });
      await User.updateOne({ _id: user._id }, { $set: { driverId: driver._id } });
    }

    credentials.push({ phone, password, name, plate: vehicleNumber });
  }

  return credentials;
}

async function seedGuests(locByName: Record<string, InstanceType<typeof Location>>): Promise<Array<{ bookingRef: string; phone: string; name: string }>> {
  const airport = locByName['Pune International Airport (T1)'];
  const station = locByName['Pune Junction Railway Station'];
  const hotels = [locByName['Hotel Aurora, Koregaon Park'], locByName['Grand Meridian, Hinjewadi'], locByName['Riverside Suites, Kalyani Nagar']];

  const credentials: Array<{ bookingRef: string; phone: string; name: string }> = [];

  // 40 guest bookings; guest #14 (index 13) is the group of 14 that forces GroupSplitter.
  for (let i = 0; i < 40; i++) {
    const bookingRef = `EVT-${1001 + i}`;
    const phone = `70000${String(10000 + i).padStart(5, '0')}`;
    const name = GUEST_NAMES[i];
    const hotel = hotels[i % hotels.length];
    const fromAirport = i % 2 === 0;
    const pickup = fromAirport ? airport : station;

    // Arrivals are anchored to `now` so the arrival sweep has real work the
    // moment the server starts: the first six have already landed, the next
    // ten land across the following 90 minutes (the peak), and the rest are
    // spread through the afternoon.
    const nowMs = Date.now();
    const scheduledAt =
      i < 6
        ? new Date(nowMs - (40 - i * 7) * 60_000)
        : i < 16
          ? new Date(nowMs + (i - 5) * 9 * 60_000)
          : new Date(nowMs + 2 * 60 * 60_000 + (i - 16) * 20 * 60_000);

    const groupSize = i === 13 ? 14 : [1, 1, 2, 2, 3, 4][i % 6];
    const isVip = i < 3;
    const specialNeeds = i === 30 ? 'wheelchair' : i === 31 ? 'infant seat' : '';

    const existing = await Guest.findOne({ bookingRef });
    if (!existing) {
      await Guest.create({
        bookingRef,
        name,
        phone,
        groupSize,
        luggageCount: Math.max(1, Math.round(groupSize * 0.8)),
        priorityTier: isVip ? PriorityTier.VIP : PriorityTier.STANDARD,
        isVip,
        arrival: { mode: fromAirport ? 'flight' : 'train', identifier: fromAirport ? `AI-${202 + i}` : `12${627 + i}`, scheduledAt, pickupLocationId: pickup._id, terminal: fromAirport ? 'T1' : '' },
        departure: { mode: fromAirport ? 'flight' : 'train', scheduledAt: day(3, 14), dropLocationId: pickup._id },
        accommodationId: hotel._id,
        status: 'registered',
        specialNeeds
      });
    }

    credentials.push({ bookingRef, phone, name });
  }

  return credentials;
}

async function seedEventConfig(locByName: Record<string, InstanceType<typeof Location>>): Promise<void> {
  const airport = locByName['Pune International Airport (T1)'];
  const station = locByName['Pune Junction Railway Station'];
  const venue = locByName['Sahyadri Convention Centre'];
  const accommodations = Object.values(locByName).filter((l) => l.type === 'accommodation');

  await EventConfig.findOneAndUpdate(
    { singleton: 'singleton' },
    {
      $setOnInsert: {
        singleton: 'singleton',
        name: 'Sahyadri Tech Summit 2026',
        timezone: 'Asia/Kolkata',
        startAt: day(0),
        endAt: day(4, 23, 59),
        venueId: venue._id,
        airportId: airport._id,
        stationId: station._id,
        accommodationIds: accommodations.map((a) => a._id),
        phases: [
          { key: 'ARRIVAL', startAt: day(0), endAt: day(1, 18), defaultTripType: 'ARRIVAL_PICKUP' },
          { key: 'EVENT_DAY', startAt: day(1, 18), endAt: day(3, 12), defaultTripType: 'TO_VENUE' },
          { key: 'DEPARTURE', startAt: day(3, 12), endAt: day(4, 23, 59), defaultTripType: 'DEPARTURE_DROP' }
        ]
      }
    },
    { upsert: true, new: true }
  );
}

async function run(): Promise<void> {
  await connectDb();
  if (FRESH) await dropAll();

  const locByName = await seedLocations();
  await seedEventConfig(locByName);
  await precomputeStaticMatrix(Object.values(locByName));

  const admin = await seedAdmin();
  const drivers = await seedDrivers();
  const guests = await seedGuests(locByName);

  // Layering a second demo snapshot over an existing one would double-book
  // drivers and skew the analytics, so on a non-fresh run it is skipped when
  // trips already exist. `--fresh` always rebuilds: the collections were just
  // dropped, and a running dev server can slip its own trips in between the
  // drop and this check.
  let demo: Awaited<ReturnType<typeof seedDemoState>> | null = null;
  if (WITH_DEMO) {
    if (!FRESH && (await Trip.countDocuments({})) > 0) {
      logger.info('trips already present — skipping demo state (re-run with --fresh to rebuild it)');
    } else {
      demo = await seedDemoState();
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n=== SEED COMPLETE — DEMO CREDENTIALS ===\n');
  // eslint-disable-next-line no-console
  console.log(`Admin        : ${admin.email} / ${admin.password}`);
  // eslint-disable-next-line no-console
  console.log(`Driver login : any phone below / Driver@1234`);
  drivers.slice(0, 3).forEach((d) => console.log(`  ${d.phone}  ${d.name}  (${d.plate})`));
  // eslint-disable-next-line no-console
  console.log(`  ...and ${drivers.length - 3} more (see Driver Management in the admin portal)`);
  // eslint-disable-next-line no-console
  console.log(`Guest login  : booking ref + phone`);
  guests.slice(0, 3).forEach((g) => console.log(`  ${g.bookingRef}  ${g.phone}  ${g.name}`));
  // eslint-disable-next-line no-console
  console.log(`  ...and ${guests.length - 3} more`);
  // eslint-disable-next-line no-console
  console.log(`\nLocations: ${LOCATIONS.length}  Drivers: ${drivers.length}  Guests: ${guests.length}`);
  if (demo) {
    // eslint-disable-next-line no-console
    console.log(
      `Demo state : ${demo.completedTrips} completed trips · ${demo.liveTrips} live trips · ` +
        `${demo.pendingRequests} awaiting approval · ${demo.queueEntries} queued · ${demo.alerts} alerts`
    );
  }
  // eslint-disable-next-line no-console
  console.log('');

  await disconnectDb();
  process.exit(0);
}

run().catch((err) => {
  logger.error({ err }, 'seed failed');
  process.exit(1);
});
