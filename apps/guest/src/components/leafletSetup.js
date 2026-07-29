// Leaflet's default marker icon 404s under bundlers unless the URLs are pointed
// at the bundled assets once, globally.
//
// Imported by LiveMap rather than by main.tsx: at the entry point it pulled all
// of leaflet (154 kB, 45 kB gzipped) into the initial bundle for every route,
// so a guest checking their booking downloaded the whole mapping library to
// look at a list. ES modules evaluate once regardless of how many importers
// there are, so this still runs exactly once and always before a map mounts.
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import icon2x from 'leaflet/dist/images/marker-icon-2x.png';
import shadow from 'leaflet/dist/images/marker-shadow.png';
L.Icon.Default.mergeOptions({
  iconUrl: icon,
  iconRetinaUrl: icon2x,
  shadowUrl: shadow
});
