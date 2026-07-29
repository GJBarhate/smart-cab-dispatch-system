"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.aiRouter = void 0;
var _express = require("express");
var _zod = require("zod");
var _Trip = require("../models/Trip");
var _Guest = require("../models/Guest");
var _Driver = require("../models/Driver");
var _QueueEntry = require("../models/QueueEntry");
var _asyncHandler = require("../middleware/asyncHandler");
var _validate = require("../middleware/validate");
var _auth = require("../middleware/auth");
var _errors = require("../utils/errors");
var _GeminiService = require("../services/ai/GeminiService");
var _time = require("../utils/time");
const aiRouter = (0, _express.Router)();
exports.aiRouter = aiRouter;
aiRouter.use(_auth.requireAuth, (0, _auth.requireRole)('admin'));

// Deterministic template — built first per plan.md §19, and always available
// even with GEMINI_API_KEY blank. AI (when enabled) only polishes the prose;
// matching itself is never touched by this route.
function explainTemplate(trip) {
  const meta = trip.assignmentMeta;
  if (!meta) return `Trip ${trip.code} has no recorded assignment metadata.`;
  const b = meta.costBreakdown;
  const parts = [`Trip ${trip.code} was assigned via ${meta.strategy.replace('_', ' ')} with a total cost of ${b?.total ?? 0}.`];
  if (b) {
    parts.push(`ETA contributed ${b.eta}, lateness ${b.lateness}, priority discount ${b.priority}, idle-time discount ${b.idle}, ` + `capacity waste ${b.capacityWaste}, break urgency ${b.breakUrgency}, rejection history ${b.rejectionHistory}, detour ${b.detour}.`);
  }
  parts.push(`${meta.candidatesConsidered} candidate(s) were considered.`);
  return parts.join(' ');
}
aiRouter.get('/explain/:tripId', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const trip = await _Trip.Trip.findById(req.params.tripId);
  if (!trip) throw new _errors.NotFoundError('Trip');
  const template = explainTemplate(trip);
  if (!_GeminiService.GeminiService.isEnabled()) {
    res.json({
      ok: true,
      data: {
        explanation: template,
        aiPolished: false
      }
    });
    return;
  }
  const polished = await _GeminiService.GeminiService.ask(`Rewrite this dispatch decision explanation for a non-technical ops coordinator in 2 short sentences, keeping every number: "${template}"`);
  res.json({
    ok: true,
    data: {
      explanation: polished ?? template,
      aiPolished: polished !== null
    }
  });
}));
const askSchema = _zod.z.object({
  question: _zod.z.string().min(1).max(300)
});
const INTENT_SCHEMA = _zod.z.object({
  entity: _zod.z.enum(['guest', 'driver', 'trip', 'queue']),
  filter: _zod.z.enum(['waiting_longest', 'idle_longest', 'unassignable', 'none']).default('none'),
  limit: _zod.z.number().int().min(1).max(50).default(10)
});
async function runIntent(intent) {
  if (intent.entity === 'queue' || intent.entity === 'guest' && intent.filter === 'waiting_longest') {
    return _QueueEntry.QueueEntry.find({
      status: 'waiting'
    }).sort({
      enqueuedAt: 1
    }).limit(intent.limit).lean();
  }
  if (intent.entity === 'driver' && intent.filter === 'idle_longest') {
    return _Driver.Driver.find({
      status: 'idle'
    }).sort({
      predictedFreeAt: 1
    }).limit(intent.limit).lean();
  }
  if (intent.entity === 'trip' && intent.filter === 'unassignable') {
    return _Trip.Trip.find({
      status: 'unassignable'
    }).limit(intent.limit).lean();
  }
  if (intent.entity === 'guest') return _Guest.Guest.find({}).limit(intent.limit).lean();
  if (intent.entity === 'driver') return _Driver.Driver.find({}).limit(intent.limit).lean();
  return _Trip.Trip.find({}).sort({
    createdAt: -1
  }).limit(intent.limit).lean();
}
aiRouter.post('/ask', (0, _validate.validate)({
  body: askSchema
}), (0, _asyncHandler.asyncHandler)(async (req, res) => {
  if (!_GeminiService.GeminiService.isEnabled()) {
    res.json({
      ok: true,
      data: {
        available: false,
        message: 'AI assist is not configured (GEMINI_API_KEY unset).'
      }
    });
    return;
  }
  const {
    question
  } = req.body;

  // Stage 1: Gemini converts the question into a constrained JSON intent.
  // The LLM never touches the database — only this hand-written, validated
  // intent is used to build a parameterised query (plan.md §19.1).
  const raw = await _GeminiService.GeminiService.ask(`Convert this ops question into JSON matching exactly {"entity":"guest"|"driver"|"trip"|"queue","filter":"waiting_longest"|"idle_longest"|"unassignable"|"none","limit":number}. ` + `Return ONLY the JSON, no prose. Question: "${question}"`);
  let intent;
  try {
    intent = INTENT_SCHEMA.parse(JSON.parse(raw ?? '{}'));
  } catch {
    res.json({
      ok: true,
      data: {
        available: true,
        answer: "I couldn't map that question to a supported query. Try asking about waiting guests, idle drivers, or unassignable trips."
      }
    });
    return;
  }

  // Stage 2: hand-written, parameterised Mongo query for that intent.
  const rows = await runIntent(intent);

  // Stage 3: Gemini writes a two-sentence summary of the returned rows.
  const summary = await _GeminiService.GeminiService.ask(`In exactly 2 sentences, summarise these ${rows.length} ${intent.entity} record(s) for an ops coordinator (be concrete, use numbers): ${JSON.stringify(rows).slice(0, 4000)}`);
  res.json({
    ok: true,
    data: {
      available: true,
      answer: summary ?? `Found ${rows.length} ${intent.entity} record(s).`,
      rows
    }
  });
}));
aiRouter.get('/digest', (0, _asyncHandler.asyncHandler)(async (req, res) => {
  const hours = Math.min(24, Number(req.query.hours ?? 4));
  const since = new Date(Date.now() - hours * 60 * 60_000);
  const [tripsCompleted, tripsCreated, waitingNow, unassignable] = await Promise.all([_Trip.Trip.countDocuments({
    status: 'completed',
    completedAt: {
      $gte: since
    }
  }), _Trip.Trip.countDocuments({
    createdAt: {
      $gte: since
    }
  }), _QueueEntry.QueueEntry.countDocuments({
    status: 'waiting'
  }), _QueueEntry.QueueEntry.countDocuments({
    status: 'failed'
  })]);
  const oldestWaiting = await _QueueEntry.QueueEntry.findOne({
    status: 'waiting'
  }).sort({
    enqueuedAt: 1
  }).lean();
  const oldestWaitMin = oldestWaiting ? Math.round((0, _time.minutesBetween)(new Date(oldestWaiting.enqueuedAt), new Date())) : 0;
  const stats = {
    hours,
    tripsCompleted,
    tripsCreated,
    waitingNow,
    unassignable,
    oldestWaitMin
  };
  const bulletFallback = `Last ${hours}h: ${tripsCreated} trips created, ${tripsCompleted} completed. ` + `${waitingNow} guest(s) currently waiting (oldest ${oldestWaitMin}min), ${unassignable} unassignable.`;
  if (!_GeminiService.GeminiService.isEnabled()) {
    res.json({
      ok: true,
      data: {
        digest: bulletFallback,
        stats,
        aiPolished: false
      }
    });
    return;
  }
  const polished = await _GeminiService.GeminiService.ask(`Write a 2-3 sentence ops shift digest from this data: ${JSON.stringify(stats)}`);
  res.json({
    ok: true,
    data: {
      digest: polished ?? bulletFallback,
      stats,
      aiPolished: polished !== null
    }
  });
}));
