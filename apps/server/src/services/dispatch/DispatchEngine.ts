// The dispatch tick orchestrator (plan.md §8.1/§8.2). Runs the three
// strategies in order — detour insertion (reuses a driver already moving,
// zero new deadhead), batch Hungarian (globally optimal for what's left),
// greedy (stragglers) — each cheaper and less disruptive than the next.
import { EventConfig } from '../../models/EventConfig';
import { QueueEntry } from '../../models/QueueEntry';
import { Trip } from '../../models/Trip';
import { Driver } from '../../models/Driver';
import { Guest } from '../../models/Guest';
import { toGeoPoint, toLatLng, haversineKm } from '../../utils/geo';
import { minutesBetween } from '../../utils/time';
import { RoutingService } from '../routing/RoutingService';
import { NotificationService } from '../NotificationService';
import { AlertService } from '../AlertService';
import { toDispatchConfig } from './config';
import { acquireTickLock, releaseTickLock } from './TickLock';
import { DriverStateService } from './DriverStateService';
import { Feasibility } from './Feasibility';
import { CostFunction } from './CostFunction';
import { BatchAssigner } from './BatchAssigner';
import { Clusterer } from './Clusterer';
import { GroupSplitter } from './GroupSplitter';
import { DetourInserter } from './DetourInserter';
import { GreedyMatcher } from './GreedyMatcher';
import { TripService } from './TripService';
import { BIG_M } from './types';
import type { ClusterableEntry, ClusterDemand } from './Clusterer';
import type { SplittableMember } from './GroupSplitter';
import type { CostBreakdown, DispatchConfig, DispatchDemand } from './types';

const SERVICE_TIME_MIN = 3;
const AVG_SPEED_KMPH = 30;
const ROAD_FACTOR = 1.4;
const GREEDY_SWEEP_CONCURRENCY = 10;

async function mapWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

export interface TickReport {
  skipped?: string;
  matched: number;
  unassignable: number;
  durationMs: number;
}

interface PendingDemand {
  demand: DispatchDemand;
  sourceEntryIds: string[];
  groupSplitId: string | null;
}

function roughTripMinutes(pickup: DispatchDemand['pickup'], dropoff: DispatchDemand['dropoff']): number {
  return ((haversineKm(pickup, dropoff) * ROAD_FACTOR) / AVG_SPEED_KMPH) * 60;
}

function toClusterableEntry(entry: InstanceType<typeof QueueEntry>, now: Date): ClusterableEntry {
  return {
    id: entry._id.toString(),
    type: entry.type,
    guestIds: entry.guestIds.map((id: any) => id.toString()),
    seats: entry.seats,
    luggage: entry.luggage,
    pickup: toLatLng(entry.pickup!.coordinates as any),
    pickupLocationId: entry.pickup!.locationId ? entry.pickup!.locationId.toString() : null,
    dropoff: toLatLng(entry.dropoff!.coordinates as any),
    dropoffLocationId: entry.dropoff!.locationId ? entry.dropoff!.locationId.toString() : null,
    earliestAt: entry.earliestAt,
    deadlineAt: entry.deadlineAt,
    enqueuedAt: entry.enqueuedAt ?? now,
    priorityTier: entry.priorityTier,
    wasRejectedBefore: (entry.rejectedDriverIds ?? []).length > 0
  };
}

function demandFromSingleEntry(entry: InstanceType<typeof QueueEntry>, now: Date): DispatchDemand {
  const e = toClusterableEntry(entry, now);
  return {
    id: e.id,
    type: e.type,
    seats: e.seats,
    luggage: e.luggage,
    priorityTier: e.priorityTier,
    waitedMinutes: Math.max(0, minutesBetween(e.enqueuedAt, now)),
    earliestAt: e.earliestAt,
    deadlineAt: e.deadlineAt,
    pickup: e.pickup,
    dropoff: e.dropoff,
    wasRejectedBefore: e.wasRejectedBefore
  };
}

function demandFromCluster(id: string, cluster: ClusterDemand, seats: number, luggage: number, now: Date): DispatchDemand {
  return {
    id,
    type: cluster.type,
    seats,
    luggage,
    priorityTier: cluster.priorityTier,
    waitedMinutes: Math.max(0, minutesBetween(cluster.enqueuedAt, now)),
    earliestAt: cluster.earliestAt,
    deadlineAt: cluster.deadlineAt,
    pickup: cluster.pickup,
    dropoff: cluster.dropoff,
    wasRejectedBefore: cluster.wasRejectedBefore
  };
}

function expandCluster(
  cluster: ClusterDemand,
  entryById: Map<string, InstanceType<typeof QueueEntry>>,
  maxSeats: number,
  maxLuggage: number,
  now: Date
): PendingDemand[] {
  const members: SplittableMember[] = cluster.memberEntryIds.map((id) => {
    const e = entryById.get(id)!;
    return { id, guestIds: e.guestIds.map((g: any) => g.toString()), seats: e.seats, luggage: e.luggage };
  });

  if (!GroupSplitter.needsSplit(members, { maxSeats, maxLuggage })) {
    return [
      {
        demand: demandFromCluster(cluster.memberEntryIds[0], cluster, cluster.seats, cluster.luggage, now),
        sourceEntryIds: cluster.memberEntryIds,
        groupSplitId: null
      }
    ];
  }

  const chunks = GroupSplitter.split(members, { maxSeats, maxLuggage });
  return chunks.map((chunk, i) => ({
    demand: demandFromCluster(`${cluster.memberEntryIds[0]}#chunk${i}`, cluster, chunk.seats, chunk.luggage, now),
    sourceEntryIds: Array.from(new Set(chunk.memberIds.map((mid) => mid.split('#')[0]))),
    groupSplitId: chunk.groupSplitId
  }));
}

async function expireStaleOffers(offerTimeoutSec: number, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - offerTimeoutSec * 1000);
  const stale = await Trip.find({ status: 'pending_driver', offeredAt: { $lt: cutoff } });

  for (const trip of stale) {
    const guestIds = trip.guests.map((g: any) => g.guestId.toString());
    await TripService.requeueGuests(guestIds, 'offer_expired');
    if (trip.driverId) await TripService.releaseDriver(trip.driverId.toString());
    await Trip.updateOne({ _id: trip._id }, { $set: { status: 'rejected', rejectionReason: 'offer_expired', rejectedAt: now } });
  }
}

function raiseAlert(level: 'info' | 'warning' | 'critical', code: string, message: string): void {
  AlertService.raise(level, code, message).catch(() => {
    // Best-effort — an alert failing to persist must never abort a tick.
  });
}

async function buildGuestLineItems(guestIds: string[]): Promise<Array<{ guestId: string; name: string; seats: number; luggage: number }>> {
  const guests = await Guest.find({ _id: { $in: guestIds } }).select('name groupSize luggageCount').lean();
  return guests.map((g: any) => ({
    guestId: g._id.toString(),
    name: g.name,
    seats: g.groupSize,
    luggage: g.luggageCount
  }));
}

async function commitAssignment(
  driverDoc: InstanceType<typeof Driver>,
  demand: DispatchDemand,
  pending: PendingDemand,
  strategy: string,
  score: number,
  breakdown: CostBreakdown,
  candidatesConsidered: number
): Promise<void> {
  const entryDocs = await QueueEntry.find({ _id: { $in: pending.sourceEntryIds } }).lean();
  const guestIds = entryDocs.flatMap((e: any) => e.guestIds.map((g: any) => g.toString()));
  const guests = await buildGuestLineItems(guestIds);

  const trip = await TripService.createFromAssignment({
    type: demand.type,
    driverId: driverDoc._id.toString(),
    entryIds: pending.sourceEntryIds,
    guests,
    stops: [
      { kind: 'pickup', guestIds, locationId: null, coordinates: demand.pickup, label: 'Pickup' },
      { kind: 'drop', guestIds, locationId: null, coordinates: demand.dropoff, label: 'Drop-off' }
    ],
    vehicleSnapshot: {
      number: driverDoc.vehicle!.number,
      model: driverDoc.vehicle!.model,
      seats: driverDoc.capacity!.seats,
      luggage: driverDoc.capacity!.luggage
    },
    capacityUsed: { seats: demand.seats, luggage: demand.luggage },
    deadlineAt: demand.deadlineAt,
    strategy,
    score,
    costBreakdown: breakdown,
    candidatesConsidered,
    decidedBy: 'engine',
    groupSplitId: pending.groupSplitId,
    sourceRequestId: null
  });

  NotificationService.tripOffered(driverDoc._id.toString(), { trip: trip.toJSON() });
}

async function insertDetour(entry: InstanceType<typeof QueueEntry>, insertion: NonNullable<Awaited<ReturnType<typeof DetourInserter.findBest>>>, now: Date): Promise<void> {
  const trip = await Trip.findById(insertion.tripId);
  if (!trip) return;

  trip.stops = insertion.stops.map((s, i) => ({
    seq: i,
    kind: s.kind,
    guestIds: s.guestIds as any,
    locationId: s.locationId as any,
    coordinates: toGeoPoint(s.coordinates),
    label: s.label,
    plannedAt: null,
    etaAt: null,
    actualAt: null,
    status: 'pending'
  })) as any;
  trip.capacityUsed = {
    seats: (trip.capacityUsed?.seats ?? 0) + entry.seats,
    luggage: (trip.capacityUsed?.luggage ?? 0) + entry.luggage
  };
  trip.guests.push(
    ...(await buildGuestLineItems(entry.guestIds.map((g: any) => g.toString()))).map((g) => ({
      guestId: g.guestId as any,
      name: g.name,
      seats: g.seats,
      luggage: g.luggage,
      boardedAt: null,
      droppedAt: null,
      pickupStopSeq: null,
      dropStopSeq: null
    }))
  );
  trip.timeline.push({ at: now, type: 'detour_insert', actor: 'engine', payload: { entryId: entry._id.toString(), addedMinutes: insertion.addedMinutes } });
  await trip.save();

  await QueueEntry.updateOne({ _id: entry._id }, { $set: { status: 'assigned' } });
  await Guest.updateMany({ _id: { $in: entry.guestIds } }, { $set: { status: 'assigned', currentTripId: trip._id } });
}

export const DispatchEngine = {
  async tick(): Promise<TickReport> {
    const t0 = Date.now();
    const now = new Date();

    const cfgDoc = await EventConfig.findOne({ singleton: 'singleton' });
    if (!cfgDoc) return { matched: 0, unassignable: 0, durationMs: Date.now() - t0, skipped: 'no_event_config' };
    if (!cfgDoc.featureFlags!.autoDispatchEnabled) {
      return { matched: 0, unassignable: 0, durationMs: Date.now() - t0, skipped: 'disabled' };
    }

    const cfg: DispatchConfig = toDispatchConfig(cfgDoc);

    const gotLock = await acquireTickLock(25_000);
    if (!gotLock) return { matched: 0, unassignable: 0, durationMs: Date.now() - t0, skipped: 'locked' };

    try {
      await DriverStateService.refreshPredictedFreeState();
      await expireStaleOffers(cfg.offerTimeoutSec, now);

      const horizonAt = new Date(now.getTime() + cfg.batchHorizonMin * 60_000);
      const entryDocs = await QueueEntry.find({
        status: 'waiting',
        earliestAt: { $lte: horizonAt },
        $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }]
      })
        .sort({ priorityScore: -1 })
        .limit(200);

      if (entryDocs.length === 0) return { matched: 0, unassignable: 0, durationMs: Date.now() - t0 };

      let matched = 0;
      const stillWaiting: Array<InstanceType<typeof QueueEntry>> = [];

      // --- 1. Detour insertion first (cheapest — zero new deadhead) ---
      if (cfgDoc.featureFlags!.detourEnabled) {
        for (const entry of entryDocs) {
          const demand = demandFromSingleEntry(entry, now);
          const insertion = await DetourInserter.findBest(demand, cfg, now);
          if (!insertion) {
            stillWaiting.push(entry);
            continue;
          }
          try {
            await insertDetour(entry, insertion, now);
            matched++;
          } catch (err) {
            // Most likely a Mongoose VersionError: the driver accepted/
            // arrived/boarded/dropped this same trip between findBest()
            // scoring it and this save (optimistic concurrency, not a bug
            // to prevent with heavier locking — just retry via the next
            // tick or another matching path).
            void err;
            stillWaiting.push(entry);
          }
        }
      } else {
        stillWaiting.push(...entryDocs);
      }

      if (stillWaiting.length === 0) return { matched, unassignable: 0, durationMs: Date.now() - t0 };

      // --- 2. Supply ---
      const eligible = await DriverStateService.listEligibleDrivers(cfg, now);
      if (eligible.length === 0) {
        raiseAlert('warning', 'NO_SUPPLY', `${stillWaiting.length} demand(s) waiting with no eligible driver`);
        return { matched, unassignable: stillWaiting.length, durationMs: Date.now() - t0, skipped: 'no_supply' };
      }

      const maxFleetSeats = Math.max(...eligible.map((e) => e.plain.capacitySeats));
      const maxFleetLuggage = Math.max(...eligible.map((e) => e.plain.capacityLuggage));

      // --- 3. Cluster the remainder into shared rides ---
      const entryById = new Map(stillWaiting.map((e) => [e._id.toString(), e]));
      const clusterableEntries = stillWaiting.map((e) => toClusterableEntry(e, now));
      const clusters = Clusterer.build(
        clusterableEntries,
        {
          maxSharedGuestsPerTrip: cfg.maxSharedGuestsPerTrip,
          clusterRadiusM: cfg.clusterRadiusM,
          clusterTimeWindowMin: cfg.clusterTimeWindowMin,
          maxVehicleSeats: maxFleetSeats,
          maxVehicleLuggage: maxFleetLuggage
        },
        now
      );

      // --- 4. Split any cluster larger than the biggest available vehicle ---
      const pendingDemands: PendingDemand[] = clusters.flatMap((c) => expandCluster(c, entryById, maxFleetSeats, maxFleetLuggage, now));

      // --- 5. One matrix call: driver predicted-free positions -> demand pickups ---
      const { durations } = await RoutingService.matrix(
        eligible.map((e) => e.plain.predictedFreeLocation),
        pendingDemands.map((p) => p.demand.pickup)
      );

      // --- 6. Cost matrix with hard feasibility mask ---
      const cost: number[][] = eligible.map((driver, i) =>
        pendingDemands.map((p, j) => {
          const pickupEtaMin = (durations[i]?.[j] ?? Infinity) / 60;
          const estimatedTripEndAt = new Date(
            now.getTime() + (pickupEtaMin + SERVICE_TIME_MIN + roughTripMinutes(p.demand.pickup, p.demand.dropoff)) * 60_000
          );
          const feasibility = Feasibility.check(driver.plain, p.demand, { now, pickupEtaMin, estimatedTripEndAt }, cfg);
          if (!feasibility.ok) return BIG_M;

          const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
          return CostFunction.score(driver.plain, p.demand, { now, pickupEtaMin, arrivalAt }, cfg).total;
        })
      );

      // --- 7. Hungarian ---
      const pairs = BatchAssigner.solve(cost);
      const resolvedEntryIds = new Set<string>();

      // Each pair touches a distinct driver (Hungarian never reuses a row),
      // so these commits are independent and safe to run concurrently —
      // trip codes come from an atomic counter (Counter.nextSequence) and
      // driver claims are an atomic findOneAndUpdate, so there's no race to
      // guard against here, only the sequential-Atlas-round-trip cost to
      // avoid (dozens of commits at 100-300ms each adds up to a very slow
      // tick otherwise).
      const feasiblePairs = pairs.filter(({ driverIndex, demandIndex }) => cost[driverIndex][demandIndex] < BIG_M);
      await mapWithConcurrency(feasiblePairs, GREEDY_SWEEP_CONCURRENCY, async ({ driverIndex, demandIndex }) => {
        const driver = eligible[driverIndex];
        const pending = pendingDemands[demandIndex];
        const pickupEtaMin = (durations[driverIndex]?.[demandIndex] ?? 0) / 60;
        const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
        const { total, breakdown } = CostFunction.score(driver.plain, pending.demand, { now, pickupEtaMin, arrivalAt }, cfg);

        await commitAssignment(driver.doc, pending.demand, pending, 'batch_hungarian', total, breakdown, pendingDemands.length);
        matched++;
        pending.sourceEntryIds.forEach((id) => resolvedEntryIds.add(id));
      });

      // --- 8. Greedy sweep for anything still unmatched ---
      // Each demand's Driver.find + matrix + commit is independent of the
      // others, so this runs with bounded concurrency rather than fully
      // sequentially — with dozens of leftover demands after a burst, doing
      // this one at a time turned a single tick into a multi-minute stall
      // (each iteration pays a real Atlas round trip). TripService.claimDriver
      // is still an atomic findOneAndUpdate, so concurrent iterations can
      // never double-assign a driver — a lost race just fails that one
      // demand's commit, which is caught below and simply retried next tick.
      const stillUnmatched = pendingDemands.filter((p) => !p.sourceEntryIds.every((id) => resolvedEntryIds.has(id)));
      let unassignable = 0;
      await mapWithConcurrency(stillUnmatched, GREEDY_SWEEP_CONCURRENCY, async (pending) => {
        try {
          const result = await GreedyMatcher.findBest(pending.demand, cfg, now);
          if (result) {
            await commitAssignment(result.driver, pending.demand, pending, 'greedy_realtime', result.score, result.breakdown, 1);
            matched++;
            pending.sourceEntryIds.forEach((id) => resolvedEntryIds.add(id));
            return;
          }
        } catch (err) {
          // Most likely a claimDriver race lost to a concurrent iteration —
          // treat it the same as "no feasible driver this tick".
          void err;
        }
        unassignable++;
        await QueueEntry.updateMany(
          { _id: { $in: pending.sourceEntryIds } },
          { $inc: { attempts: 1 }, $set: { lastAttemptAt: now, lastFailureReason: 'no_feasible_driver' } }
        );
      });

      if (unassignable > 0) {
        raiseAlert('warning', 'UNASSIGNABLE', `${unassignable} demand(s) could not be matched this tick`);
      }

      NotificationService.dispatchTick({ matched, unassignable, durationMs: Date.now() - t0, at: now.toISOString() });

      return { matched, unassignable, durationMs: Date.now() - t0 };
    } finally {
      await releaseTickLock();
    }
  },

  /**
   * Matches one waiting QueueEntry right now via GreedyMatcher, bypassing the
   * tick's batch/cluster machinery entirely. Used by the starvation sweep
   * (plan.md §8.4 hard pre-emption rule) and by admin-approval / driver-
   * rejection flows that must not wait for the next tick (§8.7).
   */
  async matchEntryNow(entryId: string, strategy: string = 'greedy_realtime'): Promise<boolean> {
    const cfgDoc = await EventConfig.findOne({ singleton: 'singleton' });
    if (!cfgDoc) return false;

    const entry = await QueueEntry.findById(entryId);
    if (!entry || entry.status !== 'waiting') return false;

    const cfg = toDispatchConfig(cfgDoc);
    const now = new Date();
    const demand = demandFromSingleEntry(entry, now);

    const result = await GreedyMatcher.findBest(demand, cfg, now);
    if (!result) return false;

    await commitAssignment(result.driver, demand, { demand, sourceEntryIds: [entry._id.toString()], groupSplitId: null }, strategy, result.score, result.breakdown, 1);
    return true;
  },

  /**
   * Dry run of steps 2-7 of tick() — clusters demand, builds the real cost
   * matrix, and solves it, but commits nothing. Powers the admin Dispatch
   * Console's "Preview batch" heatmap (plan.md §9.5, §12.2).
   */
  async previewBatch(): Promise<{
    drivers: Array<{ id: string; name: string }>;
    demands: Array<{ id: string; guestIds: string[]; seats: number; luggage: number }>;
    costMatrix: number[][];
    chosenPairs: Array<{ driverIndex: number; demandIndex: number; cost: number; breakdown: CostBreakdown }>;
  }> {
    const cfgDoc = await EventConfig.findOne({ singleton: 'singleton' });
    if (!cfgDoc) return { drivers: [], demands: [], costMatrix: [], chosenPairs: [] };

    const cfg = toDispatchConfig(cfgDoc);
    const now = new Date();

    const entryDocs = await QueueEntry.find({ status: 'waiting' }).sort({ priorityScore: -1 }).limit(200);
    const eligible = await DriverStateService.listEligibleDrivers(cfg, now);
    if (entryDocs.length === 0 || eligible.length === 0) {
      return { drivers: eligible.map((e) => ({ id: e.plain.id, name: e.doc.name })), demands: [], costMatrix: [], chosenPairs: [] };
    }

    const maxFleetSeats = Math.max(...eligible.map((e) => e.plain.capacitySeats));
    const maxFleetLuggage = Math.max(...eligible.map((e) => e.plain.capacityLuggage));

    const entryById = new Map(entryDocs.map((e) => [e._id.toString(), e]));
    const clusterableEntries = entryDocs.map((e) => toClusterableEntry(e, now));
    const clusters = Clusterer.build(
      clusterableEntries,
      {
        maxSharedGuestsPerTrip: cfg.maxSharedGuestsPerTrip,
        clusterRadiusM: cfg.clusterRadiusM,
        clusterTimeWindowMin: cfg.clusterTimeWindowMin,
        maxVehicleSeats: maxFleetSeats,
        maxVehicleLuggage: maxFleetLuggage
      },
      now
    );
    const pendingDemands = clusters.flatMap((c) => expandCluster(c, entryById, maxFleetSeats, maxFleetLuggage, now));

    const { durations } = await RoutingService.matrix(
      eligible.map((e) => e.plain.predictedFreeLocation),
      pendingDemands.map((p) => p.demand.pickup)
    );

    const costMatrix: number[][] = eligible.map((driver, i) =>
      pendingDemands.map((p, j) => {
        const pickupEtaMin = (durations[i]?.[j] ?? Infinity) / 60;
        const estimatedTripEndAt = new Date(
          now.getTime() + (pickupEtaMin + SERVICE_TIME_MIN + roughTripMinutes(p.demand.pickup, p.demand.dropoff)) * 60_000
        );
        const feasibility = Feasibility.check(driver.plain, p.demand, { now, pickupEtaMin, estimatedTripEndAt }, cfg);
        if (!feasibility.ok) return BIG_M;
        const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
        return CostFunction.score(driver.plain, p.demand, { now, pickupEtaMin, arrivalAt }, cfg).total;
      })
    );

    const pairs = BatchAssigner.solve(costMatrix);
    const chosenPairs = pairs.map(({ driverIndex, demandIndex }) => {
      const pickupEtaMin = (durations[driverIndex]?.[demandIndex] ?? 0) / 60;
      const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
      const { total, breakdown } = CostFunction.score(eligible[driverIndex].plain, pendingDemands[demandIndex].demand, { now, pickupEtaMin, arrivalAt }, cfg);
      return { driverIndex, demandIndex, cost: total, breakdown };
    });

    return {
      drivers: eligible.map((e) => ({ id: e.plain.id, name: e.doc.name })),
      demands: pendingDemands.map((p) => ({ id: p.demand.id, guestIds: p.sourceEntryIds, seats: p.demand.seats, luggage: p.demand.luggage })),
      costMatrix,
      chosenPairs
    };
  }
};
