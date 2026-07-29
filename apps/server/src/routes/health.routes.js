"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.healthRouter = void 0;
var _express = require("express");
var _db = require("../config/db");
var _asyncHandler = require("../middleware/asyncHandler");
var _RoutingService = require("../services/routing/RoutingService");
const healthRouter = (0, _express.Router)();
exports.healthRouter = healthRouter;
const startedAt = Date.now();
healthRouter.get('/', (0, _asyncHandler.asyncHandler)(async (_req, res) => {
  res.json({
    ok: true,
    data: {
      uptime: Math.round((Date.now() - startedAt) / 1000),
      db: (0, _db.isDbConnected)() ? 'connected' : 'disconnected',
      version: process.env.npm_package_version ?? '1.0.0'
    }
  });
}));
healthRouter.get('/routing', (0, _asyncHandler.asyncHandler)(async (_req, res) => {
  const health = _RoutingService.RoutingService.health();
  const stats = _RoutingService.RoutingService.stats();
  res.json({
    ok: true,
    data: {
      provider: health.provider,
      breakerOpen: health.breakerOpen,
      cacheHitRate: Number(health.cacheHitRate.toFixed(3)),
      callsLast5Min: stats.callsLast5Min,
      osrmBreakerState: stats.osrmBreakerState,
      orsBreakerState: stats.orsBreakerState
    }
  });
}));
