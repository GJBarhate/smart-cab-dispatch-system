import type {
  Role, DriverStatus, GuestStatus, TripType, TripStatus,
  RequestStatus, QueueStatus, LocationType, AssignmentStrategy, VehicleType
} from './enums';

export type LatLng = { lat: number; lng: number };
export type GeoPoint = { type: 'Point'; coordinates: [number, number] }; // [lng, lat]

export interface ApiSuccess<T> { ok: true; data: T; meta?: Record<string, unknown> }
export interface ApiFailure { ok: false; error: { code: string; message: string; details?: unknown } }
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

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

export interface DriverDTO {
  id: string;
  userId: string;
  name: string;
  phone: string;
  licenseNo: string;
  vehicle: Vehicle;
  capacity: Capacity;
  status: DriverStatus;
  currentLocation?: GeoPoint;
  locationUpdatedAt?: string;
  heading?: number;
  speedKmph?: number;
  currentTripId?: string | null;
  predictedFreeAt?: string;
  stats: { tripsCompleted: number; guestsServed: number; totalIdleMinutes: number; totalDriveMinutes: number; rejections: number };
  isActive: boolean;
}

export interface GuestArrival {
  mode: 'flight' | 'train' | 'road';
  identifier?: string;
  scheduledAt?: string;
  actualAt?: string | null;
  pickupLocationId?: string;
  terminal?: string;
}

export interface GuestDeparture {
  mode: 'flight' | 'train' | 'road';
  identifier?: string;
  scheduledAt?: string;
  dropLocationId?: string;
}

export interface GuestDTO {
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
  accommodationId?: string;
  status: GuestStatus;
  currentTripId?: string | null;
  waitingSince?: string | null;
  specialNeeds?: string;
}

export interface LocationDTO {
  id: string;
  name: string;
  type: LocationType;
  address?: string;
  coordinates: GeoPoint;
  geofenceRadiusM: number;
  isActive: boolean;
}

export interface TripStop {
  seq: number;
  kind: 'pickup' | 'drop';
  guestIds: string[];
  locationId?: string | null;
  coordinates: GeoPoint;
  label: string;
  plannedAt?: string;
  etaAt?: string;
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
  rejectionHistory?: number;
  detour: number;
  total?: number;
}

export interface TripDTO {
  id: string;
  code: string;
  type: TripType;
  status: TripStatus;
  driverId?: string | null;
  vehicleSnapshot?: { number: string; model: string; seats: number; luggage: number };
  guests: Array<{ guestId: string; name: string; seats: number; luggage: number; boardedAt?: string | null; droppedAt?: string | null }>;
  stops: TripStop[];
  route?: { polyline: string; distanceMeters: number; durationSeconds: number; computedAt: string; provider: string };
  capacityUsed: { seats: number; luggage: number };
  deadlineAt?: string;
  assignmentMeta?: {
    strategy: AssignmentStrategy;
    score: number;
    costBreakdown: CostBreakdown;
    candidatesConsidered: number;
    decidedAt: string;
    decidedBy: string;
  };
  groupSplitId?: string | null;
  sourceRequestId?: string | null;
}

export interface RideRequestDTO {
  id: string;
  guestId: string;
  requestedAt: string;
  pickup: { locationId?: string; coordinates: GeoPoint; label: string };
  dropoff: { locationId?: string; coordinates: GeoPoint; label: string };
  passengerCount: number;
  luggageCount: number;
  reason?: string;
  notes?: string;
  status: RequestStatus;
  tripId?: string | null;
}

export interface QueueEntryDTO {
  id: string;
  type: TripType;
  guestIds: string[];
  seats: number;
  luggage: number;
  pickup: { locationId?: string; coordinates: GeoPoint; label: string };
  dropoff: { locationId?: string; coordinates: GeoPoint; label: string };
  earliestAt: string;
  deadlineAt: string;
  enqueuedAt: string;
  priorityTier: number;
  priorityScore: number;
  status: QueueStatus;
  attempts: number;
  lastFailureReason?: string;
}

export interface JwtPayload {
  sub: string;
  role: Role;
  driverId?: string;
  guestId?: string;
  iat?: number;
  exp?: number;
}
