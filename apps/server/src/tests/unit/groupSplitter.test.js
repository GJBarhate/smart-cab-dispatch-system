import { describe, expect, it } from 'vitest';
import { GroupSplitter } from '../../services/dispatch/GroupSplitter';
const cfg = {
  maxSeats: 7,
  maxLuggage: 7
};
describe('GroupSplitter', () => {
  it('splits a 14-person group with a 7-seat max into 2 chunks sharing a groupSplitId', () => {
    const guestIds = Array.from({
      length: 14
    }, (_, i) => `guest-${i}`);
    const members = [{
      id: 'booking-14',
      guestIds,
      seats: 14,
      luggage: 14
    }];
    expect(GroupSplitter.needsSplit(members, cfg)).toBe(true);
    const chunks = GroupSplitter.split(members, cfg);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].groupSplitId).toBe(chunks[1].groupSplitId);
    expect(chunks[0].seats + chunks[1].seats).toBe(14);
    for (const chunk of chunks) {
      expect(chunk.seats).toBeLessThanOrEqual(7);
    }
    const allGuests = chunks.flatMap(c => c.guestIds);
    expect(new Set(allGuests).size).toBe(14);
  });
  it('keeps families / same-booking guests together across chunks', () => {
    const members = [{
      id: 'family-a',
      guestIds: ['a1', 'a2', 'a3'],
      seats: 3,
      luggage: 3
    }, {
      id: 'family-b',
      guestIds: ['b1', 'b2'],
      seats: 2,
      luggage: 2
    }, {
      id: 'family-c',
      guestIds: ['c1', 'c2', 'c3', 'c4'],
      seats: 4,
      luggage: 4
    }];
    const chunks = GroupSplitter.split(members, cfg);
    for (const chunk of chunks) {
      // Each family's guests either all appear in this chunk or none do.
      for (const family of members) {
        const present = family.guestIds.filter(g => chunk.guestIds.includes(g)).length;
        expect(present === 0 || present === family.guestIds.length).toBe(true);
      }
    }
    expect(chunks.reduce((n, c) => n + c.seats, 0)).toBe(9);
  });
  it('does not require a split when total seats fit within one vehicle', () => {
    const members = [{
      id: 'small',
      guestIds: ['x'],
      seats: 3,
      luggage: 2
    }];
    expect(GroupSplitter.needsSplit(members, cfg)).toBe(false);
  });
});
