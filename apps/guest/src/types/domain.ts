// Local view-model types for the guest app. These reflect what the REST layer
// actually returns (raw Mongoose docs with populated refs), which differ
// slightly from the generic DTOs in `shared/src/types.ts` (those assume
// unpopulated ObjectId-as-string refs). Keeping them here avoids fighting the
// shared types with `as any` all over the UI.
import type { GeoPoint, GuestStatus, TripStatus, TripType, RequestStatus, AssignmentStrategy } from '../shared';

export interface LocationLite {
  id: string;
  name: string;
  type: 'airport' | 'railway_station' | 'accommodation' | 'venue' | 'custom';
  address?: string;
  coordinates: GeoPoint;
}

export interface GuestArrivalView {
  mode: 'flight' | 'train' | 'road';
  identifier?: string;
  scheduledAt?: string | null;
  actualAt?: string | null;
  pickupLocationId?: LocationLite | null;
  terminal?: string;
}

export interface GuestDepartureView {
  mode: 'flight' | 'train' | 'road';
  identifier?: string;
  scheduledAt?: string | null;
  dropLocationId?: string | null;
}

export interface GuestMe {
  id: string;
  bookingRef: string;
  name: string;
  phone: string;
  email?: string;
  groupSize: number;
  luggageCount: number;
  priorityTier: number;
  isVip: boolean;
  arrival?: GuestArrivalView;
  departure?: GuestDepartureView;
  accommodationId?: LocationLite | null;
  status: GuestStatus;
  currentTripId?: string | null;
  waitingSince?: string | null;
  specialNeeds?: string;
  pushSubscription?: unknown;
}

export interface DriverView {
  id: string;
  name: string;
  phone: string;
  vehicle: { number: string; model: string; colour: string; type: string };
  currentLocation?: GeoPoint;
  heading?: number;
  speedKmph?: number;
}

export interface TripStopView {
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

export interface TripView {
  id: string;
  code: string;
  type: TripType;
  status: TripStatus;
  driverId?: DriverView | null;
  vehicleSnapshot?: { number: string; model: string; seats: number; luggage: number };
  guests: Array<{
    guestId: string;
    name: string;
    seats: number;
    luggage: number;
    boardedAt?: string | null;
    droppedAt?: string | null;
  }>;
  stops: TripStopView[];
  route?: { polyline: string; distanceMeters: number; durationSeconds: number; computedAt: string; provider: string };
  capacityUsed: { seats: number; luggage: number };
  deadlineAt?: string | null;
  assignmentMeta?: { strategy: AssignmentStrategy; score: number };
  groupSplitId?: string | null;
  sourceRequestId?: string | null;
  timeline?: Array<{ at: string; type: string; actor?: string; payload?: unknown }>;
  createdAt?: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string;
}

export interface CurrentTripResponse {
  trip: TripView;
  coPassengers: Array<{ name: string }>;
}

export interface RideRequestView {
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
  decidedAt?: string | null;
  declineReason?: string;
  tripId?: string | null;
}

export interface CreateRequestBody {
  pickupLocationId?: string;
  pickupLat?: number;
  pickupLng?: number;
  pickupLabel?: string;
  dropoffLocationId?: string;
  dropoffLat?: number;
  dropoffLng?: number;
  dropoffLabel?: string;
  passengerCount?: number;
  luggageCount?: number;
  reason?: string;
  notes?: string;
}
