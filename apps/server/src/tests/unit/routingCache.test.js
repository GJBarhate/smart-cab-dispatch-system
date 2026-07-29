import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { CircuitBreaker } from '../../services/routing/CircuitBreaker';
import { DistanceCacheService, buildCacheKey } from '../../services/routing/DistanceCacheService';
import { RoutingService } from '../../services/routing/RoutingService';
let mongod;
beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
afterEach(async () => {
  await mongoose.connection.dropDatabase();
});
describe('DistanceCacheService', () => {
  it('geohash bucketing collapses nearby coordinates to one key', () => {
    const a = {
      lat: 18.5590,
      lng: 73.7997
    };
    const bNearby = {
      lat: 18.5591,
      lng: 73.7998
    }; // ~15m away, well inside a ~153m geohash-7 bucket
    const dest = {
      lat: 18.5286,
      lng: 73.8745
    };
    expect(buildCacheKey(a, dest)).toBe(buildCacheKey(bNearby, dest));
  });
  it('serves a second identical lookup from L1 with zero DB/network round-trips', async () => {
    const from = {
      lat: 18.5590,
      lng: 73.7997
    };
    const to = {
      lat: 18.5286,
      lng: 73.8745
    };
    expect(await DistanceCacheService.get(from, to)).toBeNull();
    await DistanceCacheService.set(from, to, {
      distanceMeters: 5000,
      durationSeconds: 600,
      provider: 'osrm'
    });
    const findOneSpy = vi.spyOn(mongoose.models.DistanceCache, 'findOne');
    const hit = await DistanceCacheService.get(from, to);
    expect(hit).toEqual({
      distanceMeters: 5000,
      durationSeconds: 600,
      provider: 'osrm'
    });
    expect(findOneSpy).not.toHaveBeenCalled(); // served from the in-memory LRU, never touched Mongo
    findOneSpy.mockRestore();
  });
});
describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('opens after the failure threshold and falls back without throwing', () => {
    const breaker = new CircuitBreaker(3, 60_000, 120_000);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false); // still under threshold
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    expect(breaker.getState()).toBe('open');
  });
  it('half-opens after the cooldown and recloses on a success', () => {
    const breaker = new CircuitBreaker(3, 60_000, 120_000);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    vi.advanceTimersByTime(120_001);
    expect(breaker.isOpen()).toBe(false); // half-open probe allowed through
    expect(breaker.getState()).toBe('half_open');
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('closed');
  });
});
describe('RoutingService fallback chain', () => {
  const from = {
    lat: 18.5590,
    lng: 73.7997
  };
  const to = {
    lat: 18.5286,
    lng: 73.8745
  };
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('opens the OSRM breaker after repeated failures and serves haversine estimates without throwing', async () => {
    for (let i = 0; i < 4; i++) {
      // eslint-disable-next-line no-await-in-loop
      const result = await RoutingService.eta({
        lat: from.lat + i * 0.2,
        lng: from.lng
      }, to);
      expect(result.durationSeconds).toBeGreaterThan(0);
    }
    const health = RoutingService.health();
    expect(health.breakerOpen).toBe(true);
    const finalResult = await RoutingService.eta({
      lat: from.lat + 1,
      lng: from.lng
    }, to);
    expect(finalResult.source).toBe('haversine');
  });
});
