import { Schema, Types, InferSchemaType } from 'mongoose';
import { baseSchemaOptions, geoPointSchema, getModel } from './_shared';

const rideRequestSchema = new Schema(
  {
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
    requestedAt: { type: Date, default: () => new Date() },
    pickup: {
      locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
      coordinates: { type: geoPointSchema, required: true },
      label: { type: String, default: '' }
    },
    dropoff: {
      locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
      coordinates: { type: geoPointSchema, required: true },
      label: { type: String, default: '' }
    },
    passengerCount: { type: Number, default: 1, min: 1 },
    luggageCount: { type: Number, default: 1, min: 0 },
    reason: { type: String, default: '' },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending_approval', 'approved', 'declined', 'matched', 'expired'],
      default: 'pending_approval'
    },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    declineReason: { type: String, default: '' },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
    expiresAt: { type: Date, default: null }
  },
  baseSchemaOptions
);

rideRequestSchema.index({ guestId: 1, status: 1 });
rideRequestSchema.index({ status: 1, requestedAt: 1 });

export type RideRequestDoc = InferSchemaType<typeof rideRequestSchema> & { _id: Types.ObjectId };
export const RideRequest = getModel('RideRequest', rideRequestSchema);
