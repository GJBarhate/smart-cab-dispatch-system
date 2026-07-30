"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AlertService = void 0;
var _Alert = require("../models/Alert");
var _NotificationService = require("./NotificationService");
const AlertService = {
  /**
   * Raises an alert, folding a repeat of an already-open condition into the
   * existing row instead of inserting a new one.
   *
   * Callers raise from tick loops: the dispatch tick every 30s, the
   * reoptimizer on every pass. Without folding, one stuck trip produces an
   * alert per pass forever — observed at 3,878 DEADLINE_AT_RISK rows for the
   * same four trips, which buries every other alert on the dashboard and
   * makes the panel useless precisely when ops needs it.
   *
   * The dedupe key is the condition (code + entity), never the message:
   * DEADLINE_AT_RISK restates its projected slip in minutes each pass, so
   * matching on text would let every repeat through. Acknowledging an alert
   * closes it, so a condition that recurs afterwards surfaces again.
   */
  async raise(level, code, message, entity) {
    const now = new Date();
    const folded = await _Alert.Alert.findOneAndUpdate({
      code,
      acknowledged: false,
      'entity.id': entity?.id ?? null
    }, {
      $set: {
        level,
        message,
        lastOccurredAt: now
      },
      $inc: {
        occurrences: 1
      }
    });
    if (folded) return;
    const alert = await _Alert.Alert.create({
      level,
      code,
      message,
      entity: entity ?? null,
      lastOccurredAt: now
    });
    _NotificationService.NotificationService.adminAlert({
      id: alert._id.toString(),
      level,
      code,
      message,
      entity
    });
  }
};
exports.AlertService = AlertService;
