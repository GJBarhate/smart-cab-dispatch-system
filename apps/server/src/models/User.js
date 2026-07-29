"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.User = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
const userSchema = new _mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'driver'],
    required: true
  },
  driverId: {
    type: _mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date,
    default: null
  }
}, _shared.baseSchemaOptions);
userSchema.index({
  email: 1
}, {
  unique: true,
  sparse: true
});
userSchema.index({
  phone: 1
}, {
  unique: true,
  sparse: true
});
const User = (0, _shared.getModel)('User', userSchema);
exports.User = User;
