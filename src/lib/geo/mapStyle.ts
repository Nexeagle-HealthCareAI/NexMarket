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
 * Without a token it uses OpenFreeMap (https://openfreemap.org) — free, no key,
 * commercial use allowed, real roads and village names. (It used to fall back to
 * MapLibre's demo style, which shows only country outlines — useless in the field.)
 * Override with NEXT_PUBLIC_MAP_STYLE_URL to point at any other MapLibre style.
 */

import type { StyleSpecification } from 'maplibre-gl';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const CUSTOM_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
const OPENFREEMAP = {
  // Pale and quiet — the dashboard's coverage colours and agent dots stand out on it.
  light: 'https://tiles.openfreemap.org/styles/positron',
  // Full colour roads, rivers and place names — for agents finding their way.
  streets: 'https://tiles.openfreemap.org/styles/liberty',
};

export function getBasemapStyle(variant: 'light' | 'streets' = 'streets'): string | StyleSpecification {
  if (CUSTOM_STYLE_URL) return CUSTOM_STYLE_URL;
  if (!MAPBOX_TOKEN) {
    return OPENFREEMAP[variant];
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
