// Hand-typed mirrors of the Mongoose documents the server actually serializes
// (see apps/server/src/models/*.ts). These are intentionally more complete
// than shared/src/types.ts's DTOs, which are a looser approximation.
// `id` (not `_id`) is present on every document — see baseSchemaOptions'
// toJSON transform on the server.

export type GeoPoint = { type: 'Point'; coordinates: [number, number] }; // [lng, lat] — never hand-construct, use lib/geo.ts

export type DriverStatus =
  | 'offline' | 'idle' | 'assigned' | 'en_route_pickup' | 'at_pickup' | 'on_trip' | 'on_break' | 'suspended';

export type GuestStatus =
  | 'registered' | 'awaiting_pickup' | 'queued' | 'assigned' | 'in_transit' | 'completed' | 'no_show';

export type TripType = 'ARRIVAL_PICKUP' | 'TO_VENUE' | 'FROM_VENUE' | 'DEPARTURE_DROP' | 'INTER_HOTEL' | 'ON_DEMAND';

export type TripStatus =
  | 'pending_driver' | 'accepted' | 'en_route_pickup' | 'at_pickup' | 'boarded' | 'completed' | 'cancelled' | 'rejected' | 'unassignable';

export type RequestStatus = 'pending_approval' | 'approved' | 'declined' | 'matched' | 'expired';

export type QueueStatus = 'waiting' | 'matching' | 'assigned' | 'failed';

export type LocationType = 'airport' | 'railway_station' | 'accommodation' | 'venue' | 'custom';

export type AssignmentStrategy = 'batch_hungarian' | 'greedy_realtime' | 'detour_insert' | 'manual_override' | 'starvation_sweep';

export type VehicleType = 'sedan' | 'suv' | 'tempo' | 'bus';

export interface Vehicle {
  number: string;
  model: string;
  colour: string;
  type: VehicleType;
}

export interface Capacity {
  seats: number;
  luggage: number;
}

export interface Driver {
  id: string;
  userId: string;
  name: string;
  phone: string;
  licenseNo: string;
  vehicle: Vehicle;
  capacity: Capacity;
  status: DriverStatus;
  currentLocation: GeoPoint;
  locationUpdatedAt?: string | null;
  heading: number;
  speedKmph: number;
  currentTripId?: string | null;
  assignedTripIds: string[];
  predictedFreeAt?: string;
  predictedFreeLocation?: GeoPoint;
  shift: { startAt: string | null; endAt: string | null };
  break: { tripsSinceBreak: number; minutesSinceBreak: number; lastBreakEndedAt: string | null; onBreakUntil: string | null };
  stats: { tripsCompleted: number; guestsServed: number; totalIdleMinutes: number; totalDriveMinutes: number; rejections: number };
  rejectedEntryIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GuestArrival {
  mode: 'flight' | 'train' | 'road';
  identifier?: string;
  scheduledAt?: string | null;
  actualAt?: string | null;
  pickupLocationId?: string | null;
  terminal?: string;
}

export interface GuestDeparture {
  mode: 'flight' | 'train' | 'road';
  identifier?: string;
  scheduledAt?: string | null;
  dropLocationId?: string | null;
}

export interface Guest {
  id: string;
  bookingRef: string;
  name: string;
  phone: string;
  email?: string;
  groupSize: number;
  luggageCount: number;
  priorityTier: number;
  isVip: boolean;
  arrival?: GuestArrival;
  departure?: GuestDeparture;
  accommodationId?: string | null;
  status: GuestStatus;
  currentTripId?: string | null;
  waitingSince?: string | null;
  specialNeeds?: string;
  notes: Array<{ at: string; by: string; text: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface LocationDoc {
  id: string;
  name: string;
  type: LocationType;
  address?: string;
  coordinates: GeoPoint;
  geofenceRadiusM: number;
  meta?: { terminal?: string; gate?: string; contactPhone?: string };
  isActive: boolean;
}

export interface TripStop {
  seq: number;
  kind: 'pickup' | 'drop';
  guestIds: string[];
  locationId?: string | null;
  coordinates: GeoPoint;
  label: string;
  plannedAt?: string | null;
  etaAt?: string | null;
  actualAt?: string | null;
  status: 'pending' | 'arrived' | 'done';
}

export interface CostBreakdown {
  eta: number;
  lateness: number;
  priority: number;
  idle: number;
  capacityWaste: number;
  breakUrgency: number;
  rejectionHistory: number;
  detour: number;
  total: number;
}

export interface Trip {
  id: string;
  code: string;
  type: TripType;
  status: TripStatus;
  driverId?: string | null;
  vehicleSnapshot?: { number: string; model: string; seats: number; luggage: number };
  guests: Array<{
    guestId: string;
    name: string;
    seats: number;
    luggage: number;
    boardedAt?: string | null;
    droppedAt?: string | null;
    pickupStopSeq?: number | null;
    dropStopSeq?: number | null;
  }>;
  stops: TripStop[];
  route?: { polyline: string; distanceMeters: number; durationSeconds: number; computedAt?: string | null; provider: string };
  capacityUsed: { seats: number; luggage: number };
  deadlineAt?: string | null;
  assignmentMeta?: {
    strategy: AssignmentStrategy;
    score: number;
    costBreakdown: CostBreakdown;
    candidatesConsidered: number;
    decidedAt?: string | null;
    decidedBy: string;
  };
  groupSplitId?: string | null;
  sourceRequestId?: string | null;
  rejectionReason?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RideRequest {
  id: string;
  guestId: string | Guest;
  requestedAt: string;
  pickup: { locationId?: string | null; coordinates: GeoPoint; label: string };
  dropoff: { locationId?: string | null; coordinates: GeoPoint; label: string };
  passengerCount: number;
  luggageCount: number;
  reason?: string;
  notes?: string;
  status: RequestStatus;
  declineReason?: string;
  tripId?: string | null;
  createdAt: string;
}

export interface QueueEntry {
  id: string;
  type: TripType;
  guestIds: string[];
  seats: number;
  luggage: number;
  pickup: { locationId?: string | null; coordinates: GeoPoint; label: string };
  dropoff: { locationId?: string | null; coordinates: GeoPoint; label: string };
  earliestAt: string;
  deadlineAt: string;
  enqueuedAt: string;
  priorityTier: number;
  priorityScore: number;
  status: QueueStatus;
  attempts: number;
  lastAttemptAt?: string | null;
  lastFailureReason?: string;
  clusterKey?: string;
}

export interface Alert {
  id: string;
  // The server's Alert model predates baseSchemaOptions and never got the
  // toJSON transform every other model has — it serializes `_id`, not `id`.
  // Kept here so the frontend normalizer (lib/normalize.ts) can paper over it
  // without assuming the field exists everywhere.
  _id?: string;
  level: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
  entity?: { type: string | null; id: string | null } | null;
  acknowledged: boolean;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
  createdAt: string;
}

export interface DispatchWeights {
  eta: number;
  lateness: number;
  priority: number;
  idle: number;
  capacityWaste: number;
  breakUrgency: number;
  rejectionHistory: number;
  detour: number;
}

export interface EventConfig {
  id: string;
  singleton: string;
  name: string;
  timezone: string;
  startAt: string;
  endAt: string;
  venueId?: string | null;
  airportId?: string | null;
  stationId?: string | null;
  accommodationIds: string[];
  phases: Array<{ key: string; startAt: string; endAt: string; defaultTripType: TripType }>;
  dispatch: {
    weights: DispatchWeights;
    batchHorizonMin: number;
    maxDetourMin: number;
    starvationThresholdMin: number;
    maxSharedGuestsPerTrip: number;
    clusterRadiusM: number;
    clusterTimeWindowMin: number;
    driverBreakAfterTrips: number;
    driverBreakMinutes: number;
    driverMaxContinuousMin: number;
    offerTimeoutSec: number;
    maxReassignAttempts: number;
  };
  traffic: {
    peakWindows: Array<{ from: string; to: string; multiplier: number }>;
    globalMultiplier: number;
    incidents: Array<{ id: string; lat: number; lng: number; radiusM: number; multiplier: number; expiresAt: string | null }>;
  };
  featureFlags: {
    aiEnabled: boolean;
    detourEnabled: boolean;
    sharingEnabled: boolean;
    autoDispatchEnabled: boolean;
  };
}

export interface DashboardData {
  kpis: {
    guestsWaiting: number;
    avgWaitMin: number;
    oldestWaitMin: number;
    unassignable: number;
    tripsCompletedToday: number;
  };
  guestsByStatus: Record<string, number>;
  driversByStatus: Record<string, number>;
  liveDrivers: Array<Pick<Driver, 'id' | 'name' | 'status' | 'currentLocation' | 'heading'> & { vehicle: Vehicle }>;
  alerts: Alert[];
}

export interface HistogramBucket {
  bucket: string;
  count: number;
}

export interface AnalyticsData {
  avgWaitMin: number;
  p95WaitMin: number;
  sharedRidePct: number;
  driverUtilisationPct: number;
  assignmentsByStrategy: Record<string, number>;
  tripsCompleted: number;
  waitDistribution: HistogramBucket[];
  etaAccuracyDistribution: HistogramBucket[];
  etaWithin2MinPct: number;
  tripsByHour: Array<{ hour: string; trips: number; guests: number }>;
  tripsPerDriver: Array<{ name: string; trips: number }>;
  detourSavedMin: number;
  sharedTripCount: number;
}

export interface AuditEntry {
  id: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  at: string;
  ip: string;
}

/** `available: false` is the shape returned when GEMINI_API_KEY is unset. */
export interface AiAskResult {
  available: boolean;
  message?: string;
  answer?: string;
  rows?: unknown[];
}

export interface AiExplainResult {
  explanation: string;
  /** false when the deterministic template was returned unpolished. */
  aiPolished: boolean;
}

export interface AiDigestResult {
  digest: string;
  aiPolished: boolean;
  stats: {
    hours: number;
    tripsCompleted: number;
    tripsCreated: number;
    waitingNow: number;
    unassignable: number;
    oldestWaitMin: number;
  };
}

export interface DispatchHealth {
  routing: { provider: string; breakerOpen: boolean; cacheHitRate: number };
  callsLast5Min: number;
}

export interface DispatchPreview {
  drivers: Array<{ id: string; name: string }>;
  demands: Array<{ id: string; guestIds: string[]; seats: number; luggage: number }>;
  costMatrix: number[][];
  chosenPairs: Array<{ driverIndex: number; demandIndex: number; cost: number; breakdown: CostBreakdown }>;
}

export interface DriverSummary {
  tripsToday: number;
  tripsCompleted: number;
  guestsServed: number;
  tripsSinceBreak: number;
  onBreakUntil: string | null;
}
