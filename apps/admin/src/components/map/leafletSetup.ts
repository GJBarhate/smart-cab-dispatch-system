// §16.7: Leaflet's default marker icon 404s under bundlers. Fix once, globally.
// Import this module exactly once (main.tsx) before any MapContainer mounts.
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import icon2x from 'leaflet/dist/images/marker-icon-2x.png';
import shadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconUrl: icon,
  iconRetinaUrl: icon2x,
  shadowUrl: shadow
});
