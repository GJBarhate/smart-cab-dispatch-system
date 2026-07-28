# API Reference

Base URL: `API_BASE_URL` (default `http://localhost:4000`). All routes are under `/api`.

Every response uses one of two envelopes:

```json
{ "ok": true, "data": ..., "meta": { "...optional pagination etc" } }
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "Trip not found", "details": null } }
```

Authenticated routes require `Authorization: Bearer <jwt>`. The JWT is the only source of identity — no endpoint accepts `driverId`/`guestId` from the body or query for scoping.

---

## Auth — `/api/auth`

| Method | Path | Role | Body | Notes |
|---|---|---|---|---|
| POST | `/login` | public | `{ identifier, password }` | `identifier` is email or phone. Returns `{ token, role, name }`. |
| POST | `/guest/login` | public | `{ bookingRef, phone }` | No password. Rate-limited 5/min/IP. |
| GET | `/me` | any | — | Current principal + role + linked driver/guest doc. |
| POST | `/logout` | any | — | Client-side token discard + audit entry. |

## Health — `/api/health`

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{ ok, uptime, db, version }`. No auth. <50ms. |
| GET | `/routing` | Routing provider health, breaker state, cache hit rate. |

## Guest — `/api/guest` (role: guest)

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Profile, accommodation, arrival/departure. |
| GET | `/trip/current` | Active trip + driver + co-passengers, or `null`. |
| GET | `/trip/history` | Completed/cancelled trips. |
| POST | `/requests` | `{ pickupLocationId? \| pickupLat/pickupLng, dropoffLocationId? \| dropoffLat/dropoffLng, pickupLabel?, dropoffLabel?, passengerCount?, luggageCount?, reason?, notes? }`. 409 if one is already pending. Never auto-dispatches. |
| GET | `/requests/:id` | Resync path for the pending-approval stepper. |
| DELETE | `/requests/:id` | Cancel while still pending. |
| POST | `/push/subscribe` | `{ subscription }` — Web Push subscription object. |
| POST | `/trip/:id/rate` | `{ rating: 1-5, comment? }`. Only on a completed trip. |

## Driver — `/api/driver` (role: driver, always self-scoped)

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Own profile, vehicle, capacity, break state. |
| PATCH | `/status` | `{ action: 'online' \| 'offline' \| 'request_break' }`. |
| GET | `/trip/current` | The only trip this driver can see — 404 if none. |
| POST | `/trip/:id/accept` | `pending_driver → accepted → en_route_pickup` in one call. |
| POST | `/trip/:id/reject` | `{ reason }`. Guests re-queued at boosted priority; driver blacklisted for that entry. |
| POST | `/trip/:id/arrived` | `→ at_pickup`. |
| POST | `/trip/:id/board` | `{ guestIds: string[] }` `→ boarded`. |
| POST | `/trip/:id/drop` | `{ guestIds: string[], stopSeq }`. Completes a stop; the last stop `→ completed`. |
| POST | `/location` | `{ lat, lng, heading?, speed? }`. |
| GET | `/summary` | Own stats: trips today, totals, break status. |

Any request for another driver's trip returns **404, not 403** (no existence leak).

## Admin — `/api/admin` (role: admin)

| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard` | KPIs, guest/driver status counts, live driver list, unacknowledged alerts. |
| GET | `/drivers` | `?status=` filter. |
| POST | `/drivers` | Manual onboarding. Returns `{ driver, generatedPassword }` **once**. |
| PATCH | `/drivers/:id` | Edit / suspend. Suspending mid-trip auto-requeues guests. |
| POST | `/drivers/:id/break` | Force a 20-minute break. |
| GET | `/guests` | `?status=&accommodationId=` filters. |
| POST | `/guests` | Manual walk-in registration. |
| PATCH | `/guests/:id` | Corrections; an `arrival` change re-queues any waiting entry. |
| POST | `/guests/import` | `multipart/form-data`, field `file` — CSV columns: `bookingRef,name,phone,groupSize,luggageCount,isVip`. |
| GET | `/requests` | `?status=pending_approval` etc. |
| POST | `/requests/:id/approve` | Creates a `QueueEntry` and immediately calls `GreedyMatcher`. |
| POST | `/requests/:id/decline` | `{ reason }`. |
| GET | `/trips` | `?status=` filter. |
| POST | `/trips/manual` | Override: create a trip with an explicit driver, bypassing the engine. |
| POST | `/trips/:id/reassign` | `{ driverId }` — manual override, audited. |
| POST | `/trips/:id/cancel` | `{ reason }` → guests re-queued. |
| GET | `/queue` | `?status=` — live queue with priority scores. |
| POST | `/queue/:id/boost` | Manual priority bump. |
| GET / POST / PATCH | `/locations`, `/locations/:id` | Manage venue/accommodations. |
| GET / PATCH | `/config` | Live-tune dispatch weights, traffic multiplier, feature flags. |
| GET | `/alerts` | `?acknowledged=true\|false`. |
| POST | `/alerts/:id/ack` | Acknowledge. |
| GET | `/analytics` | Fleet analytics — see the response shape below. |
| GET | `/audit` | `?page=&pageSize=` — paginated audit log. |

### `GET /admin/analytics` response

| Field | Type | Meaning |
|---|---|---|
| `avgWaitMin`, `p95WaitMin` | number | Mean and 95th-percentile guest wait over completed trips. |
| `sharedRidePct` | number | Share of completed trips carrying more than one guest. |
| `driverUtilisationPct` | number | Active drivers currently on a trip, as a percentage of the active fleet. |
| `assignmentsByStrategy` | `Record<string, number>` | Completed trips by the strategy that matched them (detour / batch / greedy). |
| `tripsCompleted` | number | Completed trip count. |
| `waitDistribution` | `{ bucket, count }[]` | Wait times bucketed 0-5 / 5-10 / 10-15 / 15-20 / 20-30 / 30+ min. The shape matters more than the mean when arrivals are bursty — a good average still hides a long tail. |
| `etaAccuracyDistribution` | `{ bucket, count }[]` | Signed ETA error (predicted − actual) in minutes, bucketed `< -5` … `> 5`. Negative means the guest was quoted a shorter wait than they got. |
| `etaWithin2MinPct` | number | Share of completed trips whose ETA landed within ±2 minutes. |
| `tripsByHour` | `{ hour, trips, guests }[]` | Throughput over the last 12 hours. Keyed by *absolute* hour, not hour-of-day, so a window straddling midnight stays in chronological order; quiet hours are emitted as zeroes rather than skipped. |
| `tripsPerDriver` | `{ name, trips }[]` | Completed trips per active driver, descending — utilisation as a distribution rather than one fleet-wide number. |
| `detourSavedMin` | number | Minutes saved by sharing: for each shared trip, the `(guests − 1)` journeys not driven (valued at the **median** single-guest trip, so one airport outlier can't inflate it) less the detour actually incurred. Floored at 0. |
| `sharedTripCount` | number | Number of shared trips `detourSavedMin` was derived from. |

## Dispatch control — `/api/dispatch` (role: admin)

| Method | Path | Notes |
|---|---|---|
| POST | `/tick` | Force a dispatch round now. |
| POST | `/batch/preview` | Dry run — cost matrix, chosen pairs, per-pair breakdowns. Commits nothing. |
| GET | `/health` | Routing provider, breaker state, cache hit rate, calls in last 5 min. |
| POST | `/reoptimize` | Force a re-optimization pass. |
| PATCH | `/flags` | `{ autoDispatchEnabled?, sharingEnabled?, detourEnabled?, aiEnabled? }`. |

## AI — `/api/ai` (role: admin; degrades cleanly when `GEMINI_API_KEY` is blank)

| Method | Path | Notes |
|---|---|---|
| POST | `/ask` | `{ question }` → two-stage: constrained JSON intent, then a hand-written parameterised query, then a 2-sentence summary. Matching is never touched. |
| GET | `/explain/:tripId` | Plain-English rendering of `assignmentMeta.costBreakdown`. Deterministic template first; AI polish is optional. |
| GET | `/digest` | `?hours=` — ops shift digest. |

---

## Realtime (Socket.IO)

Auth via `socket.handshake.auth.token` (same JWT). Rooms: `admin`, `driver:<id>`, `guest:<id>`, `trip:<id>`.

Client → Server: `driver:location`, `trip:subscribe`, `admin:subscribeMap`.
Server → Client: `trip:offered`, `trip:assigned`, `trip:status`, `trip:eta`, `driver:position`, `request:status`, `queue:update`, `dispatch:tick`, `admin:alert`, `driver:break`.

See `shared/src/events.ts` for exact payload shapes.
