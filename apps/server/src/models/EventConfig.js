"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.EventConfig = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
const eventConfigSchema = new _mongoose.Schema({
  singleton: {
    type: String,
    default: 'singleton',
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata'
  },
  startAt: {
    type: Date,
    required: true
  },
  endAt: {
    type: Date,
    required: true
  },
  venueId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Location',
    default: null
  },
  airportId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Location',
    default: null
  },
  stationId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Location',
    default: null
  },
  accommodationIds: [{
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Location'
  }],
  phases: [{
    key: {
      type: String,
      required: true
    },
    startAt: {
      type: Date,
      required: true
    },
    endAt: {
      type: Date,
      required: true
    },
    defaultTripType: {
      type: String,
      required: true
    }
  }],
  dispatch: {
    weights: {
      eta: {
        type: Number,
        default: 1.0
      },
      lateness: {
        type: Number,
        default: 6.0
      },
      priority: {
        type: Number,
        default: 2.5
      },
      idle: {
        type: Number,
        default: 0.8
      },
      capacityWaste: {
        type: Number,
        default: 0.6
      },
      breakUrgency: {
        type: Number,
        default: 3.0
      },
      rejectionHistory: {
        type: Number,
        default: 4.0
      },
      detour: {
        type: Number,
        default: 1.5
      }
    },
    batchHorizonMin: {
      type: Number,
      default: 45
    },
    maxDetourMin: {
      type: Number,
      default: 8
    },
    starvationThresholdMin: {
      type: Number,
      default: 20
    },
    maxSharedGuestsPerTrip: {
      type: Number,
      default: 4
    },
    clusterRadiusM: {
      type: Number,
      default: 400
    },
    clusterTimeWindowMin: {
      type: Number,
      default: 15
    },
    driverBreakAfterTrips: {
      type: Number,
      default: 4
    },
    driverBreakMinutes: {
      type: Number,
      default: 20
    },
    driverMaxContinuousMin: {
      type: Number,
      default: 180
    },
    offerTimeoutSec: {
      type: Number,
      default: 60
    },
    maxReassignAttempts: {
      type: Number,
      default: 5
    }
  },
  traffic: {
    peakWindows: [{
      from: {
        type: String,
        default: '08:00'
      },
      to: {
        type: String,
        default: '11:00'
      },
      multiplier: {
        type: Number,
        default: 1.4
      }
    }],
    globalMultiplier: {
      type: Number,
      default: 1.0
    },
    incidents: [{
      id: {
        type: String,
        default: ''
      },
      lat: {
        type: Number,
        default: 0
      },
      lng: {
        type: Number,
        default: 0
      },
      radiusM: {
        type: Number,
        default: 500
      },
      multiplier: {
        type: Number,
        default: 2.0
      },
      expiresAt: {
        type: Date,
        default: null
      }
    }],
    hourlyDriftEwma: {
      type: _mongoose.Schema.Types.Mixed,
      default: {}
    } // { [hourOfDay]: multiplier }
  },
  featureFlags: {
    aiEnabled: {
      type: Boolean,
      default: false
    },
    detourEnabled: {
      type: Boolean,
      default: true
    },
    sharingEnabled: {
      type: Boolean,
      default: true
    },
    autoDispatchEnabled: {
      type: Boolean,
      default: true
    }
  }
}, _shared.baseSchemaOptions);
const EventConfig = (0, _shared.getModel)('EventConfig', eventConfigSchema);
exports.EventConfig = EventConfig;
