import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The editor page. It is loaded from disk inside Electron (file://), so every address is relative.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome140', sourcemap: true },
  server: { port: 5173, strictPort: true },
});
