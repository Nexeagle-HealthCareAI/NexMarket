// Copies MapLibre's web-worker files into public/maplibre/ so the maps can load them.
//
// Why: MapLibre finds its worker relative to `import.meta.url`. Once webpack bundles the
// library that URL points at the page, so the worker loads HTML and silently does nothing —
// no vector basemap, no panchayat outlines, no routes. src/lib/geo/maplibre.ts points
// MapLibre at these copies instead. Runs before every dev/build so they always match the
// installed version.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'maplibre-gl', 'dist');
const to = join(root, 'public', 'maplibre');
mkdirSync(to, { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) copyFileSync(join(from, f), join(to, f));
console.log('MapLibre worker copied to public/maplibre/');
