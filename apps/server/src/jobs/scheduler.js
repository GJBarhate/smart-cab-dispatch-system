"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.startScheduler = startScheduler;
exports.stopScheduler = stopScheduler;
var _nodeCron = _interopRequireDefault(require("node-cron"));
var _env = require("../config/env");
var _logger = require("../config/logger");
var _dispatchTick = require("./dispatchTick.job");
var _reoptimize = require("./reoptimize.job");
var _starvationSweep = require("./starvationSweep.job");
var _arrivalSweep = require("./arrivalSweep.job");
var _keepalive = require("./keepalive.job");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const tasks = [];
function schedule(expr, name, run) {
  tasks.push(_nodeCron.default.schedule(expr, () => {
    run().catch(err => _logger.logger.error({
      err,
      job: name
    }, 'scheduled job failed'));
  }));
}
function startScheduler() {
  if (tasks.length > 0) return; // already started

  schedule(_env.env.DISPATCH_TICK_CRON, 'dispatch-tick', _dispatchTick.runDispatchTick);
  schedule(_env.env.REOPTIMIZE_CRON, 'reoptimize', _reoptimize.runReoptimize);
  schedule(_env.env.STARVATION_SWEEP_CRON, 'starvation-sweep', _starvationSweep.runStarvationSweep);
  // Feeds the queue from scheduled arrivals — must run before the tick has
  // anything to match, so it gets its own (slower) cadence.
  schedule(_env.env.ARRIVAL_SWEEP_CRON, 'arrival-sweep', async () => {
    await (0, _arrivalSweep.runArrivalSweep)();
  });
  if (_env.env.KEEPALIVE_URL) {
    schedule('*/14 * * * *', 'keepalive', _keepalive.runKeepalive);
  }
  _logger.logger.info({
    jobs: tasks.length
  }, 'dispatch scheduler started');
}
function stopScheduler() {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
