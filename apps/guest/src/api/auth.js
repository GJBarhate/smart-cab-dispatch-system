import { apiClient } from './client';
export const authApi = {
  guestLogin: (bookingRef, phone) => apiClient.post('/api/auth/guest/login', {
    bookingRef,
    phone
  }),
  logout: () => apiClient.post('/api/auth/logout')
};
