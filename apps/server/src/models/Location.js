"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Location = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
const locationSchema = new _mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['airport', 'railway_station', 'accommodation', 'venue', 'custom'],
    required: true
  },
  address: {
    type: String,
    default: ''
  },
  coordinates: {
    type: _shared.geoPointSchema,
    required: true
  },
  geofenceRadiusM: {
    type: Number,
    default: 150
  },
  meta: {
    terminal: {
      type: String,
      default: ''
    },
    gate: {
      type: String,
      default: ''
    },
    contactPhone: {
      type: String,
      default: ''
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, _shared.baseSchemaOptions);
locationSchema.index({
  coordinates: '2dsphere'
});
const Location = (0, _shared.getModel)('Location', locationSchema);
exports.Location = Location;
