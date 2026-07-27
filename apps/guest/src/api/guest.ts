import { apiClient } from './client';
import type { CreateRequestBody, CurrentTripResponse, GuestMe, LocationLite, RideRequestView, TripView } from '../types/domain';

export const guestApi = {
  me: () => apiClient.get<GuestMe>('/api/guest/me'),
  tripCurrent: () => apiClient.get<CurrentTripResponse | null>('/api/guest/trip/current'),
  tripHistory: () => apiClient.get<TripView[]>('/api/guest/trip/history'),
  locations: () => apiClient.get<LocationLite[]>('/api/guest/locations'),
  createRequest: (body: CreateRequestBody) => apiClient.post<RideRequestView>('/api/guest/requests', body),
  getRequest: (id: string) => apiClient.get<RideRequestView>(`/api/guest/requests/${id}`),
  cancelRequest: (id: string) => apiClient.delete<RideRequestView>(`/api/guest/requests/${id}`),
  pushSubscribe: (subscription: unknown) => apiClient.post<{ subscribed: boolean }>('/api/guest/push/subscribe', { subscription }),
  rateTrip: (id: string, rating: number, comment?: string) =>
    apiClient.post<{ rated: boolean }>(`/api/guest/trip/${id}/rate`, { rating, comment })
};
