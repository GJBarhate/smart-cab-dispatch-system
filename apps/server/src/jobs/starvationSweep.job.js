"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.runStarvationSweep = runStarvationSweep;
var _EventConfig = require("../models/EventConfig");
var _QueueEntry = require("../models/QueueEntry");
var _DispatchEngine = require("../services/dispatch/DispatchEngine");
var _logger = require("../config/logger");
// Hard pre-emption rule (plan.md §8.4): any QueueEntry waiting longer than
// starvationThresholdMin gets matched greedily against the nearest feasible
// driver *before* the next batch tick runs, trading optimality for fairness.

async function runStarvationSweep() {
  const cfgDoc = await _EventConfig.EventConfig.findOne({
    singleton: 'singleton'
  });
  if (!cfgDoc || !cfgDoc.featureFlags?.autoDispatchEnabled) return;
  const thresholdMin = cfgDoc.dispatch.starvationThresholdMin;
  const cutoff = new Date(Date.now() - thresholdMin * 60_000);
  const starving = await _QueueEntry.QueueEntry.find({
    status: 'waiting',
    enqueuedAt: {
      $lte: cutoff
    }
  }).sort({
    enqueuedAt: 1
  });
  if (starving.length === 0) return;
  let matched = 0;
  for (const entry of starving) {
    const ok = await _DispatchEngine.DispatchEngine.matchEntryNow(entry._id.toString(), 'starvation_sweep');
    if (ok) matched++;
  }
  _logger.logger.info({
    starving: starving.length,
    matched
  }, 'starvation sweep complete');
}
