// Not in the original plan's model list, but required by §8.2 step 0:
// "only one tick may run at a time (Render can restart mid-tick)".
import { Schema, Types, InferSchemaType } from 'mongoose';
import { getModel } from './_shared';

const lockSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    lockedUntil: { type: Date, required: true },
    holder: { type: String, default: '' }
  },
  { versionKey: false }
);

lockSchema.index({ key: 1 }, { unique: true });

export type LockDoc = InferSchemaType<typeof lockSchema> & { _id: Types.ObjectId };
export const Lock = getModel('Lock', lockSchema);
