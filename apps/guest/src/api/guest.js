import { apiClient } from './client';
export const guestApi = {
  me: () => apiClient.get('/api/guest/me'),
  tripCurrent: () => apiClient.get('/api/guest/trip/current'),
  tripHistory: () => apiClient.get('/api/guest/trip/history'),
  locations: () => apiClient.get('/api/guest/locations'),
  createRequest: body => apiClient.post('/api/guest/requests', body),
  getRequest: id => apiClient.get(`/api/guest/requests/${id}`),
  cancelRequest: id => apiClient.delete(`/api/guest/requests/${id}`),
  pushSubscribe: subscription => apiClient.post('/api/guest/push/subscribe', {
    subscription
  }),
  rateTrip: (id, rating, comment) => apiClient.post(`/api/guest/trip/${id}/rate`, {
    rating,
    comment
  })
};
