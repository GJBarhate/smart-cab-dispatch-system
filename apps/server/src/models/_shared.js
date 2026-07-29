"use strict";

const mongoose = require('mongoose');
const { Schema } = mongoose;

// Guards against "Cannot overwrite model once compiled" — vitest gives each
// test file its own module sandbox, so a model file can get re-evaluated
// against the one shared mongoose connection when multiple test files import
// overlapping models.
function getModel(name, schema) {
  return mongoose.models[name] ?? mongoose.model(name, schema);
}

const idToJSON = {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  }
};

const baseSchemaOptions = {
  timestamps: true,
  toJSON: idToJSON
};

// Same `_id` -> `id` transform as baseSchemaOptions, without `timestamps` —
// for the handful of models (AuditLog) that manage their own timestamp
// field and would otherwise get redundant createdAt/updatedAt columns.
const idOnlySchemaOptions = {
  toJSON: idToJSON
};

// A real Schema instance (not a bare object) so Mongoose doesn't confuse the
// nested `type` field with its own "type key" schema-definition syntax.
const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] } // [lng, lat]
  },
  { _id: false }
);

exports.getModel = getModel;
exports.baseSchemaOptions = baseSchemaOptions;
exports.idOnlySchemaOptions = idOnlySchemaOptions;
exports.geoPointSchema = geoPointSchema;
