"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.acquireTickLock = acquireTickLock;
exports.releaseTickLock = releaseTickLock;
var _Lock = require("../../models/Lock");
// Only one tick may run at a time — Render can restart mid-tick, and two
// overlapping ticks assigning the same driver is the exact race plan.md
// §16.21 warns about (mitigated further by TripService.claimDriver's atomic
// findOneAndUpdate guard).

const TICK_LOCK_KEY = 'dispatch-tick';
async function acquireTickLock(ttlMs) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);
  const holder = String(process.pid);

  // Case 1: the lock document exists and has expired — atomically claim it.
  const claimed = await _Lock.Lock.findOneAndUpdate({
    key: TICK_LOCK_KEY,
    lockedUntil: {
      $lt: now
    }
  }, {
    $set: {
      lockedUntil,
      holder
    }
  }, {
    new: true
  });
  if (claimed) return true;

  // Case 2: no lock document exists yet — try to create it. The unique
  // index on `key` makes this atomic: if another process races us here,
  // exactly one create() succeeds and the other throws (E11000).
  try {
    await _Lock.Lock.create({
      key: TICK_LOCK_KEY,
      lockedUntil,
      holder
    });
    return true;
  } catch {
    return false;
  }
}
async function releaseTickLock() {
  await _Lock.Lock.updateOne({
    key: TICK_LOCK_KEY
  }, {
    $set: {
      lockedUntil: new Date(0)
    }
  });
}
