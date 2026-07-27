import { Schema, model, Types, InferSchemaType } from 'mongoose';

const distanceCacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true }, // `${originGeohash7}|${destGeohash7}|driving`
    distanceMeters: { type: Number, required: true },
    durationSeconds: { type: Number, required: true },
    provider: { type: String, required: true },
    isStatic: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null }
  },
  { timestamps: true, versionKey: false }
);

distanceCacheSchema.index({ key: 1 }, { unique: true });
distanceCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type DistanceCacheDoc = InferSchemaType<typeof distanceCacheSchema> & { _id: Types.ObjectId };
export const DistanceCache = model('DistanceCache', distanceCacheSchema);
