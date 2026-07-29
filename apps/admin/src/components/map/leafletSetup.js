// §16.7: Leaflet's default marker icon 404s under bundlers. Fix once, globally.
//
// Imported by every component that mounts a MapContainer, not by main.tsx: ES
// modules evaluate once no matter how many importers there are, so this still
// runs exactly once and always before a map renders — while keeping leaflet out
// of the bundle on routes that show no map.
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import icon2x from 'leaflet/dist/images/marker-icon-2x.png';
import shadow from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({
  iconUrl: icon,
  iconRetinaUrl: icon2x,
  shadowUrl: shadow
});
