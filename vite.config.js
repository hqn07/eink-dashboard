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
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the big vendor deps into their own chunks so the editor
        // isn't one 640 kB blob. react/react-dom/scheduler stay together
        // (splitting them duplicates the context and breaks hooks).
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('@phosphor-icons')) return 'vendor-icons';
          if (id.includes('react-grid-layout') || id.includes('react-resizable')) return 'vendor-grid';
          if (id.includes('qrcode')) return 'vendor-qr';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react';
        }
      }
    }
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
