import { describe, expect, it } from 'vitest';
import { activePhase, defaultTripType } from '../../services/EventPhaseService';
const PHASES = [{
  key: 'ARRIVAL',
  startAt: new Date('2026-08-10T00:00:00Z'),
  endAt: new Date('2026-08-11T18:00:00Z'),
  defaultTripType: 'ARRIVAL_PICKUP'
}, {
  key: 'EVENT_DAY',
  startAt: new Date('2026-08-11T18:00:00Z'),
  endAt: new Date('2026-08-13T12:00:00Z'),
  defaultTripType: 'TO_VENUE'
}, {
  key: 'DEPARTURE',
  startAt: new Date('2026-08-13T12:00:00Z'),
  endAt: new Date('2026-08-14T23:59:00Z'),
  defaultTripType: 'DEPARTURE_DROP'
}];
describe('EventPhaseService', () => {
  it('selects the phase containing the instant', () => {
    expect(activePhase(PHASES, new Date('2026-08-10T09:00:00Z'))?.key).toBe('ARRIVAL');
    expect(activePhase(PHASES, new Date('2026-08-12T09:00:00Z'))?.key).toBe('EVENT_DAY');
    expect(activePhase(PHASES, new Date('2026-08-14T09:00:00Z'))?.key).toBe('DEPARTURE');
  });
  it('treats phase windows as half-open so a boundary matches exactly one phase', () => {
    // 18:00 on day 2 is both ARRIVAL's endAt and EVENT_DAY's startAt.
    const boundary = new Date('2026-08-11T18:00:00Z');
    expect(activePhase(PHASES, boundary)?.key).toBe('EVENT_DAY');
  });
  it('returns null outside every phase', () => {
    expect(activePhase(PHASES, new Date('2026-08-09T23:59:59Z'))).toBeNull();
    expect(activePhase(PHASES, new Date('2026-08-15T00:00:00Z'))).toBeNull();
  });
  it('maps the active phase to its default trip type', () => {
    expect(defaultTripType({
      phases: PHASES
    }, new Date('2026-08-12T09:00:00Z'))).toBe('TO_VENUE');
    expect(defaultTripType({
      phases: PHASES
    }, new Date('2026-08-13T18:00:00Z'))).toBe('DEPARTURE_DROP');
  });
  it('falls back to ARRIVAL_PICKUP rather than throwing when no phase applies', () => {
    // A dispatch tick must never fail because the clock drifted past the last
    // configured phase, or because config is missing entirely.
    expect(defaultTripType({
      phases: PHASES
    }, new Date('2027-01-01T00:00:00Z'))).toBe('ARRIVAL_PICKUP');
    expect(defaultTripType(null, new Date())).toBe('ARRIVAL_PICKUP');
    expect(defaultTripType({
      phases: []
    }, new Date())).toBe('ARRIVAL_PICKUP');
  });
  it('rejects a phase whose defaultTripType is not a known trip type', () => {
    const bogus = [{
      key: 'X',
      startAt: new Date('2026-08-10T00:00:00Z'),
      endAt: new Date('2026-08-20T00:00:00Z'),
      defaultTripType: 'NOT_A_TYPE'
    }];
    expect(defaultTripType({
      phases: bogus
    }, new Date('2026-08-11T00:00:00Z'))).toBe('ARRIVAL_PICKUP');
  });
});
