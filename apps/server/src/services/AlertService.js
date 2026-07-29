"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AlertService = void 0;
var _Alert = require("../models/Alert");
var _NotificationService = require("./NotificationService");
const AlertService = {
  async raise(level, code, message, entity) {
    const alert = await _Alert.Alert.create({
      level,
      code,
      message,
      entity: entity ?? null
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
