"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DistanceCache = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
const distanceCacheSchema = new _mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  // `${originGeohash7}|${destGeohash7}|driving`
  distanceMeters: {
    type: Number,
    required: true
  },
  durationSeconds: {
    type: Number,
    required: true
  },
  provider: {
    type: String,
    required: true
  },
  isStatic: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  versionKey: false
});
distanceCacheSchema.index({
  key: 1
}, {
  unique: true
});
distanceCacheSchema.index({
  expiresAt: 1
}, {
  expireAfterSeconds: 0
});
const DistanceCache = (0, _shared.getModel)('DistanceCache', distanceCacheSchema);
exports.DistanceCache = DistanceCache;
