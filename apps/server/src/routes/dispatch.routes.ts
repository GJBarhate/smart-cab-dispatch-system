import { Router } from 'express';
import { z } from 'zod';
import { EventConfig } from '../models/EventConfig';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { DispatchEngine } from '../services/dispatch/DispatchEngine';
import { Reoptimizer } from '../services/dispatch/Reoptimizer';
import { RoutingService } from '../services/routing/RoutingService';
import { AuditService } from '../services/AuditService';
import { NotFoundError } from '../utils/errors';

export const dispatchRouter = Router();

dispatchRouter.use(requireAuth, requireRole('admin'));

dispatchRouter.post(
  '/tick',
  asyncHandler(async (req, res) => {
    const report = await DispatchEngine.tick();
    await AuditService.log({ actorId: req.user!.sub, actorRole: 'admin', action: 'dispatch.tick', entityType: 'Dispatch', entityId: null, after: report });
    res.json({ ok: true, data: report });
  })
);

dispatchRouter.post(
  '/batch/preview',
  asyncHandler(async (req, res) => {
    const preview = await DispatchEngine.previewBatch();
    res.json({ ok: true, data: preview });
  })
);

dispatchRouter.get(
  '/health',
  asyncHandler(async (req, res) => {
    const routing = RoutingService.health();
    const stats = RoutingService.stats();
    res.json({
      ok: true,
      data: {
        routing: { provider: routing.provider, breakerOpen: routing.breakerOpen, cacheHitRate: routing.cacheHitRate },
        callsLast5Min: stats.callsLast5Min
      }
    });
  })
);

dispatchRouter.post(
  '/reoptimize',
  asyncHandler(async (req, res) => {
    const report = await Reoptimizer.run();
    await AuditService.log({ actorId: req.user!.sub, actorRole: 'admin', action: 'dispatch.reoptimize', entityType: 'Dispatch', entityId: null, after: report });
    res.json({ ok: true, data: report });
  })
);

const flagsSchema = z.object({
  autoDispatchEnabled: z.boolean().optional(),
  sharingEnabled: z.boolean().optional(),
  detourEnabled: z.boolean().optional(),
  aiEnabled: z.boolean().optional()
});

dispatchRouter.patch(
  '/flags',
  validate({ body: flagsSchema }),
  asyncHandler(async (req, res) => {
    const cfg = await EventConfig.findOne({ singleton: 'singleton' });
    if (!cfg) throw new NotFoundError('EventConfig');

    const before = cfg.featureFlags;
    const patch = req.body as z.infer<typeof flagsSchema>;
    const updated = await EventConfig.findOneAndUpdate(
      { singleton: 'singleton' },
      { $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`featureFlags.${k}`, v])) },
      { new: true }
    );

    await AuditService.log({
      actorId: req.user!.sub,
      actorRole: 'admin',
      action: 'dispatch.flags.update',
      entityType: 'EventConfig',
      entityId: cfg._id.toString(),
      before,
      after: updated?.featureFlags
    });

    res.json({ ok: true, data: updated?.featureFlags });
  })
);
