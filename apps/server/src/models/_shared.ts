import { Schema, SchemaOptions } from 'mongoose';

// `satisfies` (not `:`) keeps the literal object type intact so Mongoose's
// `InferSchemaType` can still narrow every model's field types correctly —
// an explicit `SchemaOptions` annotation here would widen it and silently
// turn every model's inferred document type into the raw schema-definition
// shape (e.g. `passwordHash: { type: StringConstructor }` instead of `string`).
export const baseSchemaOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_doc: unknown, ret: Record<string, any>) => {
      ret.id = ret._id?.toString();
      delete ret._id;
      return ret;
    }
  }
} satisfies SchemaOptions;

// A real Schema instance (not a bare object) so Mongoose doesn't confuse the
// nested `type` field with its own "type key" schema-definition syntax.
export const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  { _id: false }
);
