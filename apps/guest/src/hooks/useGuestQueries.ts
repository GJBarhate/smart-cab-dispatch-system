import { useQuery, UseQueryResult } from '@tanstack/react-query';
import { guestApi } from '../api/guest';
import type { CurrentTripResponse, GuestMe, LocationLite, RideRequestView, TripView } from '../types/domain';

const STALE_TIME = 15_000;

export const guestKeys = {
  me: ['guest', 'me'] as const,
  tripCurrent: ['guest', 'tripCurrent'] as const,
  tripHistory: ['guest', 'tripHistory'] as const,
  locations: ['guest', 'locations'] as const,
  request: (id: string) => ['guest', 'request', id] as const
};

export function useGuestMe(): UseQueryResult<GuestMe> {
  return useQuery({ queryKey: guestKeys.me, queryFn: guestApi.me, staleTime: STALE_TIME });
}

export function useTripCurrent(): UseQueryResult<CurrentTripResponse | null> {
  return useQuery({ queryKey: guestKeys.tripCurrent, queryFn: guestApi.tripCurrent, staleTime: STALE_TIME });
}

export function useTripHistory(): UseQueryResult<TripView[]> {
  return useQuery({ queryKey: guestKeys.tripHistory, queryFn: guestApi.tripHistory, staleTime: STALE_TIME });
}

export function useGuestLocations(): UseQueryResult<LocationLite[]> {
  return useQuery({ queryKey: guestKeys.locations, queryFn: guestApi.locations, staleTime: 5 * 60_000 });
}

export function usePendingRequest(requestId: string | null): UseQueryResult<RideRequestView> {
  return useQuery({
    queryKey: requestId ? guestKeys.request(requestId) : ['guest', 'request', 'none'],
    queryFn: () => guestApi.getRequest(requestId as string),
    enabled: !!requestId,
    staleTime: STALE_TIME
  });
}
