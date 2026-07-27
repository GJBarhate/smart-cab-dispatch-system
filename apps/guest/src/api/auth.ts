import { apiClient } from './client';

export interface GuestLoginResponse {
  token: string;
  role: 'guest';
  name: string;
}

export const authApi = {
  guestLogin: (bookingRef: string, phone: string) =>
    apiClient.post<GuestLoginResponse>('/api/auth/guest/login', { bookingRef, phone }),
  logout: () => apiClient.post<{ loggedOut: boolean }>('/api/auth/logout')
};
