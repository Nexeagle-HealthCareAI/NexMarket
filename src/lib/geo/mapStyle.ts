/**
 * Shared MapLibre basemap style.
 *
 * Uses Mapbox's Streets raster tiles when NEXT_PUBLIC_MAPBOX_TOKEN is set — a
 * plain XYZ raster source, not Mapbox's vector style JSON, because that JSON
 * contains `mapbox://` sprite/glyph/source URLs that only the official
 * mapbox-gl library resolves automatically; MapLibre does not, so a vector
 * style would render with missing labels/icons unless we duplicated that
 * resolution logic ourselves. Raster tiles need no such resolution and are
 * guaranteed to render correctly with any MapLibre version.
 *
 * Falls back to MapLibre's own key-free demo style when no token is
 * configured, so local dev works with zero setup.
 */

import type { StyleSpecification } from 'maplibre-gl';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const FALLBACK_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

export function getBasemapStyle(): string | StyleSpecification {
  if (!MAPBOX_TOKEN) {
    return FALLBACK_STYLE_URL;
  }

  return {
    version: 8,
    sources: {
      'mapbox-streets': {
        type: 'raster',
        tiles: [
          `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
        ],
        tileSize: 512,
        attribution: '© Mapbox © OpenStreetMap',
      },
    },
    layers: [{ id: 'mapbox-streets-layer', type: 'raster', source: 'mapbox-streets' }],
  };
}
