import React from 'react';
import ReactDOM from 'react-dom/client';
// Leaflet's stylesheet and default-icon fix used to be imported here. Both now
// travel with the map component (see components/LiveMap.tsx and
// components/leafletSetup.ts), so a guest who never opens tracking does not
// download the mapping library at all.
import './index.css';
import App from './App';
import { initTheme } from './store/themeStore';

// Reconciles the store with the class the inline bootstrap already applied and
// starts following the OS preference (until the user picks a theme by hand).
initTheme();
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode>
    <App />
  </React.StrictMode>);
