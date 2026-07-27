import { Schema, model, Types, InferSchemaType } from 'mongoose';
import { baseSchemaOptions, geoPointSchema } from './_shared';

const stopSchema = new Schema(
  {
    seq: { type: Number, required: true },
    kind: { type: String, enum: ['pickup', 'drop'], required: true },
    guestIds: [{ type: Schema.Types.ObjectId, ref: 'Guest' }],
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
    coordinates: { type: geoPointSchema, required: true },
    label: { type: String, default: '' },
    plannedAt: { type: Date, default: null },
    etaAt: { type: Date, default: null },
    actualAt: { type: Date, default: null },
    status: { type: String, enum: ['pending', 'arrived', 'done'], default: 'pending' }
  },
  { _id: false }
);

const tripSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    type: {
      type: String,
      enum: ['ARRIVAL_PICKUP', 'TO_VENUE', 'FROM_VENUE', 'DEPARTURE_DROP', 'INTER_HOTEL', 'ON_DEMAND'],
      required: true
    },
    status: {
      type: String,
      enum: [
        'pending_driver',
        'accepted',
        'en_route_pickup',
        'at_pickup',
        'boarded',
        'completed',
        'cancelled',
        'rejected',
        'unassignable'
      ],
      default: 'pending_driver'
    },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    vehicleSnapshot: {
      number: { type: String, default: '' },
      model: { type: String, default: '' },
      seats: { type: Number, default: 0 },
      luggage: { type: Number, default: 0 }
    },
    guests: [
      {
        guestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
        name: { type: String, default: '' },
        seats: { type: Number, default: 1 },
        luggage: { type: Number, default: 1 },
        boardedAt: { type: Date, default: null },
        droppedAt: { type: Date, default: null },
        pickupStopSeq: { type: Number, default: null },
        dropStopSeq: { type: Number, default: null }
      }
    ],
    stops: [stopSchema],
    route: {
      polyline: { type: String, default: '' },
      distanceMeters: { type: Number, default: 0 },
      durationSeconds: { type: Number, default: 0 },
      computedAt: { type: Date, default: null },
      provider: { type: String, default: '' }
    },
    capacityUsed: {
      seats: { type: Number, default: 0 },
      luggage: { type: Number, default: 0 }
    },
    deadlineAt: { type: Date, default: null },
    assignmentMeta: {
      strategy: {
        type: String,
        enum: ['batch_hungarian', 'greedy_realtime', 'detour_insert', 'manual_override', 'starvation_sweep'],
        default: 'greedy_realtime'
      },
      score: { type: Number, default: 0 },
      costBreakdown: {
        eta: { type: Number, default: 0 },
        lateness: { type: Number, default: 0 },
        priority: { type: Number, default: 0 },
        idle: { type: Number, default: 0 },
        capacityWaste: { type: Number, default: 0 },
        breakUrgency: { type: Number, default: 0 },
        rejectionHistory: { type: Number, default: 0 },
        detour: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
      },
      candidatesConsidered: { type: Number, default: 0 },
      decidedAt: { type: Date, default: null },
      decidedBy: { type: String, default: 'engine' }
    },
    groupSplitId: { type: String, default: null },
    sourceRequestId: { type: Schema.Types.ObjectId, ref: 'RideRequest', default: null },
    timeline: [
      {
        at: { type: Date, default: () => new Date() },
        type: { type: String, default: '' },
        actor: { type: String, default: '' },
        payload: { type: Schema.Types.Mixed, default: {} }
      }
    ],
    offeredAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '' },
    cancellationReason: { type: String, default: '' },
    metrics: {
      guestWaitMinutes: { type: Number, default: 0 },
      driverIdleBeforeMin: { type: Number, default: 0 },
      detourAddedMin: { type: Number, default: 0 },
      etaAccuracySec: { type: Number, default: 0 }
    }
  },
  baseSchemaOptions
);

tripSchema.index({ status: 1, driverId: 1 });
tripSchema.index({ 'guests.guestId': 1 });
tripSchema.index({ createdAt: -1 });
tripSchema.index({ code: 1 }, { unique: true });

export type TripDoc = InferSchemaType<typeof tripSchema> & { _id: Types.ObjectId };
export const Trip = model('Trip', tripSchema);
