import mongoose, { Schema, SchemaOptions, Model, InferSchemaType } from 'mongoose';

// Guards against "Cannot overwrite model once compiled" — vitest gives each
// test file its own module sandbox, so a model file can get re-evaluated
// against the one shared mongoose connection when multiple test files import
// overlapping models. The cast preserves the exact static type `model()`
// would have inferred; only the (test-only) re-registration path is guarded.
export function getModel<S extends Schema>(name: string, schema: S): Model<InferSchemaType<S>> {
  return (mongoose.models[name] as Model<InferSchemaType<S>>) ?? mongoose.model<InferSchemaType<S>>(name, schema);
}

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
