import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The editor page. It is loaded from disk inside Electron (file://), so every address is relative.
// The empty states' pictures (src/empty/*.png, named by style.css) stay files with their own names: the UI test
// (tests/uitest.js) looks for "search.png" in the picture's address.
export const emptyPicture = /(^|[\\/])empty[\\/][^\\/]+\.png$/;

/** The icons and agent logos are other people's work, bundled into the page's script: their licence and attribution
    go out with every build (dist/licenses/), as those licences ask. */
export const licences: Plugin = {
  name: 'openpixel-licences',
  generateBundle() {
    for (const [name, file] of [['LUCIDE-LICENSE.txt', 'src/lib/LUCIDE-LICENSE.txt'], ['AGENT-LOGOS-ATTRIBUTION.txt', 'src/lib/AGENT-LOGOS-ATTRIBUTION.txt']]) {
      this.emitFile({ type: 'asset', fileName: `licenses/${name}`, source: readFileSync(new URL(file, import.meta.url)) });
    }
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), licences],
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
