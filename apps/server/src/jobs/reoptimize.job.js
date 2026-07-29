"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.runReoptimize = runReoptimize;
var _Reoptimizer = require("../services/dispatch/Reoptimizer");
var _logger = require("../config/logger");
async function runReoptimize() {
  const report = await _Reoptimizer.Reoptimizer.run();
  _logger.logger.info({
    report
  }, 'reoptimize pass complete');
}
