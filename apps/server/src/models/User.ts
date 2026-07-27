import { Schema, Types, InferSchemaType } from 'mongoose';
import { baseSchemaOptions, getModel } from './_shared';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'driver'], required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null }
  },
  baseSchemaOptions
);

userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ phone: 1 }, { unique: true, sparse: true });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = getModel('User', userSchema);
