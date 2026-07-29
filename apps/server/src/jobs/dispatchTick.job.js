"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.runDispatchTick = runDispatchTick;
var _DispatchEngine = require("../services/dispatch/DispatchEngine");
var _logger = require("../config/logger");
async function runDispatchTick() {
  const report = await _DispatchEngine.DispatchEngine.tick();
  if (report.skipped) {
    _logger.logger.debug({
      report
    }, 'dispatch tick skipped');
    return;
  }
  _logger.logger.info({
    report
  }, 'dispatch tick complete');
}
