// Trip lifecycle + the state machine (plan.md §6.2, §8.11). This is the ONLY
// module allowed to mutate `trip.status` — route handlers and the engine
// both go through here, so an invalid transition always surfaces as a 409
// instead of a silently corrupted trip.
import { Types } from 'mongoose';
import { Trip } from '../../models/Trip';
import { Driver } from '../../models/Driver';
import { Guest } from '../../models/Guest';
import { QueueEntry } from '../../models/QueueEntry';
import { nextSequence } from '../../models/Counter';
import { ConflictError, NotFoundError } from '../../utils/errors';
import { toGeoPoint } from '../../utils/geo';
import type { LatLng } from '../../utils/geo';
import type { CostBreakdown } from './types';

export type TripStatusT =
  | 'pending_driver'
  | 'accepted'
  | 'en_route_pickup'
  | 'at_pickup'
  | 'boarded'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'unassignable';

const ALLOWED_TRANSITIONS: Record<TripStatusT, TripStatusT[]> = {
  pending_driver: ['accepted', 'rejected', 'cancelled'],
  accepted: ['en_route_pickup', 'cancelled'],
  en_route_pickup: ['at_pickup', 'cancelled'],
  at_pickup: ['boarded', 'cancelled'],
  boarded: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  rejected: [],
  unassignable: ['pending_driver', 'cancelled']
};

const STATUS_TIMESTAMP_FIELD: Partial<Record<TripStatusT, string>> = {
  accepted: 'acceptedAt',
  rejected: 'rejectedAt',
  en_route_pickup: 'startedAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt'
};

export interface TripStopInput {
  kind: 'pickup' | 'drop';
  guestIds: string[];
  locationId: string | null;
  coordinates: LatLng;
  label: string;
  plannedAt?: Date;
}

export interface CreateTripInput {
  type: string;
  driverId: string;
  entryIds: string[];
  guests: Array<{ guestId: string; name: string; seats: number; luggage: number }>;
  stops: TripStopInput[];
  vehicleSnapshot: { number: string; model: string; seats: number; luggage: number };
  capacityUsed: { seats: number; luggage: number };
  deadlineAt: Date;
  strategy: string;
  score: number;
  costBreakdown: CostBreakdown;
  candidatesConsidered: number;
  decidedBy: string;
  groupSplitId?: string | null;
  sourceRequestId?: string | null;
}

async function nextTripCode(): Promise<string> {
  const seq = await nextSequence('trip');
  return `T-${String(seq).padStart(4, '0')}`;
}

export const TripService = {
  async transition(tripId: string, next: TripStatusT, actor: string): Promise<InstanceType<typeof Trip>> {
    const trip = await Trip.findById(tripId);
    if (!trip) throw new NotFoundError('Trip');

    const current = trip.status as TripStatusT;
    if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
      throw new ConflictError(`Cannot transition trip from '${current}' to '${next}'`);
    }

    trip.status = next;
    const tsField = STATUS_TIMESTAMP_FIELD[next];
    if (tsField) (trip as any)[tsField] = new Date();

    trip.timeline.push({ at: new Date(), type: `status:${next}`, actor, payload: {} });
    await trip.save();
    return trip;
  },

  /**
   * Atomically claims a driver for `tripId`. Returns false if someone else
   * beat us to it (§16.21/16.13). `currentTripId` must be set in this SAME
   * findOneAndUpdate as `status` — splitting it into a later, separate write
   * (as an earlier version of this function did) leaves a window where the
   * driver looks claimed (status: 'assigned') but currentTripId is still
   * null, so a second concurrent claim can slip through and double-assign
   * the driver. The caller must mint `tripId` before the Trip document
   * exists (`new Types.ObjectId()`) so it's available to claim with.
   */
  async claimDriver(driverId: string, tripId: Types.ObjectId | string): Promise<boolean> {
    const result = await Driver.findOneAndUpdate(
      { _id: driverId, currentTripId: null },
      { $set: { status: 'assigned', currentTripId: tripId } },
      { new: true }
    );
    return result !== null;
  },

  async createFromAssignment(input: CreateTripInput): Promise<InstanceType<typeof Trip>> {
    const tripId = new Types.ObjectId();
    const claimed = await TripService.claimDriver(input.driverId, tripId);
    if (!claimed) throw new ConflictError('Driver was assigned by another process');

    try {
      const code = await nextTripCode();
      const stops = input.stops.map((s, i) => ({
        seq: i,
        kind: s.kind,
        guestIds: s.guestIds,
        locationId: s.locationId,
        coordinates: toGeoPoint(s.coordinates),
        label: s.label,
        plannedAt: s.plannedAt ?? null,
        status: 'pending' as const
      }));

      const trip = await Trip.create({
        _id: tripId,
        code,
        type: input.type,
        status: 'pending_driver',
        driverId: input.driverId,
        vehicleSnapshot: input.vehicleSnapshot,
        guests: input.guests,
        stops,
        capacityUsed: input.capacityUsed,
        deadlineAt: input.deadlineAt,
        assignmentMeta: {
          strategy: input.strategy,
          score: input.score,
          costBreakdown: input.costBreakdown,
          candidatesConsidered: input.candidatesConsidered,
          decidedAt: new Date(),
          decidedBy: input.decidedBy
        },
        groupSplitId: input.groupSplitId ?? null,
        sourceRequestId: input.sourceRequestId ?? null,
        offeredAt: new Date(),
        timeline: [{ at: new Date(), type: 'created', actor: input.decidedBy, payload: { strategy: input.strategy } }]
      });

      const guestIds = input.guests.map((g) => g.guestId);
      await Guest.updateMany(
        { _id: { $in: guestIds } },
        { $set: { status: 'assigned', currentTripId: trip._id } }
      );

      if (input.entryIds.length > 0) {
        await QueueEntry.updateMany({ _id: { $in: input.entryIds } }, { $set: { status: 'assigned' } });
      }

      return trip;
    } catch (err) {
      // Trip creation failed after the driver was already claimed — release
      // them rather than leaving currentTripId pointing at a trip that was
      // never actually created.
      await TripService.releaseDriver(input.driverId);
      throw err;
    }
  },

  async requeueGuests(guestIds: string[], _reason: string): Promise<void> {
    await Guest.updateMany(
      { _id: { $in: guestIds } },
      { $set: { status: 'queued', currentTripId: null, waitingSince: new Date() } }
    );
  },

  async releaseDriver(driverId: string): Promise<void> {
    await Driver.updateOne({ _id: driverId }, { $set: { currentTripId: null, status: 'idle' } });
  }
};
