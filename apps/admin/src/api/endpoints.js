import { apiClient } from './client';
import { withIds } from '../lib/normalize';
// ---------- Auth ----------
export const AuthApi = {
  login: (identifier, password) => apiClient.post('/auth/login', {
    identifier,
    password
  }),
  me: () => apiClient.get('/auth/me'),
  logout: () => apiClient.post('/auth/logout')
};

// ---------- Admin ----------
export const AdminApi = {
  dashboard: async () => {
    const data = await apiClient.get('/admin/dashboard');
    return {
      ...data,
      alerts: withIds(data.alerts)
    };
  },
  drivers: status => apiClient.get(`/admin/drivers${status ? `?status=${status}` : ''}`),
  createDriver: body => apiClient.post('/admin/drivers', body),
  updateDriver: (id, body) => apiClient.patch(`/admin/drivers/${id}`, body),
  forceBreak: id => apiClient.post(`/admin/drivers/${id}/break`),
  guests: params => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.accommodationId) qs.set('accommodationId', params.accommodationId);
    const s = qs.toString();
    return apiClient.get(`/admin/guests${s ? `?${s}` : ''}`);
  },
  createGuest: body => apiClient.post('/admin/guests', body),
  updateGuest: (id, body) => apiClient.patch(`/admin/guests/${id}`, body),
  importGuests: file => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm('/admin/guests/import', form);
  },
  requests: status => apiClient.get(`/admin/requests${status ? `?status=${status}` : ''}`),
  approveRequest: id => apiClient.post(`/admin/requests/${id}/approve`),
  declineRequest: (id, reason) => apiClient.post(`/admin/requests/${id}/decline`, {
    reason
  }),
  trips: status => apiClient.get(`/admin/trips${status ? `?status=${status}` : ''}`),
  manualTrip: body => apiClient.post('/admin/trips/manual', body),
  reassignTrip: (id, driverId) => apiClient.post(`/admin/trips/${id}/reassign`, {
    driverId
  }),
  cancelTrip: (id, reason) => apiClient.post(`/admin/trips/${id}/cancel`, {
    reason
  }),
  queue: status => apiClient.get(`/admin/queue${status ? `?status=${status}` : ''}`),
  boostQueueEntry: id => apiClient.post(`/admin/queue/${id}/boost`),
  locations: () => apiClient.get('/admin/locations'),
  createLocation: body => apiClient.post('/admin/locations', body),
  config: () => apiClient.get('/admin/config'),
  updateConfig: body => apiClient.patch('/admin/config', body),
  alerts: async acknowledged => {
    const data = await apiClient.get(`/admin/alerts${acknowledged !== undefined ? `?acknowledged=${acknowledged}` : ''}`);
    return withIds(data);
  },
  ackAlert: id => apiClient.post(`/admin/alerts/${id}/ack`),
  analytics: () => apiClient.get('/admin/analytics'),
  audit: (page = 1) => apiClient.get(`/admin/audit?page=${page}`)
};

// ---------- AI (admin-only, read-only, never in the dispatch path) ----------
export const AiApi = {
  ask: question => apiClient.post('/ai/ask', {
    question
  }),
  // Works with GEMINI_API_KEY unset too — the server falls back to a
  // deterministic template built from the recorded cost breakdown.
  explain: tripId => apiClient.get(`/ai/explain/${tripId}`),
  digest: (hours = 4) => apiClient.get(`/ai/digest?hours=${hours}`)
};

// ---------- Dispatch ----------
export const DispatchApi = {
  tick: () => apiClient.post('/dispatch/tick'),
  previewBatch: () => apiClient.post('/dispatch/batch/preview'),
  health: () => apiClient.get('/dispatch/health'),
  reoptimize: () => apiClient.post('/dispatch/reoptimize'),
  setFlags: flags => apiClient.patch('/dispatch/flags', flags)
};

// ---------- Driver (self-scoped) ----------
export const DriverApi = {
  me: () => apiClient.get('/driver/me'),
  setStatus: action => apiClient.patch('/driver/status', {
    action
  }),
  currentTrip: () => apiClient.get('/driver/trip/current'),
  accept: tripId => apiClient.post(`/driver/trip/${tripId}/accept`),
  reject: (tripId, reason) => apiClient.post(`/driver/trip/${tripId}/reject`, {
    reason
  }),
  arrived: tripId => apiClient.post(`/driver/trip/${tripId}/arrived`),
  board: (tripId, guestIds) => apiClient.post(`/driver/trip/${tripId}/board`, {
    guestIds
  }),
  drop: (tripId, guestIds, stopSeq) => apiClient.post(`/driver/trip/${tripId}/drop`, {
    guestIds,
    stopSeq
  }),
  postLocation: (lat, lng, heading, speed) => apiClient.post('/driver/location', {
    lat,
    lng,
    heading,
    speed
  }),
  summary: () => apiClient.get('/driver/summary')
};
