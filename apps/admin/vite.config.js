import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    devOptions: {
      enabled: false
    },
    includeAssets: ['favicon.svg'],
    manifest: {
      name: 'EventRide Ops — Admin',
      short_name: 'EventRide Ops',
      description: 'Operations console for event ride dispatch',
      theme_color: '#6d28d9',
      background_color: '#ffffff',
      display: 'standalone',
      orientation: 'portrait',
      icons: [{
        src: 'pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png'
      }, {
        src: 'pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png'
      }]
    },
    workbox: {
      runtimeCaching: [{
        urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'osm-tiles',
          expiration: {
            maxEntries: 200,
            maxAgeSeconds: 60 * 60 * 24 * 7
          }
        }
      }, {
        urlPattern: ({
          url,
          request
        }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-get',
          networkTimeoutSeconds: 10
        }
      }]
    }
  })],
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing vendor libraries out of the main
        // bundle. recharts (Analytics) and leaflet (maps) together are most
        // of the weight and aren't needed on first paint of every route.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-map': ['leaflet', 'react-leaflet'],
          'vendor-query': ['@tanstack/react-query', 'socket.io-client']
        }
      }
    }
  },
  server: {
    port: 5174,
    strictPort: true
  },
  preview: {
    port: 5174
  }
});
