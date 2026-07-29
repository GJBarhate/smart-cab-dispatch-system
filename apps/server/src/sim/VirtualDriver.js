"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.VirtualDriver = void 0;
var _geo = require("../utils/geo");
// Drives one simulated driver through its real lifecycle over the real HTTP
// API: poll for an offer, accept/reject (configurable rejection rate),
// interpolate movement along the real route at simulated speed while posting
// locations, then arrive/board/drop. Used only by sim/simulate.ts.

async function api(baseUrl, token, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return {
    status: res.status,
    body: json
  };
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}
class VirtualDriver {
  stopped = false;
  tripsCompleted = 0;
  rejections = 0;
  constructor(opts) {
    this.opts = opts;
  }
  stop() {
    this.stopped = true;
  }
  log(msg) {
    this.opts.onLog?.(`[driver ${this.opts.driverId.slice(-6)}] ${msg}`);
  }

  /** Runs until `stop()` is called. Safe to run many of these concurrently. */
  async run() {
    const {
      baseUrl,
      token,
      pollIntervalMs
    } = this.opts;
    while (!this.stopped) {
      const {
        status,
        body
      } = await api(baseUrl, token, 'GET', '/api/driver/trip/current');
      if (status !== 200 || !body?.data) {
        await sleep(pollIntervalMs);
        continue;
      }
      const trip = body.data;
      if (trip.status === 'pending_driver') {
        await this.handleOffer(trip);
      } else if (['accepted', 'en_route_pickup'].includes(trip.status)) {
        await this.driveToPickup(trip);
      } else if (trip.status === 'at_pickup') {
        await this.board(trip);
      } else if (trip.status === 'boarded') {
        await this.driveToDrop(trip);
      }
      await sleep(pollIntervalMs);
    }
  }
  async handleOffer(trip) {
    const shouldReject = Math.random() < this.opts.rejectionRate;
    if (shouldReject) {
      await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/reject`, {
        reason: 'too far'
      });
      this.rejections++;
      this.log(`rejected trip ${trip.code}`);
      return;
    }
    await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/accept`);
    this.log(`accepted trip ${trip.code}`);
  }
  stopCoord(trip, kind) {
    const stop = (trip.stops ?? []).find(s => s.kind === kind && s.status !== 'done');
    if (!stop) return null;
    return {
      lat: stop.coordinates.coordinates[1],
      lng: stop.coordinates.coordinates[0]
    };
  }
  async driveAlong(from, to) {
    const distanceKm = (0, _geo.haversineKm)(from, to);
    const effectiveSpeedKmph = this.opts.avgSpeedKmph * this.opts.speedMultiplier;
    const travelSeconds = Math.max(1, distanceKm / effectiveSpeedKmph * 3600);
    const steps = Math.max(3, Math.min(20, Math.round(travelSeconds / 0.5)));
    const stepMs = travelSeconds * 1000 / steps;
    for (let i = 1; i <= steps; i++) {
      if (this.stopped) return;
      const pos = (0, _geo.pointAlongPath)([from, to], i / steps);
      await api(this.opts.baseUrl, this.opts.token, 'POST', '/api/driver/location', {
        lat: pos.lat,
        lng: pos.lng,
        heading: 0,
        speed: this.opts.avgSpeedKmph
      });
      await sleep(stepMs);
    }
  }
  async driveToPickup(trip) {
    const meRes = await api(this.opts.baseUrl, this.opts.token, 'GET', '/api/driver/me');
    const from = {
      lat: meRes.body?.data?.currentLocation?.coordinates?.[1] ?? 18.55,
      lng: meRes.body?.data?.currentLocation?.coordinates?.[0] ?? 73.85
    };
    const to = this.stopCoord(trip, 'pickup');
    if (!to) return;
    await this.driveAlong(from, to);
    if (this.stopped) return;
    await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/arrived`);
  }
  async board(trip) {
    const guestIds = (trip.guests ?? []).map(g => g.guestId);
    if (guestIds.length === 0) return;
    await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/board`, {
      guestIds
    });
  }
  async driveToDrop(trip) {
    const pickup = this.stopCoord(trip, 'pickup') ?? {
      lat: 18.55,
      lng: 73.85
    };
    const dropStop = (trip.stops ?? []).find(s => s.kind === 'drop' && s.status !== 'done');
    if (!dropStop) return;
    const to = {
      lat: dropStop.coordinates.coordinates[1],
      lng: dropStop.coordinates.coordinates[0]
    };
    await this.driveAlong(pickup, to);
    if (this.stopped) return;
    const guestIds = (trip.guests ?? []).map(g => g.guestId);
    const res = await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/drop`, {
      guestIds,
      stopSeq: dropStop.seq
    });
    if (res.status === 200 && res.body?.data?.status === 'completed') {
      this.tripsCompleted++;
      this.log(`completed trip ${trip.code}`);
    }
  }
}
exports.VirtualDriver = VirtualDriver;
