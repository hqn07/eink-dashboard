import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite builds the React control app and emits to public/control-app,
// which Express serves at /control.
export default defineConfig({
  root: 'control-src',
  plugins: [react()],
  base: '/control-app/',
  build: {
    outDir: path.resolve(__dirname, 'public/control-app'),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    port: 5173,
    proxy: {
      '/api':     'http://localhost:3000',
      '/display.png': 'http://localhost:3000',
      '/display.bin': 'http://localhost:3000',
      '/sleep':   'http://localhost:3000',
      '/dashboard': 'http://localhost:3000'
    }
  }
});
