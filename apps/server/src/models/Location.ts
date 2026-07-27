import { Schema, Types, InferSchemaType } from 'mongoose';
import { baseSchemaOptions, geoPointSchema, getModel } from './_shared';

const locationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ['airport', 'railway_station', 'accommodation', 'venue', 'custom'], required: true },
    address: { type: String, default: '' },
    coordinates: { type: geoPointSchema, required: true },
    geofenceRadiusM: { type: Number, default: 150 },
    meta: {
      terminal: { type: String, default: '' },
      gate: { type: String, default: '' },
      contactPhone: { type: String, default: '' }
    },
    isActive: { type: Boolean, default: true }
  },
  baseSchemaOptions
);

locationSchema.index({ coordinates: '2dsphere' });

export type LocationDoc = InferSchemaType<typeof locationSchema> & { _id: Types.ObjectId };
export const Location = getModel('Location', locationSchema);
