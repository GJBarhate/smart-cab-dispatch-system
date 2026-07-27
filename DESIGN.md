# DESIGN.md — Smart Cab / Vehicle Dispatch System

This document explains the matching algorithm, the data model, and the trade-offs made while building this system for a single private event with a fixed, pre-registered fleet.

---

## 1. Problem framing and the five guarantees

A fixed fleet serves hundreds of guests moving between an airport/railway station, several accommodations, and one venue, across arrival, event, and departure phases. The system must guarantee:

| # | Guarantee | Enforcement mechanism |
|---|---|---|
| G1 | No guest waits unreasonably long | Superlinear wait-time term in the priority score (§5), plus a hard pre-emption rule at `starvationThresholdMin` |
| G2 | No driver idles while guests wait | Idle-time credit in the cost function (a driver becomes *cheaper* the longer they've been idle) + a starvation-sweep cron that force-matches any waiting entry against the nearest feasible driver |
| G3 | Seat + luggage capacity respected | Hard feasibility mask before scoring — an infeasible pair gets `BIG_M` in the cost matrix, never a soft penalty (§6) |
| G4 | Multiple destinations handled by event phase | `TripType` driven by `EventConfig.phases`, matched against `now` |
| G5 | Allocation is fully automatic | No endpoint lets a guest pick a driver, or a driver pick a guest. See the automation boundary below. |

## 2. The automation boundary

```
MANUAL (humans)                      AUTOMATED (engine)
─────────────────────────            ──────────────────────────────
Driver onboarding                    Which driver serves which guest
Guest record creation / edits        When the trip is created
Approve/decline on-demand request    Route, stop order, and ETA
Emergency override                   Ride sharing / clustering decisions
                                     Detour insertion
                                     Re-optimization on ETA drift
```

Concretely: `POST /api/guest/requests` only ever creates a `pending_approval` `RideRequest` — there is no code path from a guest action to a `Trip`. `POST /api/admin/requests/:id/approve` hands off to `GreedyMatcher` immediately after a human decision; the admin never sees or picks a candidate driver. The only two endpoints that bypass the engine entirely are `POST /api/admin/trips/manual` and `POST /api/admin/trips/:id/reassign` — both explicit, audited overrides, and both import `TripService` only, never any scoring code.

## 3. Data model — the queue as a first-class persisted entity

`QueueEntry` is a real Mongoose collection, not an in-memory array. This matters for three reasons: (1) a server restart (Render free tier sleeps and cold-starts) must not lose the demand backlog; (2) `priorityScore` needs to be queryable and sortable across a tick; (3) `lockedBy`/`lockedUntil` fields let a batch tick and a real-time greedy match coexist without double-assigning the same guest. `Trip.stops` is an ordered array with its own per-stop status (`pending`/`arrived`/`done`), so a shared ride or a multi-stop detour has one document representing the whole itinerary rather than one row per leg.

## 4. The matching algorithm

`DispatchEngine.tick()` (`apps/server/src/services/dispatch/DispatchEngine.ts`) runs three strategies in this order, each cheaper and less disruptive than the next:

1. **Detour insertion** (`DetourInserter`) — try to slot a new pickup into a trip that's already moving. Zero new deadhead miles.
2. **Batch Hungarian assignment** (`BatchAssigner`, via `munkres-js`) — globally optimal for everything detour insertion couldn't absorb, after clustering (`Clusterer`) compatible demands into shared rides and splitting any group larger than the biggest vehicle (`GroupSplitter`).
3. **Greedy real-time matching** (`GreedyMatcher`) — mops up anything the batch round left unmatched (usually because supply ran out), and is also the path used between ticks for admin approvals, driver rejections, and the starvation sweep.

### Why this order
Detour insertion costs nothing in new driver travel, so it's always worth trying first. The batch round is O(n³) but that's single-digit milliseconds at fleet scale (§8) and gives a provably optimal assignment over the whole batch — better than greedily assigning demands one at a time, which can lock in a locally-good but globally-worse pairing. Greedy is the fallback because it's fast and always terminates, even when the optimal solver's guarantees don't apply (e.g. mid-tick real-time events).

### The cost function
```
total =  W_eta         * pickupEtaMin
      +  W_lateness    * max(0, latenessMin)^1.5
      -  W_priority    * priorityScore(demand)
      -  W_idle        * driverIdleMinutes
      +  W_capWaste    * capacityWaste
      +  W_breakUrgency* breakUrgency
      +  W_rejection   * rejectionPenalty
      +  W_detour      * detourAddedMin
```
then offset by `+500` and clamped to `≥0` (Hungarian needs non-negative costs; the offset is invariant to the optimum since it's a constant shift). Default weights live in `EventConfig.dispatch.weights` and are live-tunable from the admin Dispatch Console.

- **`eta`** (weight 1.0) — baseline: prefer the closer driver.
- **`lateness`** (6.0, superlinear ^1.5) — a driver who'd arrive late is penalized much harder the later they'd be; small slips barely matter, large ones dominate the score.
- **`priority`** (2.5, subtracted) — the anti-starvation term, detailed below.
- **`idle`** (0.8, subtracted) — the longer a driver has sat idle, the cheaper they become. Combined with the starvation sweep, this makes "idle driver while a guest waits" structurally impossible for more than one tick (G2).
- **`capacityWaste`** (0.6) — `(driver.seats - demand.seats)/driver.seats * 10`. Discourages sending a 12-seat tempo for one guest while a sedan sits idle, but *softly* — it never blocks a match, unlike the hard feasibility mask.
- **`breakUrgency`** (3.0) — `max(0, tripsSinceBreak - (breakAfterTrips-2)) * 5`. A driver nearing their mandatory break gets progressively more expensive, so the engine naturally routes work away from them before a hard break kicks in.
- **`rejectionHistory`** (4.0) — a driver who already rejected this exact entry once is deprioritized (not blacklisted — that only happens at 2 rejections, a hard feasibility rule, see §6).
- **`detour`** (1.5) — 0 for a fresh assignment; the added minutes when scoring a detour insertion.

### Anti-starvation: the superlinear term (G1)
```
priorityScore =
    10 * demand.priorityTier                       // VIP=30, speaker=20, standard=10
  + 10 * (waitedMinutes / 10)^1.5                   // SUPERLINEAR
  + 25 * urgency(now, deadlineAt)                   // clamp01(1 - minutesToDeadline/60)
  + (demand.type === 'DEPARTURE_DROP' ? 20 : 0)     // missing a flight is unrecoverable
  + (wasRejectedBefore ? 15 : 0)
```
The `1.5` exponent means a guest who has waited 60 minutes scores roughly **7.8×** a guest who has waited 10 minutes on the wait term alone (`(60/10)^1.5 ≈ 14.7` vs `(10/10)^1.5 = 1`, scaled by the same 10 coefficient) — the queue cannot park someone indefinitely just because they're geographically inconvenient. On top of the soft term, `starvationSweep.job.ts` runs every minute (`STARVATION_SWEEP_CRON`) and force-matches any entry waiting past `starvationThresholdMin` (default 20) against the nearest feasible driver via `GreedyMatcher`, pre-empting optimality in favour of fairness. If even that finds nothing feasible, an `UNASSIGNABLE`-class alert fires with a reason code.

### Complexity and the greedy fallback
Hungarian is O(n³); at 100 drivers × 100 demands that's ~10⁶ operations, comfortably single-digit milliseconds in Node. Above a 150×150 matrix, `BatchAssigner` falls back to a greedy nearest-first assignment (sorted by cost, skipping already-used rows/columns) rather than paying cubic cost at a scale this event will never reach — documented explicitly as a threshold, not a silent behavior change.

## 5. Capacity as a hard constraint

`Feasibility.check()` returns a boolean, never a score. A pair that fails any hard check — insufficient seats/luggage, driver on break or break-due, shift ending before the trip would, an unreachable deadline, 2+ prior rejections of this entry, an incompatible vehicle for special needs, or a suspended driver — gets `BIG_M = 1e9` in the cost matrix, never a large-but-finite penalty. This is deliberately over-engineered on the side of safety: with a finite (even if huge) penalty, the Hungarian solver will happily overload a vehicle the moment supply gets tight enough that every alternative is *also* expensive, because the solver only cares about relative cost, not absolute feasibility. `BIG_M` combined with dropping any committed pair whose cost is still `≥ BIG_M` after solving is what makes capacity a true hard constraint rather than a strong preference.

## 6. Detour insertion: live position, capacity-throughout, existing-deadline protection

`DetourInserter.findBest()` (`apps/server/src/services/dispatch/DetourInserter.ts`) tries inserting a new pickup/drop pair at every valid position in an in-progress trip's remaining stops. Three details make this correct rather than decorative:

1. **The origin is the driver's live GPS position**, not the trip's original start — a driver already halfway to the airport is evaluated from where they actually are.
2. **`capacityHoldsThroughout`** walks the candidate stop sequence accumulating `+seats` on pickups and `−seats` on drops, asserting the running total never exceeds capacity *at any point in the sequence* — not just in the final total. Checking only the end-state total is the classic bug that lets a 5th person board a 4-seat car between two intermediate stops; there's a dedicated unit test for exactly this (`tests/unit/detourInserter.test.ts`).
3. **`breaksAnyExistingDeadline`** re-derives the whole trip's completion time under the new stop order and rejects the insertion if it would slip past the trip's own `deadlineAt`. An existing guest is never sacrificed for a new one.

A cheap pre-filter (haversine distance from the driver to the new pickup) and a hard cap on `(active trips) × (candidate positions)` evaluations per tick keep this bounded, since it's the one part of the matching path that issues a routing call per candidate rather than one batched matrix call.

## 7. Clustering and group splitting

`Clusterer.build()` groups compatible `QueueEntry`s sharing a `type|pickup|dropoff|15-min-time-bucket` key into one shared-ride `ClusterDemand`, subject to a fleet-wide seat/luggage cap, `maxSharedGuestsPerTrip`, and a pickup-radius check (haversine only — spending a routing API call just to decide two pickups are "close enough" would blow the "one matrix call per tick" budget). A second pass merges same-pickup, *different*-drop clusters — common when a group lands together but is staying at different hotels — using a corridor test: `directDistance(pickup, farthestDrop) * 1.25 ≥ totalNearestNeighbourPathDistance`, still gated by the same time-window and capacity caps so unrelated arrivals hours apart never merge just because they happen to share a hotel.

`GroupSplitter.split()` handles demand larger than any single vehicle (the seed data's deliberate 14-person group against a 12-seat max vehicle) via first-fit-decreasing bin packing, sharing a `groupSplitId` across the resulting "convoy" so the batch assigner tries to seat them in the same round. A booking is only ever broken up if it alone exceeds the largest vehicle — otherwise families/same-booking guests always land in one vehicle.

## 8. Routing and cost control — four cache layers, one matrix call per tick

1. **Static precomputation.** At seed time, the full Location×Location matrix (airport/station/venue/all accommodations, ≤8×8=64 cells here) is computed once and stored `isStatic: true` — it never expires. Most trips run between known locations, so most ETA lookups never touch the network.
2. **L1 in-memory LRU** (`lru-cache`, 5,000 entries, 5-min TTL) in front of Mongo.
3. **L2 Mongo `DistanceCache`**, keyed by geohash-7 buckets (~153m × 153m), so a driver crawling in traffic reuses the same cache entry instead of firing a lookup per GPS ping.
4. **Batching.** `DispatchEngine.tick()` makes exactly one `RoutingService.matrix()` call per tick (drivers × demands), chunked automatically to stay under `OSRM_MAX_MATRIX_CELLS`, rather than one `/route` call per pair.

`GET /api/dispatch/health` exposes `cacheHitRate`, `breakerOpen`, and `callsLast5Min` live — this is a genuine efficiency signal, not decoration, and is surfaced in the admin header.

## 9. Traffic without a traffic API — an honest limitation

OSRM's public demo has no live traffic data. Rather than fake it, `TrafficModel` composes four layers: time-of-day peak windows from `EventConfig`, an admin-controlled global multiplier (the "Traffic" slider — dragging it live triggers a visible re-optimization wave), admin-dropped incident zones (pin + radius + multiplier + expiry), and an **EWMA of `(actual leg seconds / predicted leg seconds)` bucketed by hour-of-day**, fed from completed trips as they finish. That last layer is the interesting one: as trips complete, the system learns that a leg predicted at 12 minutes actually took 17 at 09:00, and future ETAs in that hour bucket are corrected. This makes "continuous re-optimization as live traffic changes ETAs" a real, self-calibrating mechanism rather than a decorative one — built on a free, keyless, traffic-less router. **Limitation, stated plainly:** it only reacts to drift observed in this event's own trips; it has no external signal and won't anticipate a jam it hasn't already seen the effect of.

## 10. Role separation

Enforced server-side, independently of the frontend: every driver-role handler resolves its target with `Trip.findOne({ _id, driverId: req.user.driverId })` — a driver requesting another driver's trip gets a **404, not a 403** (no existence leak), proven by an automated RBAC test suite (`tests/integration/rbac.test.ts`) that also asserts a driver token never reaches `/api/admin/*` or `/api/dispatch/*`, a guest token never reaches `/api/driver/*` or `/api/admin/*`, and no `/api/driver/*` response body ever contains another driver's id. The frontend's `RequireRole` (redirecting a driver hitting `/` straight to `/driver`) is pure UX — removing it would degrade the experience, not create a security hole, because the server never trusted the client's routing in the first place.

## 11. Degradation strategy

| Failure | Behaviour |
|---|---|
| Dispatch engine throws / cron dies | In-progress trips are unaffected — they're plain documents driven by driver status updates over Socket.IO, not by the engine. |
| Routing provider down | Circuit breaker (3 failures/60s → open 120s → half-open probe) falls through OSRM → ORS → haversine, which never fails. ETAs get an "~estimated" badge in that case. |
| Mongo blip | Mongoose auto-reconnects with write buffering; the tick lock has a TTL, so it can't deadlock permanently even if a process dies mid-tick. |
| Socket disconnect | Client reconnects with backoff and resyncs full state over REST — sockets are only ever a delta on top of a REST-fetched baseline, never the source of truth. |
| Everything automated breaks | `POST /api/admin/trips/manual` and `/api/admin/trips/:id/reassign` touch `TripService` only — no scoring code in the import graph — so a manual override always works even if the engine is on fire. |

## 12. Trade-offs made

- **OSRM demo over Google Maps**: free and keyless, but no live traffic and no SLA. Mitigated by the traffic model, four-layer caching, and the OSRM→ORS→haversine fallback chain.
- **PWA over React Native**: one codebase, an instant live URL, installable on a phone home screen — at the cost of true background geolocation and native push on iOS.
- **JWT in localStorage over httpOnly cookies**: avoids cross-site cookie complexity between two Vercel projects and a Render backend on different origins; accepts XSS exposure, mitigated by a short token expiry.
- **Copied `shared/` directory over a compiled workspace package**: `scripts/sync-shared.mjs` copies `shared/src/**` into each app's `src/shared/` on `predev`/`prebuild`. Eliminates build-ordering failures on Render's free tier and in CI, at the cost of a sync step and a committed generated copy per app.
- **Hungarian on a bounded matrix, greedy above 150×150**: optimal where it's affordable, a latency guarantee where it isn't.
- **Single-process `node-cron` scheduler**: simple and adequate at this event's scale (one Render instance); would need a distributed lock (or a real queue like BullMQ) the moment there's more than one server process.
- **Atlas `0.0.0.0/0` network access**: required because Render's free tier has no static outbound IPs to allow-list.
- **Match-latency and idle-while-waiting metrics in the simulator are heuristic**, not instrumented at the source — see `docs/DEMO_SCRIPT.md`/README "Known limitations" for the specifics of how they're derived and their edge cases (e.g. a rejected-then-rematched guest's `QueueEntry.enqueuedAt` gets deliberately backdated as a priority boost, so simulation metrics track the guest's original arrival time in-memory rather than trusting that mutable field).

## 13. What would change at 10× scale

- A Redis-backed priority queue instead of a single Mongo collection scanned per tick, to avoid the `find().sort().limit(200)` becoming a bottleneck.
- A proper VRP solver (e.g. OR-Tools via a Python sidecar) for the batch round instead of Hungarian, to handle multi-stop routing and time windows jointly rather than the current two-phase cluster-then-assign approach.
- A self-hosted OSRM instance with a real traffic overlay, removing the reliance on a public demo server entirely.
- Horizontal Socket.IO scaling via the Redis adapter, and a distributed tick lock (the current Mongo-document lock is correct but not designed for many concurrent server instances beyond simple mutual exclusion).
- Bulk writes (`bulkWrite`/`insertMany`) for commit and driver-state-refresh, instead of one round trip per document. The peak-arrival simulation (README) found this is the actual bottleneck at 60+ drivers against a remote Atlas cluster — per-commit and per-driver operations are already bounded-concurrency (10 at a time), but batching them into fewer round trips is the next real win.
