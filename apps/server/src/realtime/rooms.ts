export const rooms = {
  admin: () => 'admin',
  driver: (driverId: string) => `driver:${driverId}`,
  guest: (guestId: string) => `guest:${guestId}`,
  trip: (tripId: string) => `trip:${tripId}`
};
