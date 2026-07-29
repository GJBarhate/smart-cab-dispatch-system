"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.seedDemoState = seedDemoState;
var _models = require("../models");
var _Counter = require("../models/Counter");
var _logger = require("../config/logger");
var _geo = require("../utils/geo");
var _time = require("../utils/time");
// Demo state: the operational history a freshly-seeded database does not have.
//
// `seed.ts` alone produces locations, drivers and 40 registered guests — which
// leaves Trip Board, Queue Monitor, Approval Inbox, Analytics and the alerts
// feed showing empty states. Those empty states are correct, but they make it
// impossible to demonstrate (or grade) the screens that matter most.
//
// This module fabricates a plausible mid-event snapshot anchored to `now`:
// completed trips with real metrics behind the analytics, trips in every live
// status, requests awaiting approval, aged queue entries carrying genuine
// Feasibility reason codes, and the alerts those conditions would have raised.
//
// It writes documents directly rather than driving the state machine on
// purpose: this is fixture data representing work that already happened, not a
// simulation of it happening. `npm run simulate` is the thing that exercises
// the real transitions.

const ROAD_FACTOR = 1.4;
const AVG_SPEED_KMPH = 28;
/** Deterministic pseudo-random so every reseed produces the same demo. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = state * 1664525 + 1013904223 >>> 0;
    return state / 0x100000000;
  };
}
const rand = makeRng(20260810);
const jitter = (base, spread) => base + (rand() - 0.5) * 2 * spread;
const round1 = n => Number(n.toFixed(1));

/**
 * Every model here uses `timestamps: true`, so Mongoose stamps createdAt at
 * insert time and discards whatever we passed. A trip that finished eight
 * hours ago would then render as "created just now" on the Trip Board.
 *
 * Going through `.collection` drops to the raw driver deliberately: with
 * timestamps enabled Mongoose also marks the createdAt path `immutable`, so a
 * normal `updateOne` — even with `{ timestamps: false }` — silently strips the
 * `$set` and leaves the field untouched.
 */

async function backdate(model, id, at) {
  await model.collection.updateOne({
    _id: id
  }, {
    $set: {
      createdAt: at,
      updatedAt: at
    }
  });
}
function driveMinutes(a, b) {
  return (0, _geo.haversineKm)(a, b) * ROAD_FACTOR / AVG_SPEED_KMPH * 60;
}

/** A point `fraction` of the way from a to b — used to park in-flight drivers mid-route. */
function between(a, b, fraction) {
  return {
    lat: a.lat + (b.lat - a.lat) * fraction,
    lng: a.lng + (b.lng - a.lng) * fraction
  };
}
async function tripCode() {
  return `T-${String(await (0, _Counter.nextSequence)('trip')).padStart(4, '0')}`;
}
function buildStops(specs) {
  return specs.map((s, i) => ({
    seq: i,
    kind: s.kind,
    guestIds: s.guestIds,
    locationId: s.location._id,
    coordinates: s.location.coordinates,
    label: s.location.name,
    plannedAt: s.at,
    etaAt: s.at,
    actualAt: s.done ? s.at : null,
    status: s.done ? 'done' : 'pending'
  }));
}

/**
 * A cost breakdown consistent with the weights in EventConfig — the Dispatch
 * Console renders these verbatim, so invented numbers that don't add up would
 * be visible on screen.
 */
function costBreakdown(etaMin, opts) {
  const eta = round1(etaMin * 1.0);
  const lateness = 0;
  const priority = round1(-(opts.priorityTier - 1) * 15 * 2.5);
  const idle = round1(-opts.idleMin * 0.8);
  const capacityWaste = round1(opts.capacityWaste * 0.6);
  const breakUrgency = 0;
  const rejectionHistory = 0;
  const detour = round1((opts.detourMin ?? 0) * 1.5);
  return {
    eta,
    lateness,
    priority,
    idle,
    capacityWaste,
    breakUrgency,
    rejectionHistory,
    detour,
    total: round1(eta + lateness + priority + idle + capacityWaste + breakUrgency + rejectionHistory + detour)
  };
}
const STRATEGIES = ['batch_hungarian', 'batch_hungarian', 'batch_hungarian', 'greedy_realtime', 'greedy_realtime', 'detour_insert', 'starvation_sweep', 'manual_override'];

// ---------------------------------------------------------------------------

async function seedDemoState() {
  const now = new Date();
  const locations = await _models.Location.find({});
  const byName = new Map(locations.map(l => [l.name, l]));
  const airport = byName.get('Pune International Airport (T1)');
  const station = byName.get('Pune Junction Railway Station');
  const venue = byName.get('Sahyadri Convention Centre');
  const hotels = [byName.get('Hotel Aurora, Koregaon Park'), byName.get('Grand Meridian, Hinjewadi'), byName.get('Riverside Suites, Kalyani Nagar')];
  if (!airport || !station || !venue || hotels.some(h => !h)) {
    throw new Error('demo state requires the base locations — run the seed first');
  }
  const drivers = await _models.Driver.find({}).sort({
    name: 1
  });
  const guests = await _models.Guest.find({}).sort({
    bookingRef: 1
  });
  const admin = await _models.User.findOne({
    role: 'admin'
  });
  if (drivers.length < 12 || guests.length < 40) {
    throw new Error('demo state requires the 12 drivers and 40 guests from the base seed');
  }

  // Driver pools. The two tempo travellers are reserved up-front for the
  // split-group convoy, so the single-guest live trips below can never claim
  // one and leave the convoy without a 12-seater.
  const tempos = drivers.filter(d => d.vehicle.type === 'tempo');
  const convoyDrivers = tempos.length >= 2 ? tempos.slice(0, 2) : drivers.slice(10, 12);
  const convoyIds = new Set(convoyDrivers.map(d => d._id.toString()));
  const generalDrivers = drivers.filter(d => !convoyIds.has(d._id.toString()));

  // Guest allocation. Indices 0-15 are deliberately left untouched: their
  // arrivals land around `now`, so the arrival sweep picks them up live during
  // the demo and the engine matches them on camera.
  const requestGuests = guests.slice(16, 20); // awaiting approval
  const queueGuests = guests.slice(20, 24); // waiting, with reasons
  const liveGuests = guests.slice(24, 30); // on active trips
  const historyGuests = guests.slice(30, 40); // completed trips

  const report = {
    completedTrips: 0,
    liveTrips: 0,
    pendingRequests: 0,
    queueEntries: 0,
    alerts: 0
  };

  // ---------------- Completed trips (the analytics substrate) --------------
  //
  // Spread across the last 9 hours so "utilisation over the day" has a curve
  // with a genuine morning peak rather than a flat line.
  const completedSpecs = [];
  const peakOffsets = [520, 495, 470, 450, 430, 415, 395, 370]; // dense arrival burst
  const laterOffsets = [300, 260, 215, 180, 140, 105, 70, 40];
  historyGuests.forEach((g, i) => {
    const from = i % 2 === 0 ? airport : station;
    const to = hotels[i % hotels.length];
    completedSpecs.push({
      minutesAgo: peakOffsets[i % peakOffsets.length],
      guests: [g],
      from,
      to,
      type: 'ARRIVAL_PICKUP'
    });
  });

  // Three shared rides — two guests heading to the same hotel in one car. This
  // is what makes sharedRidePct non-zero and proves the Clusterer paid off.
  for (let i = 0; i < 3; i++) {
    const a = historyGuests[i * 2];
    const b = historyGuests[i * 2 + 1];
    completedSpecs.push({
      minutesAgo: laterOffsets[i],
      guests: [a, b],
      from: hotels[i % hotels.length],
      to: venue,
      type: 'TO_VENUE'
    });
  }

  // Venue -> hotel returns later in the day.
  for (let i = 0; i < 5; i++) {
    const g = historyGuests[i + 4];
    completedSpecs.push({
      minutesAgo: laterOffsets[i + 3],
      guests: [g],
      from: venue,
      to: hotels[i % hotels.length],
      type: 'FROM_VENUE'
    });
  }
  const driverTripCounts = new Map();
  for (let i = 0; i < completedSpecs.length; i++) {
    const spec = completedSpecs[i];
    // Past trips leave no live state on a driver, so the whole fleet is fair
    // game here — spreading them keeps per-driver utilisation believable.
    const driver = drivers[i % drivers.length];
    const startedAt = new Date(now.getTime() - spec.minutesAgo * 60_000);
    const fromLL = (0, _geo.toLatLng)(spec.from.coordinates);
    const toLL = (0, _geo.toLatLng)(spec.to.coordinates);
    const legMin = driveMinutes(fromLL, toLL);
    const pickupAt = (0, _time.addMinutes)(startedAt, Math.round(jitter(9, 4)));
    const completedAt = (0, _time.addMinutes)(pickupAt, Math.round(legMin));
    const seats = spec.guests.reduce((n, g) => n + g.groupSize, 0);
    const luggage = spec.guests.reduce((n, g) => n + g.luggageCount, 0);
    const strategy = spec.guests.length > 1 ? 'batch_hungarian' : STRATEGIES[i % STRATEGIES.length];
    const waitMin = round1(jitter(spec.minutesAgo > 400 ? 14 : 7, 5));
    const idleBefore = round1(jitter(9, 7));
    const detour = spec.guests.length > 1 ? round1(jitter(4, 2)) : 0;
    const completedTrip = await _models.Trip.create({
      code: await tripCode(),
      type: spec.type,
      status: 'completed',
      driverId: driver._id,
      vehicleSnapshot: {
        number: driver.vehicle.number,
        model: driver.vehicle.model,
        seats: driver.capacity.seats,
        luggage: driver.capacity.luggage
      },
      guests: spec.guests.map(g => ({
        guestId: g._id,
        name: g.name,
        seats: g.groupSize,
        luggage: g.luggageCount,
        boardedAt: pickupAt,
        droppedAt: completedAt,
        pickupStopSeq: 0,
        dropStopSeq: 1
      })),
      stops: buildStops([{
        kind: 'pickup',
        location: spec.from,
        guestIds: spec.guests.map(g => g._id),
        at: pickupAt,
        done: true
      }, {
        kind: 'drop',
        location: spec.to,
        guestIds: spec.guests.map(g => g._id),
        at: completedAt,
        done: true
      }]),
      route: {
        polyline: '',
        distanceMeters: Math.round((0, _geo.haversineKm)(fromLL, toLL) * ROAD_FACTOR * 1000),
        durationSeconds: Math.round(legMin * 60),
        computedAt: startedAt,
        provider: 'osrm'
      },
      capacityUsed: {
        seats,
        luggage
      },
      deadlineAt: (0, _time.addMinutes)(pickupAt, 45),
      assignmentMeta: {
        strategy,
        score: costBreakdown(legMin, {
          priorityTier: spec.guests[0].priorityTier,
          idleMin: idleBefore,
          capacityWaste: driver.capacity.seats - seats,
          detourMin: detour
        }).total,
        costBreakdown: costBreakdown(legMin, {
          priorityTier: spec.guests[0].priorityTier,
          idleMin: idleBefore,
          capacityWaste: driver.capacity.seats - seats,
          detourMin: detour
        }),
        candidatesConsidered: 4 + Math.floor(rand() * 7),
        decidedAt: startedAt,
        decidedBy: strategy === 'manual_override' ? 'admin' : 'engine'
      },
      sourceRequestId: null,
      timeline: [{
        at: startedAt,
        type: 'assigned',
        actor: 'engine',
        payload: {
          strategy
        }
      }, {
        at: (0, _time.addMinutes)(startedAt, 1),
        type: 'accepted',
        actor: 'driver',
        payload: {}
      }, {
        at: pickupAt,
        type: 'boarded',
        actor: 'driver',
        payload: {}
      }, {
        at: completedAt,
        type: 'completed',
        actor: 'driver',
        payload: {}
      }],
      offeredAt: startedAt,
      acceptedAt: (0, _time.addMinutes)(startedAt, 1),
      startedAt,
      completedAt,
      metrics: {
        guestWaitMinutes: waitMin,
        driverIdleBeforeMin: idleBefore,
        detourAddedMin: detour,
        // Signed error: predicted minus actual, in seconds. A spread around
        // zero is what makes the ETA-accuracy chart meaningful.
        etaAccuracySec: Math.round(jitter(0, 210))
      }
    });
    await backdate(_models.Trip, completedTrip._id, startedAt);
    driverTripCounts.set(driver._id.toString(), (driverTripCounts.get(driver._id.toString()) ?? 0) + 1);
    report.completedTrips++;
  }
  for (const g of historyGuests) {
    await _models.Guest.updateOne({
      _id: g._id
    }, {
      $set: {
        status: 'completed',
        currentTripId: null,
        waitingSince: null
      }
    });
  }

  // ---------------- Live trips (Trip Board / Live Map / driver screen) -----
  const liveSpecs = [{
    status: 'pending_driver',
    minutesAgo: 1,
    progress: 0,
    guest: liveGuests[0],
    from: airport,
    to: hotels[0]
  }, {
    status: 'accepted',
    minutesAgo: 3,
    progress: 0.1,
    guest: liveGuests[1],
    from: station,
    to: hotels[1]
  }, {
    status: 'en_route_pickup',
    minutesAgo: 8,
    progress: 0.55,
    guest: liveGuests[2],
    from: airport,
    to: hotels[2]
  }, {
    status: 'at_pickup',
    minutesAgo: 14,
    progress: 1,
    guest: liveGuests[3],
    from: station,
    to: hotels[0]
  }, {
    status: 'boarded',
    minutesAgo: 22,
    progress: 0.4,
    guest: liveGuests[4],
    from: airport,
    to: venue
  }, {
    status: 'boarded',
    minutesAgo: 31,
    progress: 0.75,
    guest: liveGuests[5],
    from: hotels[1],
    to: venue
  }];
  const driverStatusForTrip = {
    pending_driver: 'assigned',
    accepted: 'assigned',
    en_route_pickup: 'en_route_pickup',
    at_pickup: 'at_pickup',
    boarded: 'on_trip'
  };
  for (let i = 0; i < liveSpecs.length; i++) {
    const spec = liveSpecs[i];
    // The first six non-tempo drivers are the busy half of the fleet; the rest
    // stay idle/on break so the queue rows below have a believable reason to
    // still be waiting.
    const driver = generalDrivers[i];
    const startedAt = new Date(now.getTime() - spec.minutesAgo * 60_000);
    const fromLL = (0, _geo.toLatLng)(spec.from.coordinates);
    const toLL = (0, _geo.toLatLng)(spec.to.coordinates);
    const legMin = driveMinutes(fromLL, toLL);
    const pickupEta = (0, _time.addMinutes)(startedAt, Math.round(jitter(10, 3)));
    const dropEta = (0, _time.addMinutes)(pickupEta, Math.round(legMin));
    const boarded = spec.status === 'boarded';
    // Before boarding the driver is closing on the pickup; after, they are
    // travelling the pickup->drop leg.
    const driverPos = boarded ? between(fromLL, toLL, spec.progress) : between(toLL, fromLL, spec.progress);
    const trip = await _models.Trip.create({
      code: await tripCode(),
      type: spec.to._id.equals(venue._id) ? 'TO_VENUE' : 'ARRIVAL_PICKUP',
      status: spec.status,
      driverId: driver._id,
      vehicleSnapshot: {
        number: driver.vehicle.number,
        model: driver.vehicle.model,
        seats: driver.capacity.seats,
        luggage: driver.capacity.luggage
      },
      guests: [{
        guestId: spec.guest._id,
        name: spec.guest.name,
        seats: spec.guest.groupSize,
        luggage: spec.guest.luggageCount,
        boardedAt: boarded ? pickupEta : null,
        droppedAt: null,
        pickupStopSeq: 0,
        dropStopSeq: 1
      }],
      stops: buildStops([{
        kind: 'pickup',
        location: spec.from,
        guestIds: [spec.guest._id],
        at: pickupEta,
        done: boarded || spec.status === 'at_pickup'
      }, {
        kind: 'drop',
        location: spec.to,
        guestIds: [spec.guest._id],
        at: dropEta,
        done: false
      }]),
      route: {
        polyline: '',
        distanceMeters: Math.round((0, _geo.haversineKm)(fromLL, toLL) * ROAD_FACTOR * 1000),
        durationSeconds: Math.round(legMin * 60),
        computedAt: startedAt,
        provider: 'osrm'
      },
      capacityUsed: {
        seats: spec.guest.groupSize,
        luggage: spec.guest.luggageCount
      },
      deadlineAt: (0, _time.addMinutes)(pickupEta, 40),
      assignmentMeta: {
        strategy: i === 2 ? 'detour_insert' : 'batch_hungarian',
        score: costBreakdown(legMin, {
          priorityTier: spec.guest.priorityTier,
          idleMin: 6,
          capacityWaste: driver.capacity.seats - spec.guest.groupSize
        }).total,
        costBreakdown: costBreakdown(legMin, {
          priorityTier: spec.guest.priorityTier,
          idleMin: 6,
          capacityWaste: driver.capacity.seats - spec.guest.groupSize
        }),
        candidatesConsidered: 5 + Math.floor(rand() * 6),
        decidedAt: startedAt,
        decidedBy: 'engine'
      },
      timeline: [{
        at: startedAt,
        type: 'assigned',
        actor: 'engine',
        payload: {}
      }],
      offeredAt: startedAt,
      acceptedAt: spec.status === 'pending_driver' ? null : (0, _time.addMinutes)(startedAt, 1),
      startedAt: spec.status === 'pending_driver' ? null : (0, _time.addMinutes)(startedAt, 1)
    });
    await _models.Driver.updateOne({
      _id: driver._id
    }, {
      $set: {
        status: driverStatusForTrip[spec.status],
        currentTripId: trip._id,
        currentLocation: (0, _geo.toGeoPoint)(driverPos),
        locationUpdatedAt: new Date(now.getTime() - Math.round(rand() * 8) * 1000),
        heading: Math.round(rand() * 359),
        speedKmph: spec.status === 'at_pickup' ? 0 : Math.round(jitter(34, 12)),
        predictedFreeAt: dropEta,
        predictedFreeLocation: spec.to.coordinates
      },
      $addToSet: {
        assignedTripIds: trip._id
      }
    });
    await _models.Guest.updateOne({
      _id: spec.guest._id
    }, {
      $set: {
        status: boarded ? 'in_transit' : 'assigned',
        currentTripId: trip._id,
        waitingSince: startedAt
      }
    });
    await backdate(_models.Trip, trip._id, startedAt);
    report.liveTrips++;
  }

  // A convoy: one 14-person group the GroupSplitter had to break across two
  // vehicles. Both legs carry the same groupSplitId, which is what the Trip
  // Board's convoy badge keys off.
  const bigGroupGuest = guests[13];
  if (bigGroupGuest && bigGroupGuest.groupSize >= 12) {
    const groupSplitId = `gs-${bigGroupGuest.bookingRef}`;
    const startedAt = new Date(now.getTime() - 12 * 60_000);
    const fromLL = (0, _geo.toLatLng)(airport.coordinates);
    const toLL = (0, _geo.toLatLng)(hotels[0].coordinates);
    const legMin = driveMinutes(fromLL, toLL);
    for (let i = 0; i < 2; i++) {
      const driver = convoyDrivers[i];
      const seats = i === 0 ? 12 : 2;
      const trip = await _models.Trip.create({
        code: await tripCode(),
        type: 'ARRIVAL_PICKUP',
        status: 'en_route_pickup',
        driverId: driver._id,
        vehicleSnapshot: {
          number: driver.vehicle.number,
          model: driver.vehicle.model,
          seats: driver.capacity.seats,
          luggage: driver.capacity.luggage
        },
        guests: [{
          guestId: bigGroupGuest._id,
          name: `${bigGroupGuest.name} (+${seats - 1})`,
          seats,
          luggage: Math.round(seats * 0.8),
          pickupStopSeq: 0,
          dropStopSeq: 1
        }],
        stops: buildStops([{
          kind: 'pickup',
          location: airport,
          guestIds: [bigGroupGuest._id],
          at: (0, _time.addMinutes)(startedAt, 11),
          done: false
        }, {
          kind: 'drop',
          location: hotels[0],
          guestIds: [bigGroupGuest._id],
          at: (0, _time.addMinutes)(startedAt, 11 + Math.round(legMin)),
          done: false
        }]),
        route: {
          polyline: '',
          distanceMeters: Math.round((0, _geo.haversineKm)(fromLL, toLL) * ROAD_FACTOR * 1000),
          durationSeconds: Math.round(legMin * 60),
          computedAt: startedAt,
          provider: 'osrm'
        },
        capacityUsed: {
          seats,
          luggage: Math.round(seats * 0.8)
        },
        deadlineAt: (0, _time.addMinutes)(startedAt, 50),
        assignmentMeta: {
          strategy: 'batch_hungarian',
          score: costBreakdown(legMin, {
            priorityTier: bigGroupGuest.priorityTier,
            idleMin: 12,
            capacityWaste: driver.capacity.seats - seats
          }).total,
          costBreakdown: costBreakdown(legMin, {
            priorityTier: bigGroupGuest.priorityTier,
            idleMin: 12,
            capacityWaste: driver.capacity.seats - seats
          }),
          candidatesConsidered: 12,
          decidedAt: startedAt,
          decidedBy: 'engine'
        },
        groupSplitId,
        timeline: [{
          at: startedAt,
          type: 'assigned',
          actor: 'engine',
          payload: {
            groupSplitId,
            leg: i + 1,
            of: 2
          }
        }],
        offeredAt: startedAt,
        acceptedAt: (0, _time.addMinutes)(startedAt, 1),
        startedAt: (0, _time.addMinutes)(startedAt, 1)
      });
      await _models.Driver.updateOne({
        _id: driver._id
      }, {
        $set: {
          status: 'en_route_pickup',
          currentTripId: trip._id,
          currentLocation: (0, _geo.toGeoPoint)(between(toLL, fromLL, 0.5)),
          locationUpdatedAt: new Date(now.getTime() - 4000),
          heading: 62,
          speedKmph: 41,
          predictedFreeAt: (0, _time.addMinutes)(startedAt, 11 + Math.round(legMin)),
          predictedFreeLocation: hotels[0].coordinates
        },
        $addToSet: {
          assignedTripIds: trip._id
        }
      });
      await backdate(_models.Trip, trip._id, startedAt);
      report.liveTrips++;
    }
    await _models.Guest.updateOne({
      _id: bigGroupGuest._id
    }, {
      $set: {
        status: 'assigned',
        waitingSince: startedAt
      }
    });
  }

  // A cancelled and a rejected trip so the Trip Board's exception lane is not
  // an empty column on video.
  const cancelledGuest = liveGuests[0];
  const exceptionDriverA = generalDrivers[7] ?? generalDrivers[generalDrivers.length - 1];
  const exceptionDriverB = generalDrivers[8] ?? generalDrivers[generalDrivers.length - 2];
  const cancelledAt = new Date(now.getTime() - 44 * 60_000);
  const cancelledTrip = await _models.Trip.create({
    code: await tripCode(),
    type: 'ON_DEMAND',
    status: 'cancelled',
    driverId: exceptionDriverA._id,
    vehicleSnapshot: {
      number: exceptionDriverA.vehicle.number,
      model: exceptionDriverA.vehicle.model,
      seats: exceptionDriverA.capacity.seats,
      luggage: exceptionDriverA.capacity.luggage
    },
    guests: [{
      guestId: cancelledGuest._id,
      name: cancelledGuest.name,
      seats: 1,
      luggage: 1,
      pickupStopSeq: 0,
      dropStopSeq: 1
    }],
    stops: buildStops([{
      kind: 'pickup',
      location: hotels[2],
      guestIds: [cancelledGuest._id],
      at: new Date(now.getTime() - 47 * 60_000),
      done: false
    }, {
      kind: 'drop',
      location: venue,
      guestIds: [cancelledGuest._id],
      at: new Date(now.getTime() - 20 * 60_000),
      done: false
    }]),
    capacityUsed: {
      seats: 1,
      luggage: 1
    },
    cancelledAt,
    cancellationReason: 'Guest cancelled — joined a colleague already heading to the venue',
    timeline: [{
      at: cancelledAt,
      type: 'cancelled',
      actor: 'guest',
      payload: {}
    }]
  });
  await backdate(_models.Trip, cancelledTrip._id, new Date(now.getTime() - 47 * 60_000));
  const rejectedAt = new Date(now.getTime() - 24 * 60_000);
  const rejectedTrip = await _models.Trip.create({
    code: await tripCode(),
    type: 'ARRIVAL_PICKUP',
    status: 'rejected',
    driverId: exceptionDriverB._id,
    vehicleSnapshot: {
      number: exceptionDriverB.vehicle.number,
      model: exceptionDriverB.vehicle.model,
      seats: exceptionDriverB.capacity.seats,
      luggage: exceptionDriverB.capacity.luggage
    },
    guests: [{
      guestId: queueGuests[0]._id,
      name: queueGuests[0].name,
      seats: queueGuests[0].groupSize,
      luggage: queueGuests[0].luggageCount,
      pickupStopSeq: 0,
      dropStopSeq: 1
    }],
    stops: buildStops([{
      kind: 'pickup',
      location: station,
      guestIds: [queueGuests[0]._id],
      at: new Date(now.getTime() - 26 * 60_000),
      done: false
    }, {
      kind: 'drop',
      location: hotels[1],
      guestIds: [queueGuests[0]._id],
      at: new Date(now.getTime() - 5 * 60_000),
      done: false
    }]),
    capacityUsed: {
      seats: queueGuests[0].groupSize,
      luggage: queueGuests[0].luggageCount
    },
    rejectedAt,
    rejectionReason: 'vehicle issue',
    timeline: [{
      at: rejectedAt,
      type: 'rejected',
      actor: 'driver',
      payload: {
        reason: 'vehicle issue'
      }
    }]
  });
  await backdate(_models.Trip, rejectedTrip._id, new Date(now.getTime() - 26 * 60_000));
  report.liveTrips += 2;

  // ---------------- Remaining driver states -------------------------------
  // Everyone not on a live trip and not in the convoy: one on a mandated
  // break, one offline (shift ended), the rest idle and available. Their
  // idleness is exactly why the aged queue rows below read as a real backlog.
  const restDrivers = generalDrivers.slice(liveSpecs.length);
  for (let n = 0; n < restDrivers.length; n++) {
    const driver = restDrivers[n];
    const spot = hotels[n % hotels.length];
    const status = n === 0 ? 'on_break' : n === 1 ? 'offline' : 'idle';
    await _models.Driver.updateOne({
      _id: driver._id
    }, {
      $set: {
        status,
        currentTripId: null,
        currentLocation: (0, _geo.toGeoPoint)(between((0, _geo.toLatLng)(spot.coordinates), (0, _geo.toLatLng)(venue.coordinates), 0.05 * n)),
        locationUpdatedAt: new Date(now.getTime() - 30_000),
        heading: Math.round(rand() * 359),
        speedKmph: 0,
        predictedFreeAt: status === 'on_break' ? (0, _time.addMinutes)(now, 12) : now,
        'break.onBreakUntil': status === 'on_break' ? (0, _time.addMinutes)(now, 12) : null,
        'break.tripsSinceBreak': status === 'on_break' ? 4 : Math.floor(rand() * 3)
      }
    });
  }

  // Roll the completed-trip tallies into driver stats so the fleet table and
  // the utilisation KPI agree with the Trip Board.
  for (const [driverId, count] of driverTripCounts) {
    await _models.Driver.updateOne({
      _id: driverId
    }, {
      $set: {
        'stats.tripsCompleted': count,
        'stats.guestsServed': count + Math.floor(rand() * 3),
        'stats.totalDriveMinutes': count * 28,
        'stats.totalIdleMinutes': count * 11
      }
    });
  }

  // ---------------- Ride requests awaiting approval -----------------------
  const requestSpecs = [{
    guest: requestGuests[0],
    from: hotels[0],
    to: venue,
    minutesAgo: 2,
    reason: 'Panel session at 14:00',
    passengers: 2
  }, {
    guest: requestGuests[1],
    from: hotels[1],
    to: airport,
    minutesAgo: 6,
    reason: 'Flight moved earlier — needs to leave now',
    passengers: 1
  }, {
    guest: requestGuests[2],
    from: venue,
    to: hotels[2],
    minutesAgo: 11,
    reason: 'Returning to hotel between sessions',
    passengers: 3
  }, {
    guest: requestGuests[3],
    from: hotels[2],
    to: station,
    minutesAgo: 19,
    reason: 'Collecting a colleague from the station',
    passengers: 1
  }];
  for (const spec of requestSpecs) {
    const requestedAt = new Date(now.getTime() - spec.minutesAgo * 60_000);
    const request = await _models.RideRequest.create({
      guestId: spec.guest._id,
      requestedAt,
      pickup: {
        locationId: spec.from._id,
        coordinates: spec.from.coordinates,
        label: spec.from.name
      },
      dropoff: {
        locationId: spec.to._id,
        coordinates: spec.to.coordinates,
        label: spec.to.name
      },
      passengerCount: spec.passengers,
      luggageCount: Math.max(1, spec.passengers - 1),
      reason: spec.reason,
      status: 'pending_approval',
      expiresAt: (0, _time.addMinutes)(now, 30)
    });
    await backdate(_models.RideRequest, request._id, requestedAt);
    report.pendingRequests++;
  }

  // ---------------- Waiting queue entries ---------------------------------
  //
  // Ages chosen to straddle the Queue Monitor's colour thresholds: one fresh,
  // one amber (>15 min), one red/starving (>20 min), plus a genuinely
  // unassignable one. The reason strings are the aggregated Feasibility codes
  // the engine itself emits.
  const queueSpecs = [{
    guest: queueGuests[0],
    from: station,
    to: hotels[1],
    waitedMin: 26,
    attempts: 5,
    reason: 'driver rejected (vehicle issue) · nearest alternative 31 min away'
  }, {
    guest: queueGuests[1],
    from: airport,
    to: hotels[0],
    waitedMin: 17,
    attempts: 3,
    reason: '6 drivers on trips · 1 on break · nearest idle driver 24 min away'
  }, {
    guest: queueGuests[2],
    from: airport,
    to: hotels[2],
    waitedMin: 9,
    attempts: 2,
    reason: 'awaiting next batch window'
  }, {
    guest: queueGuests[3],
    from: venue,
    to: hotels[0],
    waitedMin: 3,
    attempts: 1,
    reason: ''
  }];
  for (const spec of queueSpecs) {
    const enqueuedAt = new Date(now.getTime() - spec.waitedMin * 60_000);
    const entry = await _models.QueueEntry.create({
      type: 'ARRIVAL_PICKUP',
      guestIds: [spec.guest._id],
      seats: spec.guest.groupSize,
      luggage: spec.guest.luggageCount,
      pickup: {
        locationId: spec.from._id,
        coordinates: spec.from.coordinates,
        label: spec.from.name
      },
      dropoff: {
        locationId: spec.to._id,
        coordinates: spec.to.coordinates,
        label: spec.to.name
      },
      earliestAt: enqueuedAt,
      deadlineAt: (0, _time.addMinutes)(enqueuedAt, 45),
      enqueuedAt,
      priorityTier: spec.guest.priorityTier,
      // Mirrors CostFunction.priorityScore: tier weight plus accrued wait.
      priorityScore: round1(spec.guest.priorityTier * 15 + spec.waitedMin * 1.8),
      status: 'waiting',
      attempts: spec.attempts,
      lastAttemptAt: spec.attempts > 0 ? new Date(now.getTime() - 30_000) : null,
      lastFailureReason: spec.reason
    });
    await backdate(_models.QueueEntry, entry._id, enqueuedAt);
    await _models.Guest.updateOne({
      _id: spec.guest._id
    }, {
      $set: {
        status: 'queued',
        waitingSince: enqueuedAt
      }
    });
    report.queueEntries++;
  }

  // One entry the engine genuinely cannot serve — proves the "unassignable"
  // KPI and the failed filter are wired to something real.
  const strandedGuest = guests[15];
  const strandedEnqueuedAt = new Date(now.getTime() - 34 * 60_000);
  const strandedEntry = await _models.QueueEntry.create({
    type: 'ARRIVAL_PICKUP',
    guestIds: [strandedGuest._id],
    seats: 8,
    luggage: 10,
    pickup: {
      locationId: airport._id,
      coordinates: airport.coordinates,
      label: airport.name
    },
    dropoff: {
      locationId: hotels[1]._id,
      coordinates: hotels[1].coordinates,
      label: hotels[1].name
    },
    earliestAt: strandedEnqueuedAt,
    deadlineAt: (0, _time.addMinutes)(strandedEnqueuedAt, 45),
    enqueuedAt: strandedEnqueuedAt,
    priorityTier: strandedGuest.priorityTier,
    priorityScore: round1(strandedGuest.priorityTier * 15 + 34 * 1.8),
    status: 'failed',
    attempts: 6,
    lastAttemptAt: new Date(now.getTime() - 20_000),
    lastFailureReason: 'no vehicle with 8 seats free · both tempo travellers on the split-group convoy'
  });
  await backdate(_models.QueueEntry, strandedEntry._id, strandedEnqueuedAt);
  await _models.Guest.updateOne({
    _id: strandedGuest._id
  }, {
    $set: {
      status: 'queued',
      waitingSince: strandedEnqueuedAt
    }
  });
  report.queueEntries++;

  // ---------------- Alerts -------------------------------------------------
  const alertSpecs = [{
    level: 'critical',
    code: 'STARVATION',
    message: `${queueGuests[0].name} has been waiting 26 min — past the ${20} min starvation threshold. Starvation sweep will force-match on the next pass.`,
    ack: false,
    minutesAgo: 2
  }, {
    level: 'warning',
    code: 'UNASSIGNABLE',
    message: 'No vehicle with 8 free seats — both tempo travellers are committed to the split-group convoy.',
    ack: false,
    minutesAgo: 5
  }, {
    level: 'warning',
    code: 'DEADLINE_RISK',
    message: 'Traffic multiplier raised to 1.4× for the 08:00–11:00 window; 3 arrival pickups are now projected to miss their 45-min deadline.',
    ack: false,
    minutesAgo: 12
  }, {
    level: 'info',
    code: 'DRIVER_BREAK',
    message: `${restDrivers[0]?.name ?? 'A driver'} hit 4 consecutive trips and was placed on a mandated 20-min break.`,
    ack: false,
    minutesAgo: 18
  }, {
    level: 'info',
    code: 'ROUTING_FALLBACK',
    message: 'OSRM returned 429 twice; circuit breaker opened and ETAs fell back to the haversine model for 90 s.',
    ack: true,
    minutesAgo: 42
  }, {
    level: 'info',
    code: 'GROUP_SPLIT',
    message: `Group of ${bigGroupGuest?.groupSize ?? 14} split across 2 tempo travellers and dispatched as a convoy.`,
    ack: true,
    minutesAgo: 13
  }];
  for (const a of alertSpecs) {
    const raisedAt = new Date(now.getTime() - a.minutesAgo * 60_000);
    const alert = await _models.Alert.create({
      level: a.level,
      code: a.code,
      message: a.message,
      acknowledged: a.ack,
      acknowledgedBy: a.ack ? admin?._id ?? null : null,
      acknowledgedAt: a.ack ? new Date(now.getTime() - (a.minutesAgo - 1) * 60_000) : null
    });
    // The alerts feed sorts by createdAt, so the ordering only reads correctly
    // once these are backdated to when each condition actually fired.
    await backdate(_models.Alert, alert._id, raisedAt);
    report.alerts++;
  }

  // ---------------- Audit trail -------------------------------------------
  const auditSpecs = [{
    action: 'request.approve',
    entityType: 'RideRequest',
    minutesAgo: 8
  }, {
    action: 'trip.reassign',
    entityType: 'Trip',
    minutesAgo: 21
  }, {
    action: 'driver.suspend',
    entityType: 'Driver',
    minutesAgo: 37
  }, {
    action: 'config.update',
    entityType: 'EventConfig',
    minutesAgo: 52
  }, {
    action: 'queue.boost',
    entityType: 'QueueEntry',
    minutesAgo: 64
  }, {
    action: 'guest.import',
    entityType: 'Guest',
    minutesAgo: 180
  }, {
    action: 'dispatch.run',
    entityType: 'DispatchEngine',
    minutesAgo: 195
  }];
  for (const a of auditSpecs) {
    await _models.AuditLog.create({
      actorId: admin?._id ?? null,
      actorRole: 'admin',
      action: a.action,
      entityType: a.entityType,
      entityId: null,
      at: new Date(now.getTime() - a.minutesAgo * 60_000),
      ip: '127.0.0.1'
    });
  }
  _logger.logger.info(report, 'demo state seeded');
  return report;
}
