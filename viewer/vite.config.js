import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    open: true,
    port: 3000
  },
  build: {
    outDir: 'dist'
  }
});
