import { useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { toLeafletTuple, isZeroPoint } from '../../lib/geo';
import { carDivIcon, pinDivIcon, DRIVER_STATUS_LABEL } from './driverIcons';
import type { DriverStatus, GeoPoint } from '../../types/models';

const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string) || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = (import.meta.env.VITE_MAP_ATTRIBUTION as string) || '&copy; OpenStreetMap contributors';

// Pune, India — the seeded event city (plan.md §17) — sane default center.
const DEFAULT_CENTER: [number, number] = [18.559, 73.8];

export interface MapDriver {
  id: string;
  name: string;
  status: DriverStatus;
  currentLocation: GeoPoint;
  heading?: number;
  vehicleNumber?: string;
}

export interface MapPickup {
  id: string;
  label: string;
  coordinates: GeoPoint;
}

interface Props {
  drivers: MapDriver[];
  pickups?: MapPickup[];
  onSelectDriver?: (driver: MapDriver) => void;
  className?: string;
  height?: string;
}

function FitOnce({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
      return;
    }
    map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    // Only run once on mount / when the point count changes meaningfully —
    // we don't want every 5s location tick to yank the admin's viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);
  return null;
}

export function LiveOpsMap({ drivers, pickups = [], onSelectDriver, className = '', height = '100%' }: Props) {
  const driverPoints = useMemo(
    () =>
      drivers
        .filter((d) => !isZeroPoint(d.currentLocation))
        .map((d) => toLeafletTuple(d.currentLocation)),
    [drivers]
  );

  const allPoints = useMemo(() => {
    const pickupPoints = pickups.filter((p) => !isZeroPoint(p.coordinates)).map((p) => toLeafletTuple(p.coordinates));
    return [...driverPoints, ...pickupPoints];
  }, [driverPoints, pickups]);

  return (
    <div className={className} style={{ height }}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={12}
        style={{ height: '100%', width: '100%', borderRadius: 'inherit' }}
        scrollWheelZoom
      >
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <FitOnce points={allPoints} />
        {drivers
          .filter((d) => !isZeroPoint(d.currentLocation))
          .map((d) => (
            <Marker
              key={d.id}
              position={toLeafletTuple(d.currentLocation)}
              icon={carDivIcon(d.status, d.heading ?? 0)}
              eventHandlers={onSelectDriver ? { click: () => onSelectDriver(d) } : undefined}
            >
              <Popup>
                <div className="text-xs">
                  <p className="font-semibold">{d.name}</p>
                  <p>{DRIVER_STATUS_LABEL[d.status]}</p>
                  {d.vehicleNumber && <p className="text-gray-500">{d.vehicleNumber}</p>}
                </div>
              </Popup>
            </Marker>
          ))}
        {pickups
          .filter((p) => !isZeroPoint(p.coordinates))
          .map((p) => (
            <Marker key={p.id} position={toLeafletTuple(p.coordinates)} icon={pinDivIcon('#7c3aed', true)}>
              <Popup>
                <div className="text-xs">
                  <p className="font-semibold">Waiting pickup</p>
                  <p>{p.label}</p>
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}
