// Socket.IO event names + payload types — single source of truth for client & server

export const ClientEvents = {
  DRIVER_LOCATION: 'driver:location',
  TRIP_SUBSCRIBE: 'trip:subscribe',
  ADMIN_SUBSCRIBE_MAP: 'admin:subscribeMap'
};
export const ServerEvents = {
  TRIP_OFFERED: 'trip:offered',
  TRIP_ASSIGNED: 'trip:assigned',
  TRIP_STATUS: 'trip:status',
  TRIP_ETA: 'trip:eta',
  DRIVER_POSITION: 'driver:position',
  REQUEST_STATUS: 'request:status',
  QUEUE_UPDATE: 'queue:update',
  DISPATCH_TICK: 'dispatch:tick',
  ADMIN_ALERT: 'admin:alert',
  DRIVER_BREAK: 'driver:break'
};
