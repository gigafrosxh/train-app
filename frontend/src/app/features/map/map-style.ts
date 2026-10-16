import type { FilterSpecification, LayerSpecification, Map as MlMap, StyleSpecification } from 'maplibre-gl';

export interface MapPalette {
  water: string;
  land: string;
  border: string;
  country: string;
  countryEdge: string;
  shadow: string;
  highlight: string;
  rail: string;
  railBranch: string;
  railCasing: string;
  station: string;
  stationRing: string;
  route: string;
}

export const LIGHT: MapPalette = {
  water: '#dfe8f5',
  land: '#e9edf3',
  border: '#c9d3e3',
  country: '#ffffff',
  countryEdge: '#9bb5e6',
  shadow: '#5a6f99',
  highlight: '#ffffff',
  rail: '#1d5bd6',
  railBranch: '#6f93db',
  railCasing: '#ffffff',
  station: '#ffffff',
  stationRing: '#1d5bd6',
  route: '#f59e0b',
};

export const DARK: MapPalette = {
  water: '#070c17',
  land: '#111827',
  border: '#24314d',
  country: '#1e3160',
  countryEdge: '#5b86e0',
  shadow: '#000000',
  highlight: '#3a5a9a',
  rail: '#8ab4ff',
  railBranch: '#5576b6',
  railCasing: '#0b1220',
  station: '#0b1220',
  stationRing: '#8ab4ff',
  route: '#fbbf24',
};

/**
 * Eigener Stil ohne Kachelserver: keine Straßen, kein Satellit.
 * Quellen werden nach dem Laden befüllt.
 */
export function buildStyle(p: MapPalette): StyleSpecification {
  const empty = { type: 'FeatureCollection' as const, features: [] };
  return {
    version: 8,
    sources: {
      countries: { type: 'geojson', data: empty },
      selected: { type: 'geojson', data: empty },
      railways: { type: 'geojson', data: empty },
      route: { type: 'geojson', data: empty },
      stations: { type: 'geojson', data: empty },
    },
    layers: [
      { id: 'water', type: 'background', paint: { 'background-color': p.water } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': p.land } },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': p.border, 'line-width': 0.8 } },
      { id: 'selected-fill', type: 'fill', source: 'selected', paint: { 'fill-color': p.country } },
      { id: 'selected-edge', type: 'line', source: 'selected', paint: { 'line-color': p.countryEdge, 'line-width': 1.2, 'line-opacity': 0.7 } },
      {
        id: 'rail-casing',
        type: 'line',
        source: 'railways',
        filter: ['in', ['get', 'usage'], ['literal', ['main', 'branch']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.railCasing,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 9, 6, 13, 10],
          'line-opacity': 0.9,
        },
      },
      {
        id: 'rail-minor',
        type: 'line',
        source: 'railways',
        filter: ['!', ['in', ['get', 'usage'], ['literal', ['main', 'branch']]]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.railBranch,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 2.5],
          'line-dasharray': [2, 2],
        },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'railways',
        filter: ['in', ['get', 'usage'], ['literal', ['main', 'branch']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'usage'], 'main', p.rail, p.railBranch],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 9, 3, 13, 5],
        },
      },
      {
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': p.route,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 7],
          'line-opacity': 0.9,
        },
      },
      // Kleine Halte erst beim Hineinzoomen, sonst wird die Landesansicht unruhig
      stationLayer('stations', p, ['!', ['get', 'major']], 8),
      stationLayer('stations-major', p, ['get', 'major'], 5),
    ],
  };
}

function stationLayer(id: string, p: MapPalette, filter: unknown, minzoom: number): LayerSpecification {
  return {
    id,
    type: 'circle',
    source: 'stations',
    minzoom,
    filter: filter as FilterSpecification,
    paint: {
      'circle-color': p.station,
      'circle-stroke-color': p.stationRing,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 11, 2.5],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2.5, 11, 5],
      'circle-pitch-alignment': 'map',
    },
  };
}

/** Farben eines bestehenden Stils austauschen (Hell/Dunkel). */
export function applyPalette(map: MlMap, p: MapPalette) {
  // MapLibre 6 typisiert Eigenschaft und Wert pro Layer-Typ; hier gemischt über alle Layer
  type Paint = Parameters<MlMap['setPaintProperty']>;
  const set = (layer: string, prop: string, value: unknown) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop as Paint[1], value as Paint[2]);
  };
  set('water', 'background-color', p.water);
  set('land', 'fill-color', p.land);
  set('borders', 'line-color', p.border);
  set('selected-fill', 'fill-color', p.country);
  set('selected-edge', 'line-color', p.countryEdge);
  set('rail-casing', 'line-color', p.railCasing);
  set('rail-minor', 'line-color', p.railBranch);
  set('rail', 'line-color', ['match', ['get', 'usage'], 'main', p.rail, p.railBranch]);
  set('route', 'line-color', p.route);
  for (const id of ['stations', 'stations-major']) {
    set(id, 'circle-color', p.station);
    set(id, 'circle-stroke-color', p.stationRing);
  }
  set('hillshade', 'hillshade-shadow-color', p.shadow);
  set('hillshade', 'hillshade-highlight-color', p.highlight);
}
