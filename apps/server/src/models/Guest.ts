import { Schema, Types, InferSchemaType } from 'mongoose';
import { baseSchemaOptions, getModel } from './_shared';

const guestSchema = new Schema(
  {
    bookingRef: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, default: '' },
    groupSize: { type: Number, default: 1, min: 1 },
    luggageCount: { type: Number, default: 1, min: 0 },
    priorityTier: { type: Number, default: 1 },
    isVip: { type: Boolean, default: false },
    arrival: {
      mode: { type: String, enum: ['flight', 'train', 'road'], default: 'road' },
      identifier: { type: String, default: '' },
      scheduledAt: { type: Date, default: null },
      actualAt: { type: Date, default: null },
      pickupLocationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
      terminal: { type: String, default: '' }
    },
    departure: {
      mode: { type: String, enum: ['flight', 'train', 'road'], default: 'road' },
      identifier: { type: String, default: '' },
      scheduledAt: { type: Date, default: null },
      dropLocationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null }
    },
    accommodationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
    status: {
      type: String,
      enum: ['registered', 'awaiting_pickup', 'queued', 'assigned', 'in_transit', 'completed', 'no_show'],
      default: 'registered'
    },
    currentTripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
    waitingSince: { type: Date, default: null },
    specialNeeds: { type: String, default: '' },
    pushSubscription: { type: Schema.Types.Mixed, default: null },
    notes: [
      {
        at: { type: Date, default: () => new Date() },
        by: { type: String, default: '' },
        text: { type: String, default: '' }
      }
    ]
  },
  baseSchemaOptions
);

guestSchema.index({ bookingRef: 1 }, { unique: true });
guestSchema.index({ status: 1, 'arrival.scheduledAt': 1 });

export type GuestDoc = InferSchemaType<typeof guestSchema> & { _id: Types.ObjectId };
export const Guest = getModel('Guest', guestSchema);
