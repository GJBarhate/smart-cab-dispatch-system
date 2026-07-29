"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.secondsBetween = exports.now = exports.minutesBetween = exports.isBetween = exports.clamp01 = exports.addSeconds = exports.addMinutes = void 0;
const now = () => new Date();
exports.now = now;
const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
exports.addMinutes = addMinutes;
const addSeconds = (date, seconds) => new Date(date.getTime() + seconds * 1000);
exports.addSeconds = addSeconds;
const minutesBetween = (a, b) => (b.getTime() - a.getTime()) / 60_000;
exports.minutesBetween = minutesBetween;
const secondsBetween = (a, b) => (b.getTime() - a.getTime()) / 1000;
exports.secondsBetween = secondsBetween;
const clamp01 = n => Math.min(1, Math.max(0, n));
exports.clamp01 = clamp01;
const isBetween = (date, start, end) => date.getTime() >= start.getTime() && date.getTime() < end.getTime();
exports.isBetween = isBetween;
