import React from 'react';
import ReactDOM from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import icon2x from 'leaflet/dist/images/marker-icon-2x.png';
import shadow from 'leaflet/dist/images/marker-shadow.png';
import './index.css';
import App from './App';

// Leaflet's default marker icon 404s under bundlers unless fixed once, globally.
L.Icon.Default.mergeOptions({ iconUrl: icon, iconRetinaUrl: icon2x, shadowUrl: shadow });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
