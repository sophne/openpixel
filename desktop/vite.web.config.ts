import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { emptyPicture, licences } from './vite.config';

// The browser preview: the editor page with the app's logic (host/) and the core (core-pkg/, WebAssembly) in the
// tab itself; see web/main.ts. `npm run build:core` first. It builds into web/dist (ignored by git like every
// `dist/`, and outside dist/, which `vite build` empties and the installers pack).
// The empty states' pictures keep their names and the licences go out with the build, as in vite.config.ts.

/** web.html is the entry here; a static server looks for index.html. */
const asIndex: Plugin = {
  name: 'openpixel-web-index',
  enforce: 'post',
  generateBundle(_, bundle) {
    const page = bundle['web.html'];
    if (page) page.fileName = 'index.html';
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), asIndex, licences],
  build: {
    outDir: 'web/dist', emptyOutDir: true, target: 'chrome140', sourcemap: true,
    assetsInlineLimit: (file) => (emptyPicture.test(file) ? false : undefined),
    rollupOptions: {
      input: 'web.html',
      output: {
        assetFileNames: (asset) => ((asset.originalFileNames || []).some((f) => emptyPicture.test(f)) ? 'assets/[name][extname]' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
});
