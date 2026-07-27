import type { LatLng } from '../../../utils/geo';

export interface MatrixResult {
  durations: number[][]; // seconds
  distances: number[][]; // metres
}

export interface EtaResult {
  durationSeconds: number;
  distanceMeters: number;
}

export interface RouteLeg {
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteResult {
  polyline: string;
  durationSeconds: number;
  distanceMeters: number;
  legs: RouteLeg[];
}

export interface RoutingProvider {
  readonly name: string;
  matrix(origins: LatLng[], dests: LatLng[]): Promise<MatrixResult>;
  route(waypoints: LatLng[]): Promise<RouteResult>;
}
