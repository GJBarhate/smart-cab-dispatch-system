// Drives one simulated driver through its real lifecycle over the real HTTP
// API: poll for an offer, accept/reject (configurable rejection rate),
// interpolate movement along the real route at simulated speed while posting
// locations, then arrive/board/drop. Used only by sim/simulate.ts.
import { pointAlongPath, haversineKm } from '../utils/geo';
import type { LatLng } from '../utils/geo';

export interface VirtualDriverOptions {
  driverId: string;
  token: string;
  baseUrl: string;
  rejectionRate: number;
  speedMultiplier: number;
  avgSpeedKmph: number;
  pollIntervalMs: number;
  onLog?: (msg: string) => void;
}

async function api(baseUrl: string, token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export class VirtualDriver {
  private stopped = false;
  public tripsCompleted = 0;
  public rejections = 0;

  constructor(private opts: VirtualDriverOptions) {}

  stop(): void {
    this.stopped = true;
  }

  private log(msg: string): void {
    this.opts.onLog?.(`[driver ${this.opts.driverId.slice(-6)}] ${msg}`);
  }

  /** Runs until `stop()` is called. Safe to run many of these concurrently. */
  async run(): Promise<void> {
    const { baseUrl, token, pollIntervalMs } = this.opts;

    while (!this.stopped) {
      const { status, body } = await api(baseUrl, token, 'GET', '/api/driver/trip/current');
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

  private async handleOffer(trip: any): Promise<void> {
    const shouldReject = Math.random() < this.opts.rejectionRate;
    if (shouldReject) {
      await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/reject`, { reason: 'too far' });
      this.rejections++;
      this.log(`rejected trip ${trip.code}`);
      return;
    }
    await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/accept`);
    this.log(`accepted trip ${trip.code}`);
  }

  private stopCoord(trip: any, kind: 'pickup' | 'drop'): LatLng | null {
    const stop = (trip.stops ?? []).find((s: any) => s.kind === kind && s.status !== 'done');
    if (!stop) return null;
    return { lat: stop.coordinates.coordinates[1], lng: stop.coordinates.coordinates[0] };
  }

  private async driveAlong(from: LatLng, to: LatLng): Promise<void> {
    const distanceKm = haversineKm(from, to);
    const effectiveSpeedKmph = this.opts.avgSpeedKmph * this.opts.speedMultiplier;
    const travelSeconds = Math.max(1, (distanceKm / effectiveSpeedKmph) * 3600);
    const steps = Math.max(3, Math.min(20, Math.round(travelSeconds / 0.5)));
    const stepMs = (travelSeconds * 1000) / steps;

    for (let i = 1; i <= steps; i++) {
      if (this.stopped) return;
      const pos = pointAlongPath([from, to], i / steps);
      await api(this.opts.baseUrl, this.opts.token, 'POST', '/api/driver/location', { lat: pos.lat, lng: pos.lng, heading: 0, speed: this.opts.avgSpeedKmph });
      await sleep(stepMs);
    }
  }

  private async driveToPickup(trip: any): Promise<void> {
    const meRes = await api(this.opts.baseUrl, this.opts.token, 'GET', '/api/driver/me');
    const from: LatLng = {
      lat: meRes.body?.data?.currentLocation?.coordinates?.[1] ?? 18.55,
      lng: meRes.body?.data?.currentLocation?.coordinates?.[0] ?? 73.85
    };
    const to = this.stopCoord(trip, 'pickup');
    if (!to) return;

    await this.driveAlong(from, to);
    if (this.stopped) return;
    await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/arrived`);
  }

  private async board(trip: any): Promise<void> {
    const guestIds = (trip.guests ?? []).map((g: any) => g.guestId);
    if (guestIds.length === 0) return;
    await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/board`, { guestIds });
  }

  private async driveToDrop(trip: any): Promise<void> {
    const pickup = this.stopCoord(trip, 'pickup') ?? { lat: 18.55, lng: 73.85 };
    const dropStop = (trip.stops ?? []).find((s: any) => s.kind === 'drop' && s.status !== 'done');
    if (!dropStop) return;
    const to: LatLng = { lat: dropStop.coordinates.coordinates[1], lng: dropStop.coordinates.coordinates[0] };

    await this.driveAlong(pickup, to);
    if (this.stopped) return;

    const guestIds = (trip.guests ?? []).map((g: any) => g.guestId);
    const res = await api(this.opts.baseUrl, this.opts.token, 'POST', `/api/driver/trip/${trip.id}/drop`, { guestIds, stopSeq: dropStop.seq });
    if (res.status === 200 && res.body?.data?.status === 'completed') {
      this.tripsCompleted++;
      this.log(`completed trip ${trip.code}`);
    }
  }
}
