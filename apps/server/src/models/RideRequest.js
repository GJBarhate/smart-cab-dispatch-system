"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RideRequest = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
const rideRequestSchema = new _mongoose.Schema({
  guestId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Guest',
    required: true
  },
  requestedAt: {
    type: Date,
    default: () => new Date()
  },
  pickup: {
    locationId: {
      type: _mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null
    },
    coordinates: {
      type: _shared.geoPointSchema,
      required: true
    },
    label: {
      type: String,
      default: ''
    }
  },
  dropoff: {
    locationId: {
      type: _mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null
    },
    coordinates: {
      type: _shared.geoPointSchema,
      required: true
    },
    label: {
      type: String,
      default: ''
    }
  },
  passengerCount: {
    type: Number,
    default: 1,
    min: 1
  },
  luggageCount: {
    type: Number,
    default: 1,
    min: 0
  },
  reason: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending_approval', 'approved', 'declined', 'matched', 'expired'],
    default: 'pending_approval'
  },
  decidedBy: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  decidedAt: {
    type: Date,
    default: null
  },
  declineReason: {
    type: String,
    default: ''
  },
  tripId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Trip',
    default: null
  },
  expiresAt: {
    type: Date,
    default: null
  }
}, _shared.baseSchemaOptions);
rideRequestSchema.index({
  guestId: 1,
  status: 1
});
rideRequestSchema.index({
  status: 1,
  requestedAt: 1
});
const RideRequest = (0, _shared.getModel)('RideRequest', rideRequestSchema);
exports.RideRequest = RideRequest;
