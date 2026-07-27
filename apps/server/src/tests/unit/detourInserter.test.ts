import { describe, expect, it } from 'vitest';
import { breaksAnyExistingDeadline, capacityHoldsThroughout, insertAt, type DetourStop } from '../../services/dispatch/DetourInserter';

function stop(kind: 'pickup' | 'drop', seats: number, luggage = seats): DetourStop {
  return { kind, guestIds: [], locationId: null, coordinates: { lat: 0, lng: 0 }, label: '', seats, luggage };
}

describe('capacityHoldsThroughout', () => {
  it('accepts a sequence that never exceeds capacity', () => {
    const seq = [stop('pickup', 2), stop('pickup', 1), stop('drop', 2), stop('drop', 1)];
    expect(capacityHoldsThroughout(seq, { seats: 4, luggage: 4 })).toBe(true);
  });

  it('rejects a sequence exceeding capacity mid-way even though totals fit at the end', () => {
    // Two pickups of 2 each (running total 4, at capacity) before either drop —
    // a naive "check the totals only" implementation would miss this if it
    // only looked at the final state; here capacity is exactly at the limit
    // mid-sequence and one more pickup pushes it over.
    const seq = [stop('pickup', 2), stop('pickup', 2), stop('pickup', 1), stop('drop', 2), stop('drop', 2), stop('drop', 1)];
    expect(capacityHoldsThroughout(seq, { seats: 4, luggage: 4 })).toBe(false);
  });

  it('rejects when luggage alone exceeds capacity mid-sequence', () => {
    const seq = [stop('pickup', 1, 3), stop('pickup', 1, 3), stop('drop', 1, 3), stop('drop', 1, 3)];
    expect(capacityHoldsThroughout(seq, { seats: 4, luggage: 4 })).toBe(false);
  });
});

describe('insertAt', () => {
  it('inserts pickup and drop back-to-back at the same gap', () => {
    const pending = [stop('pickup', 1), stop('drop', 1)];
    const newPickup = stop('pickup', 2);
    const newDrop = stop('drop', 2);
    const result = insertAt(pending, 1, newPickup, 1, newDrop);
    expect(result).toEqual([pending[0], newPickup, newDrop, pending[1]]);
  });

  it('inserts drop further down the sequence than pickup', () => {
    const pending = [stop('pickup', 1), stop('drop', 1)];
    const newPickup = stop('pickup', 2);
    const newDrop = stop('drop', 2);
    const result = insertAt(pending, 0, newPickup, 1, newDrop);
    expect(result).toEqual([newPickup, pending[0], newDrop, pending[1]]);
  });
});

describe('breaksAnyExistingDeadline', () => {
  const now = new Date('2026-08-10T09:00:00.000Z');

  it('returns false when the trip has no deadline set', () => {
    expect(breaksAnyExistingDeadline(3600, now, null)).toBe(false);
  });

  it('returns false when completion stays within the deadline', () => {
    const deadline = new Date('2026-08-10T10:00:00.000Z'); // 1h out
    expect(breaksAnyExistingDeadline(30 * 60, now, deadline)).toBe(false);
  });

  it('returns true when completion would slip past the deadline', () => {
    const deadline = new Date('2026-08-10T09:20:00.000Z'); // 20min out
    expect(breaksAnyExistingDeadline(30 * 60, now, deadline)).toBe(true);
  });
});
