"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Lock = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
// Not in the original plan's model list, but required by §8.2 step 0:
// "only one tick may run at a time (Render can restart mid-tick)".

const lockSchema = new _mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  lockedUntil: {
    type: Date,
    required: true
  },
  holder: {
    type: String,
    default: ''
  }
}, {
  versionKey: false
});
lockSchema.index({
  key: 1
}, {
  unique: true
});
const Lock = (0, _shared.getModel)('Lock', lockSchema);
exports.Lock = Lock;
