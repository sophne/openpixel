import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The editor page. It is loaded from disk inside Electron (file://), so every address is relative.
// The empty states' pictures (src/empty/*.png, named by style.css) stay files with their own names, as on the old
// page: app/web/uitest.js looks for "search.png" in the picture's address, and style.css is not ours to change.
const emptyPicture = /(^|[\\/])empty[\\/][^\\/]+\.png$/;

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'chrome140', sourcemap: true,
    assetsInlineLimit: (file) => (emptyPicture.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        assetFileNames: (asset) => ((asset.originalFileNames || []).some((f) => emptyPicture.test(f)) ? 'assets/[name][extname]' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
