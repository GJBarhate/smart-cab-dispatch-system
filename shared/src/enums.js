export const Role = {
  ADMIN: 'admin',
  DRIVER: 'driver',
  GUEST: 'guest'
};
export const DriverStatus = {
  OFFLINE: 'offline',
  IDLE: 'idle',
  ASSIGNED: 'assigned',
  EN_ROUTE_PICKUP: 'en_route_pickup',
  AT_PICKUP: 'at_pickup',
  ON_TRIP: 'on_trip',
  ON_BREAK: 'on_break',
  SUSPENDED: 'suspended'
};
export const GuestStatus = {
  REGISTERED: 'registered',
  AWAITING_PICKUP: 'awaiting_pickup',
  QUEUED: 'queued',
  ASSIGNED: 'assigned',
  IN_TRANSIT: 'in_transit',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show'
};
export const TripType = {
  ARRIVAL_PICKUP: 'ARRIVAL_PICKUP',
  TO_VENUE: 'TO_VENUE',
  FROM_VENUE: 'FROM_VENUE',
  DEPARTURE_DROP: 'DEPARTURE_DROP',
  INTER_HOTEL: 'INTER_HOTEL',
  ON_DEMAND: 'ON_DEMAND'
};
export const TripStatus = {
  PENDING_DRIVER: 'pending_driver',
  ACCEPTED: 'accepted',
  EN_ROUTE_PICKUP: 'en_route_pickup',
  AT_PICKUP: 'at_pickup',
  BOARDED: 'boarded',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  UNASSIGNABLE: 'unassignable'
};
export const RequestStatus = {
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  DECLINED: 'declined',
  MATCHED: 'matched',
  EXPIRED: 'expired'
};
export const QueueStatus = {
  WAITING: 'waiting',
  MATCHING: 'matching',
  ASSIGNED: 'assigned',
  FAILED: 'failed'
};
export const LocationType = {
  AIRPORT: 'airport',
  RAILWAY_STATION: 'railway_station',
  ACCOMMODATION: 'accommodation',
  VENUE: 'venue',
  CUSTOM: 'custom'
};
export const AssignmentStrategy = {
  BATCH_HUNGARIAN: 'batch_hungarian',
  GREEDY_REALTIME: 'greedy_realtime',
  DETOUR_INSERT: 'detour_insert',
  MANUAL_OVERRIDE: 'manual_override',
  STARVATION_SWEEP: 'starvation_sweep'
};
export const PriorityTier = {
  VIP: 3,
  SPEAKER: 2,
  STANDARD: 1
};
export const VehicleType = {
  SEDAN: 'sedan',
  SUV: 'suv',
  TEMPO: 'tempo',
  BUS: 'bus'
};
