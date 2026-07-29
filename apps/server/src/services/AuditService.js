"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AuditService = void 0;
var _AuditLog = require("../models/AuditLog");
const AuditService = {
  async log(entry) {
    await _AuditLog.AuditLog.create({
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? ''
    });
  }
};
exports.AuditService = AuditService;
