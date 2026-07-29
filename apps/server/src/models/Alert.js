"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Alert = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
// Not in plan.md §6.4's model list, but needed for GET /api/admin/alerts and
// POST /api/admin/alerts/:id/ack (§9.4) — NotificationService.adminAlert only
// emits a socket event, which a client connected later would never see.

// Real Schema instance — `entity` has a sibling field literally named `type`,
// which collides with Mongoose's own "type key" shorthand otherwise (same
// issue as Driver.vehicle; see the comment there).
const alertEntitySchema = new _mongoose.Schema({
  type: {
    type: String,
    default: null
  },
  id: {
    type: String,
    default: null
  }
}, {
  _id: false
});
const alertSchema = new _mongoose.Schema({
  level: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    required: true
  },
  code: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  entity: {
    type: alertEntitySchema,
    default: null
  },
  acknowledged: {
    type: Boolean,
    default: false
  },
  acknowledgedBy: {
    type: _mongoose.Schema.Types.ObjectId,
    default: null
  },
  acknowledgedAt: {
    type: Date,
    default: null
  }
}, _shared.baseSchemaOptions);
alertSchema.index({
  acknowledged: 1,
  createdAt: -1
});
const Alert = (0, _shared.getModel)('Alert', alertSchema);
exports.Alert = Alert;
