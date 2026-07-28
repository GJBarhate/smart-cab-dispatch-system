import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
// Leaflet's stylesheet and default-icon fix travel with the map instead of
// loading on every route — 15 kB of CSS and 45 kB gzipped of JS a guest only
// needs on /track.
import 'leaflet/dist/leaflet.css';
import './leafletSetup';
import L from 'leaflet';
import { Locate } from 'lucide-react';
import type { LatLng } from '../utils/geo';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL;
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION;

function carIcon(heading: number): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="transform: rotate(${Math.round(heading)}deg); transform-origin: center; width:34px; height:34px; display:flex; align-items:center; justify-content:center; background:#2563eb; border-radius:9999px; box-shadow:0 2px 6px rgba(0,0,0,0.35); border:2px solid white;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function pinIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex; flex-direction:column; align-items:center;">
      <div style="width:26px;height:26px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:700;">${label}</div>
      <div style="width:2px;height:8px;background:${color};"></div>
    </div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34]
  });
}

/** Interpolates a marker's visual position between GPS updates so it glides instead of teleporting. */
function useAnimatedPosition(target: LatLng | null, durationMs = 4000): LatLng | null {
  const [pos, setPos] = useState<LatLng | null>(target);
  const fromRef = useRef<LatLng | null>(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) return;
    const from = fromRef.current ?? target;
    const to = target;
    const start = performance.now();

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setPos({ lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t });
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.lat, target?.lng, durationMs]);

  return pos;
}

function AutoFollow({
  driverPos,
  bounds,
  autoFollow,
  onUserDrag
}: {
  driverPos: LatLng | null;
  bounds: LatLng[];
  autoFollow: boolean;
  onUserDrag: () => void;
}): null {
  const map = useMap();
  const firstFit = useRef(false);

  useMapEvents({
    dragstart: onUserDrag
  });

  useEffect(() => {
    if (!firstFit.current && bounds.length > 0) {
      firstFit.current = true;
      if (bounds.length === 1) {
        map.setView([bounds[0].lat, bounds[0].lng], 15);
      } else {
        map.fitBounds(bounds.map((b) => [b.lat, b.lng] as [number, number]), { padding: [40, 40] });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.length]);

  useEffect(() => {
    if (autoFollow && driverPos) {
      map.panTo([driverPos.lat, driverPos.lng], { animate: true, duration: 0.8 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPos?.lat, driverPos?.lng, autoFollow]);

  return null;
}

function RecenterFab({
  visible,
  onClick
}: {
  visible: boolean;
  onClick: () => void;
}): JSX.Element | null {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      aria-label="Recenter map"
      className="absolute bottom-4 right-4 z-[1000] flex h-12 w-12 items-center justify-center rounded-full bg-surface shadow-lg ring-1 ring-line active:scale-95"
    >
      <Locate className="h-6 w-6 text-brand-600" />
    </button>
  );
}

export interface LiveMapProps {
  driverPosition: (LatLng & { heading?: number }) | null;
  pickup?: LatLng | null;
  drop?: LatLng | null;
  polyline?: [number, number][];
  className?: string;
  mapId: string;
}

export function LiveMap({ driverPosition, pickup, drop, polyline = [], className = '', mapId }: LiveMapProps): JSX.Element {
  const [autoFollow, setAutoFollow] = useState(true);
  const animatedDriverPos = useAnimatedPosition(driverPosition ? { lat: driverPosition.lat, lng: driverPosition.lng } : null);

  const bounds = useMemo(() => {
    const pts: LatLng[] = [];
    if (driverPosition) pts.push(driverPosition);
    if (pickup) pts.push(pickup);
    if (drop) pts.push(drop);
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPosition?.lat, driverPosition?.lng, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);

  const center = useMemo<[number, number]>(() => {
    if (driverPosition) return [driverPosition.lat, driverPosition.lng];
    if (pickup) return [pickup.lat, pickup.lng];
    return [18.559, 73.7997]; // Sahyadri Convention Centre, Pune — sane fallback
  }, [driverPosition, pickup]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <MapContainer key={mapId} center={center} zoom={14} scrollWheelZoom className="h-full w-full" attributionControl>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />

        {polyline.length > 1 && <Polyline positions={polyline} pathOptions={{ color: '#2563eb', weight: 4, opacity: 0.8 }} />}

        {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pinIcon('#16a34a', 'P')} />}
        {drop && <Marker position={[drop.lat, drop.lng]} icon={pinIcon('#dc2626', 'D')} />}

        {animatedDriverPos && (
          <Marker position={[animatedDriverPos.lat, animatedDriverPos.lng]} icon={carIcon(driverPosition?.heading ?? 0)} />
        )}

        <AutoFollow driverPos={animatedDriverPos} bounds={bounds} autoFollow={autoFollow} onUserDrag={() => setAutoFollow(false)} />
      </MapContainer>

      <RecenterFab visible={!autoFollow} onClick={() => setAutoFollow(true)} />
    </div>
  );
}
