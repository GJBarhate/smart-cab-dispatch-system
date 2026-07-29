import { useQuery } from '@tanstack/react-query';
import { guestApi } from '../api/guest';
const STALE_TIME = 15_000;
export const guestKeys = {
  me: ['guest', 'me'],
  tripCurrent: ['guest', 'tripCurrent'],
  tripHistory: ['guest', 'tripHistory'],
  locations: ['guest', 'locations'],
  request: id => ['guest', 'request', id]
};
export function useGuestMe() {
  return useQuery({
    queryKey: guestKeys.me,
    queryFn: guestApi.me,
    staleTime: STALE_TIME
  });
}
export function useTripCurrent() {
  return useQuery({
    queryKey: guestKeys.tripCurrent,
    queryFn: guestApi.tripCurrent,
    staleTime: STALE_TIME
  });
}
export function useTripHistory() {
  return useQuery({
    queryKey: guestKeys.tripHistory,
    queryFn: guestApi.tripHistory,
    staleTime: STALE_TIME
  });
}
export function useGuestLocations() {
  return useQuery({
    queryKey: guestKeys.locations,
    queryFn: guestApi.locations,
    staleTime: 5 * 60_000
  });
}
export function usePendingRequest(requestId) {
  return useQuery({
    queryKey: requestId ? guestKeys.request(requestId) : ['guest', 'request', 'none'],
    queryFn: () => guestApi.getRequest(requestId),
    enabled: !!requestId,
    staleTime: STALE_TIME
  });
}
