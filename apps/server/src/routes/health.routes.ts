import { Router } from 'express';
import { isDbConnected } from '../config/db';
import { asyncHandler } from '../middleware/asyncHandler';
import { RoutingService } from '../services/routing/RoutingService';

export const healthRouter = Router();

const startedAt = Date.now();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      data: {
        uptime: Math.round((Date.now() - startedAt) / 1000),
        db: isDbConnected() ? 'connected' : 'disconnected',
        version: process.env.npm_package_version ?? '1.0.0'
      }
    });
  })
);

healthRouter.get(
  '/routing',
  asyncHandler(async (_req, res) => {
    const health = RoutingService.health();
    const stats = RoutingService.stats();
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
  })
);
