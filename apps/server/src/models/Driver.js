"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Driver = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
// A real Schema instance (not a bare object) — `vehicle` has a sibling field
// literally named `type`, which Mongoose's TS type inference (InferSchemaType)
// confuses with its own "type key" shorthand unless this is a proper Schema,
// same issue geoPointSchema in _shared.ts already works around.
const vehicleSchema = new _mongoose.Schema({
  number: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  model: {
    type: String,
    default: ''
  },
  colour: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    enum: ['sedan', 'suv', 'tempo', 'bus'],
    required: true
  }
}, {
  _id: false
});
const driverSchema = new _mongoose.Schema({
  userId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  licenseNo: {
    type: String,
    default: ''
  },
  vehicle: {
    type: vehicleSchema,
    required: true
  },
  capacity: {
    seats: {
      type: Number,
      required: true,
      min: 1
    },
    luggage: {
      type: Number,
      required: true,
      min: 0
    }
  },
  status: {
    type: String,
    enum: ['offline', 'idle', 'assigned', 'en_route_pickup', 'at_pickup', 'on_trip', 'on_break', 'suspended'],
    default: 'offline'
  },
  currentLocation: {
    type: _shared.geoPointSchema,
    default: () => ({
      type: 'Point',
      coordinates: [0, 0]
    })
  },
  locationUpdatedAt: {
    type: Date,
    default: null
  },
  heading: {
    type: Number,
    default: 0
  },
  speedKmph: {
    type: Number,
    default: 0
  },
  currentTripId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Trip',
    default: null
  },
  assignedTripIds: [{
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Trip'
  }],
  predictedFreeAt: {
    type: Date,
    default: () => new Date()
  },
  predictedFreeLocation: {
    type: _shared.geoPointSchema,
    default: () => ({
      type: 'Point',
      coordinates: [0, 0]
    })
  },
  shift: {
    startAt: {
      type: Date,
      default: null
    },
    endAt: {
      type: Date,
      default: null
    }
  },
  break: {
    tripsSinceBreak: {
      type: Number,
      default: 0
    },
    minutesSinceBreak: {
      type: Number,
      default: 0
    },
    lastBreakEndedAt: {
      type: Date,
      default: null
    },
    onBreakUntil: {
      type: Date,
      default: null
    }
  },
  stats: {
    tripsCompleted: {
      type: Number,
      default: 0
    },
    guestsServed: {
      type: Number,
      default: 0
    },
    totalIdleMinutes: {
      type: Number,
      default: 0
    },
    totalDriveMinutes: {
      type: Number,
      default: 0
    },
    rejections: {
      type: Number,
      default: 0
    }
  },
  rejectedEntryIds: [{
    type: _mongoose.Schema.Types.ObjectId
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, _shared.baseSchemaOptions);
driverSchema.index({
  currentLocation: '2dsphere'
});
driverSchema.index({
  status: 1,
  predictedFreeAt: 1
});
driverSchema.index({
  'vehicle.number': 1
}, {
  unique: true
});
const Driver = (0, _shared.getModel)('Driver', driverSchema);
exports.Driver = Driver;
