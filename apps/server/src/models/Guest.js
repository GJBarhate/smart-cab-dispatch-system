"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Guest = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
const guestSchema = new _mongoose.Schema({
  bookingRef: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  email: {
    type: String,
    default: ''
  },
  groupSize: {
    type: Number,
    default: 1,
    min: 1
  },
  luggageCount: {
    type: Number,
    default: 1,
    min: 0
  },
  priorityTier: {
    type: Number,
    default: 1
  },
  isVip: {
    type: Boolean,
    default: false
  },
  arrival: {
    mode: {
      type: String,
      enum: ['flight', 'train', 'road'],
      default: 'road'
    },
    identifier: {
      type: String,
      default: ''
    },
    scheduledAt: {
      type: Date,
      default: null
    },
    actualAt: {
      type: Date,
      default: null
    },
    pickupLocationId: {
      type: _mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null
    },
    terminal: {
      type: String,
      default: ''
    }
  },
  departure: {
    mode: {
      type: String,
      enum: ['flight', 'train', 'road'],
      default: 'road'
    },
    identifier: {
      type: String,
      default: ''
    },
    scheduledAt: {
      type: Date,
      default: null
    },
    dropLocationId: {
      type: _mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null
    }
  },
  accommodationId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Location',
    default: null
  },
  status: {
    type: String,
    enum: ['registered', 'awaiting_pickup', 'queued', 'assigned', 'in_transit', 'completed', 'no_show'],
    default: 'registered'
  },
  currentTripId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Trip',
    default: null
  },
  waitingSince: {
    type: Date,
    default: null
  },
  specialNeeds: {
    type: String,
    default: ''
  },
  pushSubscription: {
    type: _mongoose.Schema.Types.Mixed,
    default: null
  },
  notes: [{
    at: {
      type: Date,
      default: () => new Date()
    },
    by: {
      type: String,
      default: ''
    },
    text: {
      type: String,
      default: ''
    }
  }]
}, _shared.baseSchemaOptions);
guestSchema.index({
  bookingRef: 1
}, {
  unique: true
});
guestSchema.index({
  status: 1,
  'arrival.scheduledAt': 1
});
const Guest = (0, _shared.getModel)('Guest', guestSchema);
exports.Guest = Guest;
