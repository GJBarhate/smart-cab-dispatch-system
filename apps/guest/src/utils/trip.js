export function nextPendingStop(trip) {
  const pending = trip.stops.filter(s => s.status !== 'done').sort((a, b) => a.seq - b.seq);
  return pending[0] ?? null;
}

/** Prefers a stop that explicitly involves this guest; falls back to whichever stop is next overall. */
export function nextStopForGuest(trip, guestId) {
  const mine = trip.stops.filter(s => s.guestIds.includes(guestId) && s.status !== 'done').sort((a, b) => a.seq - b.seq);
  return mine[0] ?? nextPendingStop(trip);
}
export function dropStopForGuest(trip, guestId) {
  const mine = trip.stops.filter(s => s.kind === 'drop' && s.guestIds.includes(guestId)).sort((a, b) => a.seq - b.seq);
  return mine[0] ?? null;
}
export function pickupStopForGuest(trip, guestId) {
  const mine = trip.stops.filter(s => s.kind === 'pickup' && s.guestIds.includes(guestId)).sort((a, b) => a.seq - b.seq);
  return mine[0] ?? null;
}
