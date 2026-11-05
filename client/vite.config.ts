import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // three.js alone minifies to ~550 kB and can't be split further cleanly; everything else stays far below.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      // three.js gets its own long-cacheable chunk; the game code changes far more often.
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\/]three[\/]/ }] } },
    },
  },
});
