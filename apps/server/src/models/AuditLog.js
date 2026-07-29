"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AuditLog = void 0;
var _mongoose = require("mongoose");
var _shared = require("./_shared");
const auditLogSchema = new _mongoose.Schema({
  actorId: {
    type: _mongoose.Schema.Types.ObjectId,
    default: null
  },
  actorRole: {
    type: String,
    default: ''
  },
  action: {
    type: String,
    required: true
  },
  entityType: {
    type: String,
    required: true
  },
  entityId: {
    type: _mongoose.Schema.Types.ObjectId,
    default: null
  },
  before: {
    type: _mongoose.Schema.Types.Mixed,
    default: null
  },
  after: {
    type: _mongoose.Schema.Types.Mixed,
    default: null
  },
  at: {
    type: Date,
    default: () => new Date()
  },
  ip: {
    type: String,
    default: ''
  }
}, _shared.idOnlySchemaOptions);
auditLogSchema.index({
  at: -1
});
auditLogSchema.index({
  entityType: 1,
  entityId: 1
});
const AuditLog = (0, _shared.getModel)('AuditLog', auditLogSchema);
exports.AuditLog = AuditLog;
