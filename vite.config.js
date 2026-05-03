import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  server: { port: 5173, host: true },
  build: {
    target: 'esnext',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        'track-map': resolve(__dirname, 'sources/track-map/index.html'),
        standings: resolve(__dirname, 'sources/standings/index.html'),
        gaps: resolve(__dirname, 'sources/gaps/index.html'),
        tyres: resolve(__dirname, 'sources/tyres/index.html')
      }
    }
  }
});
