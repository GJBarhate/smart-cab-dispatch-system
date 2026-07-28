import { apiClient } from './client';
import { withIds } from '../lib/normalize';
import type {
  Driver, Guest, Trip, QueueEntry, RideRequest, Alert, LocationDoc, EventConfig,
  DashboardData, AnalyticsData, DispatchHealth, DispatchPreview, DriverSummary,
  AuditEntry, AiAskResult, AiExplainResult, AiDigestResult
} from '../types/models';

// ---------- Auth ----------
export const AuthApi = {
  login: (identifier: string, password: string) =>
    apiClient.post<{ token: string; role: 'admin' | 'driver'; name: string }>('/auth/login', { identifier, password }),
  me: () =>
    apiClient.get<
      | { role: 'admin'; user: { id: string; name: string; email?: string } }
      | { role: 'driver'; driver: Driver }
    >('/auth/me'),
  logout: () => apiClient.post<{ loggedOut: boolean }>('/auth/logout')
};

// ---------- Admin ----------
export const AdminApi = {
  dashboard: async () => {
    const data = await apiClient.get<DashboardData>('/admin/dashboard');
    return { ...data, alerts: withIds(data.alerts) };
  },

  drivers: (status?: string) => apiClient.get<Driver[]>(`/admin/drivers${status ? `?status=${status}` : ''}`),
  createDriver: (body: {
    name: string; phone: string; licenseNo?: string; vehicleNumber: string; vehicleModel?: string;
    vehicleColour?: string; vehicleType: 'sedan' | 'suv' | 'tempo' | 'bus'; seats: number; luggage: number;
    shiftStartAt?: string; shiftEndAt?: string;
  }) => apiClient.post<{ driver: Driver; generatedPassword: string }>('/admin/drivers', body),
  updateDriver: (id: string, body: Partial<Pick<Driver, 'name' | 'phone' | 'isActive'>> & { status?: 'offline' | 'idle' | 'suspended'; capacity?: { seats: number; luggage: number } }) =>
    apiClient.patch<Driver>(`/admin/drivers/${id}`, body),
  forceBreak: (id: string) => apiClient.post<Driver>(`/admin/drivers/${id}/break`),

  guests: (params?: { status?: string; accommodationId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.accommodationId) qs.set('accommodationId', params.accommodationId);
    const s = qs.toString();
    return apiClient.get<Guest[]>(`/admin/guests${s ? `?${s}` : ''}`);
  },
  createGuest: (body: {
    bookingRef: string; name: string; phone: string; email?: string; groupSize?: number;
    luggageCount?: number; isVip?: boolean; accommodationId?: string; specialNeeds?: string;
  }) => apiClient.post<Guest>('/admin/guests', body),
  updateGuest: (id: string, body: Record<string, unknown>) => apiClient.patch<Guest>(`/admin/guests/${id}`, body),
  importGuests: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postForm<{ created: number; errors: Array<{ row: number; message: string }> }>('/admin/guests/import', form);
  },

  requests: (status?: string) => apiClient.get<RideRequest[]>(`/admin/requests${status ? `?status=${status}` : ''}`),
  approveRequest: (id: string) => apiClient.post<RideRequest>(`/admin/requests/${id}/approve`),
  declineRequest: (id: string, reason: string) => apiClient.post<RideRequest>(`/admin/requests/${id}/decline`, { reason }),

  trips: (status?: string) => apiClient.get<Trip[]>(`/admin/trips${status ? `?status=${status}` : ''}`),
  manualTrip: (body: {
    driverId: string; guestIds: string[]; pickupLat: number; pickupLng: number; pickupLabel?: string;
    dropoffLat: number; dropoffLng: number; dropoffLabel?: string; type?: string;
  }) => apiClient.post<Trip>('/admin/trips/manual', body),
  reassignTrip: (id: string, driverId: string) => apiClient.post<Trip>(`/admin/trips/${id}/reassign`, { driverId }),
  cancelTrip: (id: string, reason: string) => apiClient.post<Trip>(`/admin/trips/${id}/cancel`, { reason }),

  queue: (status?: string) => apiClient.get<QueueEntry[]>(`/admin/queue${status ? `?status=${status}` : ''}`),
  boostQueueEntry: (id: string) => apiClient.post<QueueEntry>(`/admin/queue/${id}/boost`),

  locations: () => apiClient.get<LocationDoc[]>('/admin/locations'),
  createLocation: (body: { name: string; type: string; address?: string; lat: number; lng: number; geofenceRadiusM?: number }) =>
    apiClient.post<LocationDoc>('/admin/locations', body),

  config: () => apiClient.get<EventConfig>('/admin/config'),
  updateConfig: (body: { dispatch?: Record<string, unknown>; traffic?: Record<string, unknown>; featureFlags?: Record<string, unknown> }) =>
    apiClient.patch<EventConfig>('/admin/config', body),

  alerts: async (acknowledged?: boolean) => {
    const data = await apiClient.get<Alert[]>(`/admin/alerts${acknowledged !== undefined ? `?acknowledged=${acknowledged}` : ''}`);
    return withIds(data);
  },
  ackAlert: (id: string) => apiClient.post<Alert>(`/admin/alerts/${id}/ack`),

  analytics: () => apiClient.get<AnalyticsData>('/admin/analytics'),

  audit: (page = 1) => apiClient.get<AuditEntry[]>(`/admin/audit?page=${page}`)
};

// ---------- AI (admin-only, read-only, never in the dispatch path) ----------
export const AiApi = {
  ask: (question: string) => apiClient.post<AiAskResult>('/ai/ask', { question }),
  // Works with GEMINI_API_KEY unset too — the server falls back to a
  // deterministic template built from the recorded cost breakdown.
  explain: (tripId: string) => apiClient.get<AiExplainResult>(`/ai/explain/${tripId}`),
  digest: (hours = 4) => apiClient.get<AiDigestResult>(`/ai/digest?hours=${hours}`)
};

// ---------- Dispatch ----------
export const DispatchApi = {
  tick: () => apiClient.post<{ matched?: number; unassignable?: number; durationMs?: number; skipped?: string; reason?: string }>('/dispatch/tick'),
  previewBatch: () => apiClient.post<DispatchPreview>('/dispatch/batch/preview'),
  health: () => apiClient.get<DispatchHealth>('/dispatch/health'),
  reoptimize: () => apiClient.post<unknown>('/dispatch/reoptimize'),
  setFlags: (flags: { autoDispatchEnabled?: boolean; sharingEnabled?: boolean; detourEnabled?: boolean; aiEnabled?: boolean }) =>
    apiClient.patch<EventConfig['featureFlags']>('/dispatch/flags', flags)
};

// ---------- Driver (self-scoped) ----------
export const DriverApi = {
  me: () => apiClient.get<Driver>('/driver/me'),
  setStatus: (action: 'online' | 'offline' | 'request_break') => apiClient.patch<Driver>('/driver/status', { action }),
  currentTrip: () => apiClient.get<Trip>('/driver/trip/current'),
  accept: (tripId: string) => apiClient.post<Trip>(`/driver/trip/${tripId}/accept`),
  reject: (tripId: string, reason: string) => apiClient.post<Trip>(`/driver/trip/${tripId}/reject`, { reason }),
  arrived: (tripId: string) => apiClient.post<Trip>(`/driver/trip/${tripId}/arrived`),
  board: (tripId: string, guestIds: string[]) => apiClient.post<Trip>(`/driver/trip/${tripId}/board`, { guestIds }),
  drop: (tripId: string, guestIds: string[], stopSeq: number) => apiClient.post<Trip>(`/driver/trip/${tripId}/drop`, { guestIds, stopSeq }),
  postLocation: (lat: number, lng: number, heading?: number, speed?: number) =>
    apiClient.post<{ updated: boolean }>('/driver/location', { lat, lng, heading, speed }),
  summary: () => apiClient.get<DriverSummary>('/driver/summary')
};
