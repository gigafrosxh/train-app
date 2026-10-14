import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

/** ISO 3166-1 alpha-2 → numerische ID in world-atlas (Natural Earth). */
const ISO_NUMERIC: Record<string, string> = {
  AT: '040', DE: '276', CH: '756', CZ: '203', HU: '348', IT: '380', SI: '705', SK: '703', LI: '438',
  FR: '250', PL: '616', NL: '528', BE: '056', LU: '442', DK: '208', HR: '191', ES: '724', PT: '620',
  GB: '826', IE: '372', SE: '752', NO: '578', FI: '246', RO: '642', BG: '100', RS: '688', BA: '070',
  GR: '300', EE: '233', LV: '428', LT: '440', UA: '804', BY: '112', MD: '498', AL: '008', MK: '807', ME: '499',
};

export type CountryShape = Feature<Polygon | MultiPolygon, { name: string }>;
export type Bbox = [number, number, number, number];

let cache: Promise<FeatureCollection<Polygon | MultiPolygon, { name: string }>> | null = null;

/** Ländergrenzen (Natural Earth 1:50 Mio., mit der App ausgeliefert). */
export function loadCountries(): Promise<FeatureCollection<Polygon | MultiPolygon, { name: string }>> {
  cache ??= fetch('geo/countries-50m.json')
    .then((r) => r.json() as Promise<Topology>)
    .then((topo) => feature(topo, topo.objects['countries'] as GeometryCollection) as unknown as FeatureCollection<Polygon | MultiPolygon, { name: string }>);
  return cache;
}

export function findCountry(all: FeatureCollection<Polygon | MultiPolygon, { name: string }>, code: string): CountryShape | null {
  const id = ISO_NUMERIC[code.toUpperCase()];
  return (all.features.find((f) => String(f.id) === id) as CountryShape | undefined) ?? null;
}

export function polygonsOf(shape: CountryShape): number[][][][] {
  const g = shape.geometry;
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

export function bboxOf(shape: CountryShape): Bbox {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const poly of polygonsOf(shape)) {
    for (const [x, y] of poly[0]) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return [minX, minY, maxX, maxY];
}
