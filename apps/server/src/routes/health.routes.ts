import { Router } from 'express';
import { isDbConnected } from '../config/db';
import { asyncHandler } from '../middleware/asyncHandler';

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
