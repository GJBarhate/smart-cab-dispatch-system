"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.rooms = void 0;
const rooms = {
  admin: () => 'admin',
  driver: driverId => `driver:${driverId}`,
  guest: guestId => `guest:${guestId}`,
  trip: tripId => `trip:${tripId}`
};
exports.rooms = rooms;
