export const TRIP_TYPE_LABEL = {
  ARRIVAL_PICKUP: 'Arrival pickup',
  TO_VENUE: 'To venue',
  FROM_VENUE: 'From venue',
  DEPARTURE_DROP: 'Departure drop',
  INTER_HOTEL: 'Hotel transfer',
  ON_DEMAND: 'On-demand ride'
};
export const TRIP_STATUS_LABEL = {
  pending_driver: 'Waiting for a driver to accept',
  accepted: 'Driver on the way',
  en_route_pickup: 'Driver on the way',
  at_pickup: 'Driver has arrived',
  boarded: 'On the way',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Reassigning…',
  unassignable: 'Finding another option'
};
// A trip in one of these states is still the guest's live ride. Kept in step
// with ACTIVE_TRIP_STATUSES in the server's guest.routes.js, which rejects a
// second ride request while any of them is in flight — the screen must not
// offer an action the API will refuse.
export const TRIP_ACTIVE_STATUSES = ['pending_driver', 'accepted', 'en_route_pickup', 'at_pickup', 'boarded'];
export function isTripActive(trip) {
  return !!trip && TRIP_ACTIVE_STATUSES.includes(trip.status);
}
export function tripStatusTone(status) {
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'rejected') return 'danger';
  if (status === 'unassignable') return 'warning';
  return 'brand';
}
