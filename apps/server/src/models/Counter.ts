// Atomic sequence generator (e.g. Trip.code "T-0142"). A plain
// Trip.countDocuments()-based counter races under concurrent commits — two
// commits reading the same count both mint the same code and one loses to
// the unique index. findOneAndUpdate with $inc is atomic per document.
import { Schema, Types, InferSchemaType } from 'mongoose';
import { getModel } from './_shared';

const counterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
  },
  { versionKey: false }
);

counterSchema.index({ key: 1 }, { unique: true });

export type CounterDoc = InferSchemaType<typeof counterSchema> & { _id: Types.ObjectId };
export const Counter = getModel('Counter', counterSchema);

export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return doc.seq;
}
