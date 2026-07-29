"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.dispatchRouter = void 0;
var _express = require("express");
var _zod = require("zod");
var _EventConfig = require("../models/EventConfig");
var _asyncHandler = require("../middleware/asyncHandler");
var _validate = require("../middleware/validate");
var _auth = require("../middleware/auth");
var _DispatchEngine = require("../services/dispatch/DispatchEngine");
var _Reoptimizer = require("../services/dispatch/Reoptimizer");
var _RoutingService = require("../services/routing/RoutingService");
var _AuditService = require("../services/AuditService");
var _errors = require("../utils/errors");
const dispatchRouter = (0, _express.Router)();
exports.dispatchRouter = dispatchRouter;
dispatchRouter.use(_auth.requireAuth, (0, _auth.requireRole)('admin'));
dispatchRouter.post('/tick', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const report = await _DispatchEngine.DispatchEngine.tick();
  await _AuditService.AuditService.log({
    actorId: req.user.sub,
    actorRole: 'admin',
    action: 'dispatch.tick',
    entityType: 'Dispatch',
    entityId: null,
    after: report
  });
  res.json({
    ok: true,
    data: report
  });
}));
dispatchRouter.post('/batch/preview', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const preview = await _DispatchEngine.DispatchEngine.previewBatch();
  res.json({
    ok: true,
    data: preview
  });
}));
dispatchRouter.get('/health', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const routing = _RoutingService.RoutingService.health();
  const stats = _RoutingService.RoutingService.stats();
  res.json({
    ok: true,
    data: {
      routing: {
        provider: routing.provider,
        breakerOpen: routing.breakerOpen,
        cacheHitRate: routing.cacheHitRate
      },
      callsLast5Min: stats.callsLast5Min
    }
  });
}));
dispatchRouter.post('/reoptimize', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const report = await _Reoptimizer.Reoptimizer.run();
  await _AuditService.AuditService.log({
    actorId: req.user.sub,
    actorRole: 'admin',
    action: 'dispatch.reoptimize',
    entityType: 'Dispatch',
    entityId: null,
    after: report
  });
  res.json({
    ok: true,
    data: report
  });
}));
const flagsSchema = _zod.z.object({
  autoDispatchEnabled: _zod.z.boolean().optional(),
  sharingEnabled: _zod.z.boolean().optional(),
  detourEnabled: _zod.z.boolean().optional(),
  aiEnabled: _zod.z.boolean().optional()
});
dispatchRouter.patch('/flags', (0, _validate.validate)({
  body: flagsSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const cfg = await _EventConfig.EventConfig.findOne({
    singleton: 'singleton'
  });
  if (!cfg) throw new _errors.NotFoundError('EventConfig');
  const before = cfg.featureFlags;
  const patch = req.body;
  const updated = await _EventConfig.EventConfig.findOneAndUpdate({
    singleton: 'singleton'
  }, {
    $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`featureFlags.${k}`, v]))
  }, {
    new: true
  });
  await _AuditService.AuditService.log({
    actorId: req.user.sub,
    actorRole: 'admin',
    action: 'dispatch.flags.update',
    entityType: 'EventConfig',
    entityId: cfg._id.toString(),
    before,
    after: updated?.featureFlags
  });
  res.json({
    ok: true,
    data: updated?.featureFlags
  });
}));
