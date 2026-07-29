"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GroupSplitter = void 0;
var _uuid = require("uuid");
// Splits demand larger than any single vehicle across a "convoy" of trips
// that share a groupSplitId and depart together (plan.md §8.9). Bin-packing
// is first-fit-decreasing by seat count, and a member (one booking) is only
// ever broken up if it alone exceeds the largest vehicle in the fleet —
// otherwise families / same-booking guests always stay in one chunk.

function splitOversizedMember(member, cfg) {
  if (member.seats <= cfg.maxSeats) return [member];
  const chunks = [];
  let remainingSeats = member.seats;
  let guestCursor = 0;
  const guestPerSeat = member.seats > 0 ? member.guestIds.length / member.seats : 0;
  let idx = 0;
  while (remainingSeats > 0) {
    const seats = Math.min(cfg.maxSeats, remainingSeats);
    const luggage = Math.max(0, Math.round(seats / member.seats * member.luggage));
    const guestCount = idx === Math.ceil(member.seats / cfg.maxSeats) - 1 ? member.guestIds.length - guestCursor : Math.round(seats * guestPerSeat);
    const guestIds = member.guestIds.slice(guestCursor, guestCursor + guestCount);
    guestCursor += guestIds.length;
    chunks.push({
      id: `${member.id}#${idx}`,
      guestIds,
      seats,
      luggage
    });
    remainingSeats -= seats;
    idx += 1;
  }
  return chunks;
}
function firstFitDecreasing(members, cfg) {
  const sorted = [...members].sort((a, b) => b.seats - a.seats);
  const bins = [];
  const binSeats = [];
  const binLuggage = [];
  for (const m of sorted) {
    let placed = false;
    for (let i = 0; i < bins.length; i++) {
      if (binSeats[i] + m.seats <= cfg.maxSeats && binLuggage[i] + m.luggage <= cfg.maxLuggage) {
        bins[i].push(m);
        binSeats[i] += m.seats;
        binLuggage[i] += m.luggage;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push([m]);
      binSeats.push(m.seats);
      binLuggage.push(m.luggage);
    }
  }
  return bins;
}
const GroupSplitter = {
  needsSplit(members, cfg) {
    const totalSeats = members.reduce((s, m) => s + m.seats, 0);
    return totalSeats > cfg.maxSeats || members.some(m => m.seats > cfg.maxSeats);
  },
  split(members, cfg) {
    const groupSplitId = (0, _uuid.v4)();
    const expanded = members.flatMap(m => splitOversizedMember(m, cfg));
    const bins = firstFitDecreasing(expanded, cfg);
    return bins.map(bin => ({
      groupSplitId,
      memberIds: bin.map(m => m.id),
      guestIds: bin.flatMap(m => m.guestIds),
      seats: bin.reduce((s, m) => s + m.seats, 0),
      luggage: bin.reduce((s, m) => s + m.luggage, 0)
    }));
  }
};
exports.GroupSplitter = GroupSplitter;
