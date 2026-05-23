import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  clearScreen: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
