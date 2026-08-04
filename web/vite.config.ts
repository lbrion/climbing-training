import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Climb Plan',
        short_name: 'ClimbPlan',
        description: 'Deterministic bouldering training plans',
        theme_color: '#111418',
        background_color: '#111418',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/state/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-state' },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
