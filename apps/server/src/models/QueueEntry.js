"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.QueueEntry = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
const queueEntrySchema = new _mongoose.Schema({
  type: {
    type: String,
    enum: ['ARRIVAL_PICKUP', 'TO_VENUE', 'FROM_VENUE', 'DEPARTURE_DROP', 'INTER_HOTEL', 'ON_DEMAND'],
    required: true
  },
  guestIds: [{
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Guest',
    required: true
  }],
  seats: {
    type: Number,
    required: true,
    min: 1
  },
  luggage: {
    type: Number,
    required: true,
    min: 0
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
  earliestAt: {
    type: Date,
    required: true
  },
  deadlineAt: {
    type: Date,
    required: true
  },
  enqueuedAt: {
    type: Date,
    default: () => new Date()
  },
  priorityTier: {
    type: Number,
    default: 1
  },
  priorityScore: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['waiting', 'matching', 'assigned', 'failed'],
    default: 'waiting'
  },
  attempts: {
    type: Number,
    default: 0
  },
  lastAttemptAt: {
    type: Date,
    default: null
  },
  lastFailureReason: {
    type: String,
    default: ''
  },
  lockedBy: {
    type: String,
    default: null
  },
  lockedUntil: {
    type: Date,
    default: null
  },
  sourceRequestId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'RideRequest',
    default: null
  },
  clusterKey: {
    type: String,
    default: ''
  },
  rejectedDriverIds: [{
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Driver'
  }]
}, _shared.baseSchemaOptions);
queueEntrySchema.index({
  status: 1,
  priorityScore: -1
});
queueEntrySchema.index({
  deadlineAt: 1
});
queueEntrySchema.index({
  'pickup.coordinates': '2dsphere'
});
const QueueEntry = (0, _shared.getModel)('QueueEntry', queueEntrySchema);
exports.QueueEntry = QueueEntry;
