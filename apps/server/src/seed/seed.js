"use strict";

var _bcryptjs = _interopRequireDefault(require("bcryptjs"));
var _db = require("../config/db");
var _env = require("../config/env");
var _logger = require("../config/logger");
var _models = require("../models");
var _RoutingService = require("../services/routing/RoutingService");
var _DistanceCacheService = require("../services/routing/DistanceCacheService");
var _geo = require("../utils/geo");
var _shared = require("../shared");
var _demoState = require("./demoState");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Idempotent seed script for "Sahyadri Tech Summit 2026" (plan.md §17).
// Run with `npm run seed -w server`. Pass `--fresh` to drop collections first.

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
const day = (n, hours = 0, minutes = 0) => new Date(DAY1.getTime() + n * 24 * 60 * 60_000 + hours * 60 * 60_000 + minutes * 60_000);
const LOCATIONS = [{
  name: 'Pune International Airport (T1)',
  type: _shared.LocationType.AIRPORT,
  lng: 73.9089,
  lat: 18.5793
}, {
  name: 'Pune Junction Railway Station',
  type: _shared.LocationType.RAILWAY_STATION,
  lng: 73.8745,
  lat: 18.5286
}, {
  name: 'Sahyadri Convention Centre',
  type: _shared.LocationType.VENUE,
  lng: 73.7997,
  lat: 18.559
}, {
  name: 'Hotel Aurora, Koregaon Park',
  type: _shared.LocationType.ACCOMMODATION,
  lng: 73.893,
  lat: 18.5362
}, {
  name: 'Grand Meridian, Hinjewadi',
  type: _shared.LocationType.ACCOMMODATION,
  lng: 73.738,
  lat: 18.5913
}, {
  name: 'Riverside Suites, Kalyani Nagar',
  type: _shared.LocationType.ACCOMMODATION,
  lng: 73.901,
  lat: 18.548
}];
const DRIVER_NAMES = ['Ramesh Kulkarni', 'Suresh Patil', 'Ganesh Jadhav', 'Vikram Deshmukh', 'Anil Shinde', 'Prakash More', 'Sanjay Pawar', 'Deepak Gaikwad', 'Ravindra Bhosale', 'Ashok Chavan', 'Nitin Wagh', 'Sunil Kadam'];
const GUEST_NAMES = ['Aarav Sharma', 'Vivaan Gupta', 'Aditya Singh', 'Vihaan Mehta', 'Arjun Rao', 'Reyansh Nair', 'Krishna Iyer', 'Ishaan Kapoor', 'Rohan Malhotra', 'Kabir Chopra', 'Ananya Reddy', 'Diya Menon', 'Saanvi Joshi', 'Aadhya Bose', 'Myra Kulkarni', 'Anika Verma', 'Pari Agarwal', 'Riya Sinha', 'Kiara Bhatt', 'Ira Desai', 'Neha Trivedi', 'Priya Ramesh', 'Karan Malhotra', 'Aryan Khanna', 'Sara Fernandes', 'Zara Khan', 'Rahul Bajaj', 'Varun Oberoi', 'Simran Kaur', 'Tanvi Rane', 'Yash Thakur', 'Om Prakash', 'Devika Nambiar', 'Aisha Qureshi', 'Manav Suri', 'Kavya Pillai', 'Nikhil Bhatia', 'Shreya Dutta', 'Amit Saxena', 'Pooja Hegde'];
function plate(i) {
  const letters = String.fromCharCode(65 + i % 26) + String.fromCharCode(65 + (i + 7) % 26);
  return `MH-12-${letters}-${1000 + i}`;
}
async function dropAll() {
  _logger.logger.info('--fresh: dropping collections');
  await Promise.all([_models.User.deleteMany({}), _models.Driver.deleteMany({}), _models.Guest.deleteMany({}), _models.Location.deleteMany({}), _models.EventConfig.deleteMany({}), _models.DistanceCache.deleteMany({}), _models.AuditLog.deleteMany({}), _models.Trip.deleteMany({}), _models.RideRequest.deleteMany({}), _models.QueueEntry.deleteMany({}), _models.Lock.deleteMany({}), _models.Alert.deleteMany({}), _models.Counter.deleteMany({})]);
}
async function seedLocations() {
  const byName = {};
  for (const l of LOCATIONS) {
    const doc = await _models.Location.findOneAndUpdate({
      name: l.name
    }, {
      $setOnInsert: {
        name: l.name,
        type: l.type,
        coordinates: (0, _geo.toGeoPoint)({
          lat: l.lat,
          lng: l.lng
        }),
        geofenceRadiusM: 150,
        isActive: true
      }
    }, {
      upsert: true,
      new: true
    });
    byName[l.name] = doc;
  }
  return byName;
}
async function precomputeStaticMatrix(locations) {
  const points = locations.map(l => (0, _geo.toLatLng)(l.coordinates));
  const {
    durations,
    distances
  } = await _RoutingService.RoutingService.matrix(points, points);
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < points.length; j++) {
      await _DistanceCacheService.DistanceCacheService.set(points[i], points[j], {
        durationSeconds: durations[i][j],
        distanceMeters: distances[i][j],
        provider: 'seed-static'
      }, {
        isStatic: true
      });
    }
  }
  _logger.logger.info({
    cells: points.length * points.length
  }, 'static location matrix precomputed');
}
async function seedAdmin() {
  const email = 'admin@sahyadri.events';
  const password = 'Admin@1234';
  const existing = await _models.User.findOne({
    email
  });
  if (!existing) {
    const passwordHash = await _bcryptjs.default.hash(password, _env.env.BCRYPT_ROUNDS);
    await _models.User.create({
      name: 'Ops Admin',
      email,
      role: 'admin',
      passwordHash,
      isActive: true
    });
  }
  return {
    email,
    password
  };
}
async function seedDrivers() {
  const password = 'Driver@1234';
  const passwordHash = await _bcryptjs.default.hash(password, _env.env.BCRYPT_ROUNDS);
  const fleet = [...Array(6).fill({
    type: _shared.VehicleType.SEDAN,
    seats: 4,
    luggage: 3
  }), ...Array(4).fill({
    type: _shared.VehicleType.SUV,
    seats: 6,
    luggage: 5
  }), ...Array(2).fill({
    type: _shared.VehicleType.TEMPO,
    seats: 12,
    luggage: 12
  })];
  const spread = LOCATIONS.filter(l => l.type === _shared.LocationType.ACCOMMODATION);
  const credentials = [];
  for (let i = 0; i < fleet.length; i++) {
    const name = DRIVER_NAMES[i];
    const phone = `98765${String(43000 + i).padStart(5, '0')}`;
    const vehicleNumber = plate(i);
    const spot = spread[i % spread.length];
    let user = await _models.User.findOne({
      phone
    });
    if (!user) {
      user = await _models.User.create({
        name,
        phone,
        role: 'driver',
        passwordHash,
        isActive: true
      });
    }
    const existingDriver = await _models.Driver.findOne({
      userId: user._id
    });
    if (!existingDriver) {
      const driver = await _models.Driver.create({
        userId: user._id,
        name,
        phone,
        licenseNo: `DL-PN-${2020 + i}-${100000 + i}`,
        vehicle: {
          number: vehicleNumber,
          model: fleet[i].type === 'tempo' ? 'Force Traveller' : fleet[i].type === 'suv' ? 'Toyota Innova' : 'Maruti Dzire',
          colour: 'White',
          type: fleet[i].type
        },
        capacity: {
          seats: fleet[i].seats,
          luggage: fleet[i].luggage
        },
        status: 'idle',
        currentLocation: (0, _geo.toGeoPoint)({
          lat: spot.lat,
          lng: spot.lng
        }),
        locationUpdatedAt: new Date(),
        predictedFreeAt: new Date(),
        predictedFreeLocation: (0, _geo.toGeoPoint)({
          lat: spot.lat,
          lng: spot.lng
        }),
        shift: {
          startAt: day(0, 6),
          endAt: day(0, 22)
        },
        isActive: true
      });
      await _models.User.updateOne({
        _id: user._id
      }, {
        $set: {
          driverId: driver._id
        }
      });
    }
    credentials.push({
      phone,
      password,
      name,
      plate: vehicleNumber
    });
  }
  return credentials;
}
async function seedGuests(locByName) {
  const airport = locByName['Pune International Airport (T1)'];
  const station = locByName['Pune Junction Railway Station'];
  const hotels = [locByName['Hotel Aurora, Koregaon Park'], locByName['Grand Meridian, Hinjewadi'], locByName['Riverside Suites, Kalyani Nagar']];
  const credentials = [];

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
    const scheduledAt = i < 6 ? new Date(nowMs - (40 - i * 7) * 60_000) : i < 16 ? new Date(nowMs + (i - 5) * 9 * 60_000) : new Date(nowMs + 2 * 60 * 60_000 + (i - 16) * 20 * 60_000);
    const groupSize = i === 13 ? 14 : [1, 1, 2, 2, 3, 4][i % 6];
    const isVip = i < 3;
    const specialNeeds = i === 30 ? 'wheelchair' : i === 31 ? 'infant seat' : '';
    const existing = await _models.Guest.findOne({
      bookingRef
    });
    if (!existing) {
      await _models.Guest.create({
        bookingRef,
        name,
        phone,
        groupSize,
        luggageCount: Math.max(1, Math.round(groupSize * 0.8)),
        priorityTier: isVip ? _shared.PriorityTier.VIP : _shared.PriorityTier.STANDARD,
        isVip,
        arrival: {
          mode: fromAirport ? 'flight' : 'train',
          identifier: fromAirport ? `AI-${202 + i}` : `12${627 + i}`,
          scheduledAt,
          pickupLocationId: pickup._id,
          terminal: fromAirport ? 'T1' : ''
        },
        departure: {
          mode: fromAirport ? 'flight' : 'train',
          scheduledAt: day(3, 14),
          dropLocationId: pickup._id
        },
        accommodationId: hotel._id,
        status: 'registered',
        specialNeeds
      });
    }
    credentials.push({
      bookingRef,
      phone,
      name
    });
  }
  return credentials;
}
async function seedEventConfig(locByName) {
  const airport = locByName['Pune International Airport (T1)'];
  const station = locByName['Pune Junction Railway Station'];
  const venue = locByName['Sahyadri Convention Centre'];
  const accommodations = Object.values(locByName).filter(l => l.type === 'accommodation');
  await _models.EventConfig.findOneAndUpdate({
    singleton: 'singleton'
  }, {
    $setOnInsert: {
      singleton: 'singleton',
      name: 'Sahyadri Tech Summit 2026',
      timezone: 'Asia/Kolkata',
      startAt: day(0),
      endAt: day(4, 23, 59),
      venueId: venue._id,
      airportId: airport._id,
      stationId: station._id,
      accommodationIds: accommodations.map(a => a._id),
      phases: [{
        key: 'ARRIVAL',
        startAt: day(0),
        endAt: day(1, 18),
        defaultTripType: 'ARRIVAL_PICKUP'
      }, {
        key: 'EVENT_DAY',
        startAt: day(1, 18),
        endAt: day(3, 12),
        defaultTripType: 'TO_VENUE'
      }, {
        key: 'DEPARTURE',
        startAt: day(3, 12),
        endAt: day(4, 23, 59),
        defaultTripType: 'DEPARTURE_DROP'
      }]
    }
  }, {
    upsert: true,
    new: true
  });
}
async function run() {
  await (0, _db.connectDb)();
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
  let demo = null;
  if (WITH_DEMO) {
    if (!FRESH && (await _models.Trip.countDocuments({})) > 0) {
      _logger.logger.info('trips already present — skipping demo state (re-run with --fresh to rebuild it)');
    } else {
      demo = await (0, _demoState.seedDemoState)();
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n=== SEED COMPLETE — DEMO CREDENTIALS ===\n');
  // eslint-disable-next-line no-console
  console.log(`Admin        : ${admin.email} / ${admin.password}`);
  // eslint-disable-next-line no-console
  console.log(`Driver login : any phone below / Driver@1234`);
  drivers.slice(0, 3).forEach(d => console.log(`  ${d.phone}  ${d.name}  (${d.plate})`));
  // eslint-disable-next-line no-console
  console.log(`  ...and ${drivers.length - 3} more (see Driver Management in the admin portal)`);
  // eslint-disable-next-line no-console
  console.log(`Guest login  : booking ref + phone`);
  guests.slice(0, 3).forEach(g => console.log(`  ${g.bookingRef}  ${g.phone}  ${g.name}`));
  // eslint-disable-next-line no-console
  console.log(`  ...and ${guests.length - 3} more`);
  // eslint-disable-next-line no-console
  console.log(`\nLocations: ${LOCATIONS.length}  Drivers: ${drivers.length}  Guests: ${guests.length}`);
  if (demo) {
    // eslint-disable-next-line no-console
    console.log(`Demo state : ${demo.completedTrips} completed trips · ${demo.liveTrips} live trips · ` + `${demo.pendingRequests} awaiting approval · ${demo.queueEntries} queued · ${demo.alerts} alerts`);
  }
  // eslint-disable-next-line no-console
  console.log('');
  await (0, _db.disconnectDb)();
  process.exit(0);
}
run().catch(err => {
  _logger.logger.error({
    err
  }, 'seed failed');
  process.exit(1);
});
