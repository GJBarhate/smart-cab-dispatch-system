import { describe, expect, it } from 'vitest';
import { Clusterer } from '../../services/dispatch/Clusterer';
const NOW = new Date('2026-08-10T09:00:00.000Z');
const cfg = {
  maxSharedGuestsPerTrip: 4,
  clusterRadiusM: 400,
  clusterTimeWindowMin: 15,
  maxVehicleSeats: 12,
  maxVehicleLuggage: 12
};
function makeEntry(overrides) {
  return {
    id: 'e',
    type: 'ARRIVAL_PICKUP',
    guestIds: ['g'],
    seats: 1,
    luggage: 1,
    pickup: {
      lat: 18.58,
      lng: 73.9
    },
    pickupLocationId: 'airport',
    dropoff: {
      lat: 18.53,
      lng: 73.89
    },
    dropoffLocationId: 'hotel-a',
    earliestAt: NOW,
    deadlineAt: new Date('2026-08-10T12:00:00.000Z'),
    enqueuedAt: NOW,
    priorityTier: 1,
    wasRejectedBefore: false,
    ...overrides
  };
}
describe('Clusterer.build', () => {
  it('merges same-pickup/same-drop entries within the time window', () => {
    const entries = [makeEntry({
      id: 'e1',
      guestIds: ['g1']
    }), makeEntry({
      id: 'e2',
      guestIds: ['g2'],
      earliestAt: new Date('2026-08-10T09:05:00.000Z')
    })];
    const clusters = Clusterer.build(entries, cfg, NOW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberEntryIds.sort()).toEqual(['e1', 'e2']);
    expect(clusters[0].guestIds.sort()).toEqual(['g1', 'g2']);
  });
  it('does not merge pickups further apart than the cluster radius', () => {
    const entries = [makeEntry({
      id: 'e1',
      guestIds: ['g1'],
      pickupLocationId: null,
      pickup: {
        lat: 18.58,
        lng: 73.9
      }
    }),
    // ~5.5km away — well outside a 400m radius
    makeEntry({
      id: 'e2',
      guestIds: ['g2'],
      pickupLocationId: null,
      pickup: {
        lat: 18.63,
        lng: 73.9
      }
    })];
    const clusters = Clusterer.build(entries, cfg, NOW);
    expect(clusters).toHaveLength(2);
  });
  it('does not merge entries outside the time bucket window even at the same pickup', () => {
    const entries = [makeEntry({
      id: 'e1',
      guestIds: ['g1'],
      earliestAt: new Date('2026-08-10T09:00:00.000Z')
    }), makeEntry({
      id: 'e2',
      guestIds: ['g2'],
      earliestAt: new Date('2026-08-10T09:45:00.000Z')
    })];
    const clusters = Clusterer.build(entries, cfg, NOW);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
  });
  it('respects maxSharedGuestsPerTrip', () => {
    const tightCfg = {
      ...cfg,
      maxSharedGuestsPerTrip: 2
    };
    const entries = [makeEntry({
      id: 'e1',
      guestIds: ['g1']
    }), makeEntry({
      id: 'e2',
      guestIds: ['g2']
    }), makeEntry({
      id: 'e3',
      guestIds: ['g3']
    })];
    const clusters = Clusterer.build(entries, tightCfg, NOW);
    for (const c of clusters) {
      expect(c.memberEntryIds.length).toBeLessThanOrEqual(2);
    }
    expect(clusters.reduce((n, c) => n + c.memberEntryIds.length, 0)).toBe(3);
  });
});
