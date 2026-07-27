import { Router } from 'express';
import { z } from 'zod';
import { Trip } from '../models/Trip';
import { Guest } from '../models/Guest';
import { Driver } from '../models/Driver';
import { QueueEntry } from '../models/QueueEntry';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { NotFoundError } from '../utils/errors';
import { GeminiService } from '../services/ai/GeminiService';
import { minutesBetween } from '../utils/time';

export const aiRouter = Router();

aiRouter.use(requireAuth, requireRole('admin'));

// Deterministic template — built first per plan.md §19, and always available
// even with GEMINI_API_KEY blank. AI (when enabled) only polishes the prose;
// matching itself is never touched by this route.
function explainTemplate(trip: InstanceType<typeof Trip>): string {
  const meta = trip.assignmentMeta;
  if (!meta) return `Trip ${trip.code} has no recorded assignment metadata.`;

  const b = meta.costBreakdown;
  const parts = [`Trip ${trip.code} was assigned via ${meta.strategy.replace('_', ' ')} with a total cost of ${b?.total ?? 0}.`];
  if (b) {
    parts.push(
      `ETA contributed ${b.eta}, lateness ${b.lateness}, priority discount ${b.priority}, idle-time discount ${b.idle}, ` +
        `capacity waste ${b.capacityWaste}, break urgency ${b.breakUrgency}, rejection history ${b.rejectionHistory}, detour ${b.detour}.`
    );
  }
  parts.push(`${meta.candidatesConsidered} candidate(s) were considered.`);
  return parts.join(' ');
}

aiRouter.get(
  '/explain/:tripId',
  asyncHandler(async (req, res) => {
    const trip = await Trip.findById(req.params.tripId);
    if (!trip) throw new NotFoundError('Trip');

    const template = explainTemplate(trip);
    if (!GeminiService.isEnabled()) {
      res.json({ ok: true, data: { explanation: template, aiPolished: false } });
      return;
    }

    const polished = await GeminiService.ask(
      `Rewrite this dispatch decision explanation for a non-technical ops coordinator in 2 short sentences, keeping every number: "${template}"`
    );
    res.json({ ok: true, data: { explanation: polished ?? template, aiPolished: polished !== null } });
  })
);

const askSchema = z.object({ question: z.string().min(1).max(300) });

const INTENT_SCHEMA = z.object({
  entity: z.enum(['guest', 'driver', 'trip', 'queue']),
  filter: z.enum(['waiting_longest', 'idle_longest', 'unassignable', 'none']).default('none'),
  limit: z.number().int().min(1).max(50).default(10)
});

async function runIntent(intent: z.infer<typeof INTENT_SCHEMA>): Promise<unknown[]> {
  if (intent.entity === 'queue' || (intent.entity === 'guest' && intent.filter === 'waiting_longest')) {
    return QueueEntry.find({ status: 'waiting' }).sort({ enqueuedAt: 1 }).limit(intent.limit).lean();
  }
  if (intent.entity === 'driver' && intent.filter === 'idle_longest') {
    return Driver.find({ status: 'idle' }).sort({ predictedFreeAt: 1 }).limit(intent.limit).lean();
  }
  if (intent.entity === 'trip' && intent.filter === 'unassignable') {
    return Trip.find({ status: 'unassignable' }).limit(intent.limit).lean();
  }
  if (intent.entity === 'guest') return Guest.find({}).limit(intent.limit).lean();
  if (intent.entity === 'driver') return Driver.find({}).limit(intent.limit).lean();
  return Trip.find({}).sort({ createdAt: -1 }).limit(intent.limit).lean();
}

aiRouter.post(
  '/ask',
  validate({ body: askSchema }),
  asyncHandler(async (req, res) => {
    if (!GeminiService.isEnabled()) {
      res.json({ ok: true, data: { available: false, message: 'AI assist is not configured (GEMINI_API_KEY unset).' } });
      return;
    }

    const { question } = req.body as z.infer<typeof askSchema>;

    // Stage 1: Gemini converts the question into a constrained JSON intent.
    // The LLM never touches the database — only this hand-written, validated
    // intent is used to build a parameterised query (plan.md §19.1).
    const raw = await GeminiService.ask(
      `Convert this ops question into JSON matching exactly {"entity":"guest"|"driver"|"trip"|"queue","filter":"waiting_longest"|"idle_longest"|"unassignable"|"none","limit":number}. ` +
        `Return ONLY the JSON, no prose. Question: "${question}"`
    );

    let intent: z.infer<typeof INTENT_SCHEMA>;
    try {
      intent = INTENT_SCHEMA.parse(JSON.parse(raw ?? '{}'));
    } catch {
      res.json({ ok: true, data: { available: true, answer: "I couldn't map that question to a supported query. Try asking about waiting guests, idle drivers, or unassignable trips." } });
      return;
    }

    // Stage 2: hand-written, parameterised Mongo query for that intent.
    const rows = await runIntent(intent);

    // Stage 3: Gemini writes a two-sentence summary of the returned rows.
    const summary = await GeminiService.ask(
      `In exactly 2 sentences, summarise these ${rows.length} ${intent.entity} record(s) for an ops coordinator (be concrete, use numbers): ${JSON.stringify(rows).slice(0, 4000)}`
    );

    res.json({ ok: true, data: { available: true, answer: summary ?? `Found ${rows.length} ${intent.entity} record(s).`, rows } });
  })
);

aiRouter.get(
  '/digest',
  asyncHandler(async (req, res) => {
    const hours = Math.min(24, Number(req.query.hours ?? 4));
    const since = new Date(Date.now() - hours * 60 * 60_000);

    const [tripsCompleted, tripsCreated, waitingNow, unassignable] = await Promise.all([
      Trip.countDocuments({ status: 'completed', completedAt: { $gte: since } }),
      Trip.countDocuments({ createdAt: { $gte: since } }),
      QueueEntry.countDocuments({ status: 'waiting' }),
      QueueEntry.countDocuments({ status: 'failed' })
    ]);

    const oldestWaiting = await QueueEntry.findOne({ status: 'waiting' }).sort({ enqueuedAt: 1 }).lean();
    const oldestWaitMin = oldestWaiting ? Math.round(minutesBetween(new Date(oldestWaiting.enqueuedAt as any), new Date())) : 0;

    const stats = { hours, tripsCompleted, tripsCreated, waitingNow, unassignable, oldestWaitMin };
    const bulletFallback =
      `Last ${hours}h: ${tripsCreated} trips created, ${tripsCompleted} completed. ` +
      `${waitingNow} guest(s) currently waiting (oldest ${oldestWaitMin}min), ${unassignable} unassignable.`;

    if (!GeminiService.isEnabled()) {
      res.json({ ok: true, data: { digest: bulletFallback, stats, aiPolished: false } });
      return;
    }

    const polished = await GeminiService.ask(`Write a 2-3 sentence ops shift digest from this data: ${JSON.stringify(stats)}`);
    res.json({ ok: true, data: { digest: polished ?? bulletFallback, stats, aiPolished: polished !== null } });
  })
);
