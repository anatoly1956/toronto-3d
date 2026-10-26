import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so dist/ works from any sub-path when published.
  base: './',
  // Three.js alone is ~550 kB minified; that's expected here.
  build: { chunkSizeWarningLimit: 800 },
});
