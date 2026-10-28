import * as maplibregl from 'maplibre-gl';

// Load MapLibre's worker from public/maplibre/ (copied there by scripts/copy-maplibre-worker.mjs).
// Without this the bundled library looks for its worker at the page's own URL and every
// GeoJSON layer and vector basemap stays blank.
if (typeof window !== 'undefined') {
  maplibregl.setWorkerUrl(`${window.location.origin}/maplibre/maplibre-gl-worker.mjs`);
}

export default maplibregl;
export * from 'maplibre-gl';
