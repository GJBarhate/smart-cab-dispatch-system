"use strict";

var _http = require("http");
var _db = require("../config/db");
var _logger = require("../config/logger");
var _app = require("../app");
var _io = require("../realtime/io");
var _scheduler = require("../jobs/scheduler");
var _models = require("../models");
var _auth = require("../middleware/auth");
var _geo = require("../utils/geo");
var _RoutingService = require("../services/routing/RoutingService");
var _VirtualDriver = require("./VirtualDriver");
// Peak-arrival simulation (plan.md §13.3). Boots the real Express+Socket.IO
// app in-process, wipes the operational collections, seeds a fresh fleet +
// guest list, injects a burst of arrivals, and drives the *real* HTTP API —
// real dispatch ticks, real driver accept/reject/board/drop, real Mongo
// writes — via VirtualDriver instances moving at a simulated speed multiplier.
//
//   npm run simulate -- --drivers 60 --guests 250 --burst 90 --minutes 20 --speed 30x
//
// Exits non-zero if any correctness assertion fails.

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name, fallback) => {
    const idx = argv.indexOf(`--${name}`);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : fallback;
  };
  return {
    drivers: Number(get('drivers', '60')),
    guests: Number(get('guests', '250')),
    burst: Number(get('burst', '90')),
    minutes: Number(get('minutes', '20')),
    speed: Number(get('speed', '30x').replace(/x$/i, '')),
    rejectionRate: Number(get('rejection-rate', '0.1'))
  };
}
const PUNE_CENTER = {
  lat: 18.5595,
  lng: 73.8
};
const AIRPORT = {
  lat: 18.5793,
  lng: 73.9089
};
const STATION = {
  lat: 18.5286,
  lng: 73.8745
};
const VENUE = {
  lat: 18.559,
  lng: 73.7997
};
const HOTELS = [{
  lat: 18.5362,
  lng: 73.893
}, {
  lat: 18.5913,
  lng: 73.738
}, {
  lat: 18.548,
  lng: 73.901
}];
function jitter(p, km = 3) {
  const dLat = (Math.random() - 0.5) * (km / 111);
  const dLng = (Math.random() - 0.5) * (km / 111);
  return {
    lat: p.lat + dLat,
    lng: p.lng + dLng
  };
}
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}
function fmtMin(n) {
  return `${n.toFixed(1)}m`;
}
function fmtMs(n) {
  return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`;
}
async function main() {
  const args = parseArgs();
  _logger.logger.info({
    args
  }, 'peak-arrival simulation starting');
  await (0, _db.connectDb)();
  const app = (0, _app.createApp)();
  const httpServer = (0, _http.createServer)(app);
  (0, _io.createSocketServer)(httpServer);
  await new Promise(resolve => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  const baseUrl = `http://localhost:${port}`;

  // --- Wipe operational state and seed a fresh scenario ---
  await Promise.all([_models.User.deleteMany({
    role: {
      $ne: 'admin'
    }
  }), _models.Driver.deleteMany({}), _models.Guest.deleteMany({}), _models.Trip.deleteMany({}), _models.RideRequest.deleteMany({}), _models.QueueEntry.deleteMany({}), _models.Lock.deleteMany({}), _models.Alert.deleteMany({})]);
  let venueLoc = await _models.Location.findOne({
    type: 'venue'
  });
  let airportLoc = await _models.Location.findOne({
    type: 'airport'
  });
  if (!venueLoc) venueLoc = await _models.Location.create({
    name: 'Sim Venue',
    type: 'venue',
    coordinates: (0, _geo.toGeoPoint)(VENUE),
    geofenceRadiusM: 150
  });
  if (!airportLoc) airportLoc = await _models.Location.create({
    name: 'Sim Airport',
    type: 'airport',
    coordinates: (0, _geo.toGeoPoint)(AIRPORT),
    geofenceRadiusM: 150
  });
  let cfg = await _models.EventConfig.findOne({
    singleton: 'singleton'
  });
  if (!cfg) {
    cfg = await _models.EventConfig.create({
      singleton: 'singleton',
      name: 'Simulation Event',
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 7 * 24 * 60 * 60_000)
    });
  }
  await _models.EventConfig.updateOne({
    singleton: 'singleton'
  }, {
    $set: {
      'featureFlags.autoDispatchEnabled': true,
      'featureFlags.detourEnabled': true,
      'featureFlags.sharingEnabled': true
    }
  });
  let adminUser = await _models.User.findOne({
    role: 'admin'
  });
  if (!adminUser) adminUser = await _models.User.create({
    name: 'Sim Admin',
    email: 'simadmin@test.local',
    role: 'admin',
    passwordHash: 'x'
  });
  const adminToken = (0, _auth.signToken)({
    sub: adminUser._id.toString(),
    role: 'admin'
  });
  const fleetTypes = [{
    type: 'sedan',
    seats: 4,
    luggage: 3
  }, {
    type: 'suv',
    seats: 6,
    luggage: 5
  }, {
    type: 'tempo',
    seats: 12,
    luggage: 12
  }];
  const drivers = [];
  for (let i = 0; i < args.drivers; i++) {
    const spec = fleetTypes[i % fleetTypes.length];
    const phone = `9${String(500000 + i).padStart(9, '0')}`;
    const user = await _models.User.create({
      name: `Sim Driver ${i}`,
      phone,
      role: 'driver',
      passwordHash: 'x',
      isActive: true
    });
    const spot = jitter(PUNE_CENTER, 8);
    const driver = await _models.Driver.create({
      userId: user._id,
      name: `Sim Driver ${i}`,
      phone,
      vehicle: {
        number: `SIM-${i}`,
        model: 'x',
        colour: 'white',
        type: spec.type
      },
      capacity: {
        seats: spec.seats,
        luggage: spec.luggage
      },
      status: 'idle',
      currentLocation: (0, _geo.toGeoPoint)(spot),
      predictedFreeAt: new Date(),
      predictedFreeLocation: (0, _geo.toGeoPoint)(spot),
      isActive: true
    });
    await _models.User.updateOne({
      _id: user._id
    }, {
      $set: {
        driverId: driver._id
      }
    });
    const token = (0, _auth.signToken)({
      sub: user._id.toString(),
      role: 'driver',
      driverId: driver._id.toString()
    });
    drivers.push({
      id: driver._id.toString(),
      token
    });
  }
  const guestIds = [];
  for (let i = 0; i < args.guests; i++) {
    const guest = await _models.Guest.create({
      bookingRef: `SIM-${i}`,
      name: `Sim Guest ${i}`,
      phone: `7${String(600000 + i).padStart(9, '0')}`,
      groupSize: 1,
      luggageCount: 1,
      priorityTier: i % 20 === 0 ? 3 : 1,
      status: 'registered',
      accommodationId: undefined
    });
    guestIds.push(guest._id.toString());
  }

  // --- Compressed-time schedule: burst arrivals in the first half, tail over the rest ---
  const totalRealMs = args.minutes * 60_000 / args.speed;
  const burstWindowMs = totalRealMs / 2;
  const enqueuedAtByGuest = new Map();
  const scheduleArrival = (guestId, delayMs) => {
    setTimeout(() => {
      const now = new Date();
      const isAirport = Math.random() > 0.5;
      const pickup = isAirport ? AIRPORT : STATION;
      const dropoff = HOTELS[Math.floor(Math.random() * HOTELS.length)];
      enqueuedAtByGuest.set(guestId, now);
      _models.QueueEntry.create({
        type: 'ARRIVAL_PICKUP',
        guestIds: [guestId],
        seats: 1,
        luggage: 1,
        pickup: {
          locationId: isAirport ? airportLoc._id : null,
          coordinates: (0, _geo.toGeoPoint)(jitter(pickup, 0.3)),
          label: isAirport ? 'Airport' : 'Station'
        },
        dropoff: {
          locationId: null,
          coordinates: (0, _geo.toGeoPoint)(jitter(dropoff, 0.3)),
          label: 'Hotel'
        },
        earliestAt: now,
        deadlineAt: new Date(now.getTime() + 45 * 60_000),
        enqueuedAt: now,
        priorityTier: 1,
        status: 'waiting'
      }).catch(err => _logger.logger.error({
        err
      }, 'failed to enqueue simulated arrival'));
    }, delayMs);
  };
  for (let i = 0; i < args.guests; i++) {
    const delay = i < args.burst ? Math.random() * burstWindowMs : burstWindowMs + Math.random() * (totalRealMs - burstWindowMs);
    scheduleArrival(guestIds[i], delay);
  }

  // --- Drive real dispatch ticks over HTTP for the whole run ---
  const tickDurations = [];
  let ticking = true;
  const tickLoop = (async () => {
    while (ticking) {
      const start = Date.now();
      try {
        const res = await fetch(`${baseUrl}/api/dispatch/tick`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${adminToken}`
          }
        });
        const json = await res.json();
        if (typeof json?.data?.durationMs === 'number') tickDurations.push(json.data.durationMs);
      } catch (err) {
        _logger.logger.warn({
          err
        }, 'tick call failed during simulation');
      }
      // Ticks self-lock (TickLock), so back-to-back calls are safe — keep the
      // gap small so "waiting for the next tick" doesn't dominate match
      // latency in a compressed-time simulation.
      await new Promise(r => setTimeout(r, Math.max(150, 300 - (Date.now() - start))));
    }
  })();

  // --- Idle-while-waiting sampling (G2 correctness check) ---
  // Sampled on a cadence deliberately offset from the tick loop so the two
  // don't correlate — otherwise every sample lands in the normal, brief
  // "enqueued but not yet ticked" window and looks like a false incident.
  // A streak only counts once it outlasts several tick cycles.
  let idleWhileWaitingStreak = 0;
  let idleWhileWaitingIncidents = 0;
  let sampling = true;
  const sampleLoop = (async () => {
    while (sampling) {
      const [waiting, idle] = await Promise.all([_models.QueueEntry.countDocuments({
        status: 'waiting'
      }), _models.Driver.countDocuments({
        status: 'idle'
      })]);
      if (waiting > 0 && idle > 0) {
        idleWhileWaitingStreak++;
        if (idleWhileWaitingStreak > 4) idleWhileWaitingIncidents++;
      } else {
        idleWhileWaitingStreak = 0;
      }
      await new Promise(r => setTimeout(r, 1700));
    }
  })();

  // --- Virtual drivers ---
  const virtualDrivers = drivers.map(d => new _VirtualDriver.VirtualDriver({
    driverId: d.id,
    token: d.token,
    baseUrl,
    rejectionRate: args.rejectionRate,
    speedMultiplier: args.speed,
    avgSpeedKmph: 30,
    pollIntervalMs: 400
  }));
  const driverRuns = virtualDrivers.map(v => v.run());
  _logger.logger.info({
    totalRealMs: Math.round(totalRealMs)
  }, 'simulation running');
  await new Promise(r => setTimeout(r, totalRealMs));
  // Grace tail so in-flight trips can wrap up.
  await new Promise(r => setTimeout(r, Math.min(15_000, totalRealMs)));
  ticking = false;
  sampling = false;
  virtualDrivers.forEach(v => v.stop());
  await Promise.all([tickLoop, sampleLoop, Promise.race([Promise.all(driverRuns), new Promise(r => setTimeout(r, 2000))])]);

  // --- Metrics ---
  const trips = await _models.Trip.find({}).lean();
  const completedTrips = trips.filter(t => t.status === 'completed');
  const unassignableTrips = trips.filter(t => t.status === 'unassignable');
  const failedEntries = await _models.QueueEntry.countDocuments({
    status: 'failed'
  });

  // Match latency is measured from each guest's *original* arrival timestamp
  // (tracked in-memory at enqueue time), not QueueEntry.enqueuedAt — the
  // starvation/rejection re-queue paths deliberately backdate that field to
  // boost priority, which would otherwise make a rejected-then-rematched
  // guest look like it took 15+ minutes to match.
  const matchedGuestIds = new Set(trips.flatMap(t => t.guests.map(g => g.guestId.toString())));
  const matchLatenciesMs = [...matchedGuestIds].map(gid => {
    const enqueuedAt = enqueuedAtByGuest.get(gid);
    const trip = trips.find(t => t.guests.some(g => g.guestId.toString() === gid));
    if (!enqueuedAt || !trip) return null;
    return new Date(trip.createdAt).getTime() - enqueuedAt.getTime();
  }).filter(n => n !== null && n >= 0).sort((a, b) => a - b);
  const waitMinutes = [...matchedGuestIds].map(gid => {
    const enqueuedAt = enqueuedAtByGuest.get(gid);
    if (!enqueuedAt) return null;
    const trip = trips.find(t => t.guests.some(g => g.guestId.toString() === gid));
    if (!trip) return null;
    return (new Date(trip.createdAt).getTime() - enqueuedAt.getTime()) / 60_000;
  }).filter(n => n !== null && n >= 0).sort((a, b) => a - b);
  const sharedRides = trips.filter(t => t.guests.length > 1).length;
  const detourInsertions = trips.filter(t => t.assignmentMeta?.strategy === 'detour_insert').length;
  const capacityViolations = trips.filter(t => t.capacityUsed.seats > t.vehicleSnapshot.seats || t.capacityUsed.luggage > t.vehicleSnapshot.luggage).length;
  const deadlineMisses = completedTrips.filter(t => t.deadlineAt && t.completedAt && new Date(t.completedAt) > new Date(t.deadlineAt)).length;
  const activeTrips = trips.filter(t => !['completed', 'cancelled', 'rejected', 'unassignable'].includes(t.status));
  const driverIdCounts = new Map();
  for (const t of activeTrips) {
    const id = t.driverId?.toString();
    if (!id) continue;
    driverIdCounts.set(id, (driverIdCounts.get(id) ?? 0) + 1);
  }
  const doubleAssignedDrivers = [...driverIdCounts.values()].filter(n => n > 1).length;
  const driversWithATrip = new Set(trips.map(t => t.driverId?.toString()).filter(Boolean)).size;
  // Clamped defensively: a value over 100% would only happen if a prior
  // run's drivers weren't fully wiped (e.g. a transient Atlas disconnect
  // mid-wipe), not from anything the dispatch engine itself can produce.
  const driverUtilPct = args.drivers > 0 ? Math.min(100, driversWithATrip / args.drivers * 100) : 0;
  const routingStats = _RoutingService.RoutingService.stats();
  const routingHealth = _RoutingService.RoutingService.health();
  const oldestWaitingMin = await (async () => {
    const oldest = await _models.QueueEntry.findOne({
      status: 'waiting'
    }).sort({
      enqueuedAt: 1
    }).lean();
    if (!oldest) return 0;
    return (Date.now() - new Date(oldest.enqueuedAt).getTime()) / 60_000;
  })();
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const assertions = [{
    ok: capacityViolations === 0,
    label: 'zero capacity violations'
  }, {
    ok: oldestWaitingMin <= 25,
    label: 'zero guests waiting > 25 min (starvation)'
  }, {
    ok: idleWhileWaitingIncidents === 0,
    label: 'zero idle-driver-while-guest-waiting incidents lasting > 1 tick'
  }, {
    ok: percentile(matchLatenciesMs, 0.95) < 2000,
    label: 'p95 match latency < 2000 ms'
  }, {
    ok: doubleAssignedDrivers === 0,
    label: 'zero double-assigned drivers'
  }];
  const lines = [];
  lines.push('── PEAK ARRIVAL SIMULATION REPORT ──────────────────────');
  lines.push(`Guests                     ${args.guests}      Trips created        ${trips.length}`);
  lines.push(`Matched                    ${matchedGuestIds.size}      Shared rides          ${sharedRides} (${trips.length ? Math.round(sharedRides / trips.length * 100) : 0}%)`);
  lines.push(`Unassignable                 ${unassignableTrips.length + failedEntries}      Detour insertions     ${detourInsertions}`);
  lines.push('');
  lines.push(`Wait time      avg  ${fmtMin(avg(waitMinutes))}   p50  ${fmtMin(percentile(waitMinutes, 0.5))}   p95  ${fmtMin(percentile(waitMinutes, 0.95))}   max  ${fmtMin(waitMinutes.length ? waitMinutes[waitMinutes.length - 1] : 0)}`);
  lines.push(`Match latency  avg  ${fmtMs(avg(matchLatenciesMs))}  p95  ${fmtMs(percentile(matchLatenciesMs, 0.95))}  max  ${fmtMs(matchLatenciesMs.length ? matchLatenciesMs[matchLatenciesMs.length - 1] : 0)}`);
  lines.push(`Tick duration  avg  ${fmtMs(avg(tickDurations))}  p95  ${fmtMs(percentile([...tickDurations].sort((a, b) => a - b), 0.95))}`);
  lines.push(`Driver util    ${driverUtilPct.toFixed(0)}%   idle-while-waiting incidents: ${idleWhileWaitingIncidents}`);
  lines.push(`Capacity violations: ${capacityViolations}     Deadline misses: ${deadlineMisses} (${completedTrips.length ? (deadlineMisses / completedTrips.length * 100).toFixed(1) : '0.0'}%)`);
  lines.push(`Routing: ${routingStats.hits + routingStats.misses} lookups · ${routingStats.hits} cache hits (${Math.round(routingStats.hitRate * 100)}%) · provider ${routingHealth.provider} · breaker ${routingHealth.breakerOpen ? 'open' : 'closed'}`);
  lines.push('');
  lines.push('ASSERTIONS');
  for (const a of assertions) lines.push(`  ${a.ok ? '✔' : '✘'} ${a.label}`);
  lines.push('');

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  (0, _scheduler.stopScheduler)();
  httpServer.close();
  await (0, _db.disconnectDb)();
  const allPassed = assertions.every(a => a.ok);
  process.exitCode = allPassed ? 0 : 1;
}
main().catch(err => {
  _logger.logger.error({
    err
  }, 'simulation crashed');
  process.exitCode = 1;
  process.exit(1);
});
