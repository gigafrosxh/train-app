import { maplibregl } from '../../core/map/maplibre';
import { Bbox, CountryShape, bboxOf, polygonsOf } from './country-geo';

/**
 * Höhenmodell, das nur das gewählte Land anhebt (Plateau). Kacheln werden im Browser
 * gezeichnet: Terrain-RGB („mapbox“), außen 0 m, innen +6553,6 m. Nur der Rotkanal
 * unterscheidet sich, daher ergeben geglättete Kanten saubere Zwischenhöhen.
 * Sichtbare Höhe wird über die Terrain-Überhöhung je Zoomstufe gesteuert.
 */

export const PLATEAU_METERS = 6553.6;
const SIZE = 256;
const GROUND = 'rgb(1,134,160)'; // 0 m
const RAISED = 'rgb(2,134,160)'; // +6553,6 m

let shapes = new Map<string, { polys: number[][][][]; bbox: Bbox }>();
let flatTile: Promise<ArrayBuffer> | null = null;
let registered = false;

function encode(canvas: OffscreenCanvas): Promise<ArrayBuffer> {
  return canvas.convertToBlob({ type: 'image/png' }).then((b) => b.arrayBuffer());
}

function flat(): Promise<ArrayBuffer> {
  flatTile ??= (() => {
    const c = new OffscreenCanvas(SIZE, SIZE);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, SIZE, SIZE);
    return encode(c);
  })();
  return flatTile;
}

function tileBounds(z: number, x: number, y: number): Bbox {
  const n = 2 ** z;
  const lng = (v: number) => (v / n) * 360 - 180;
  const lat = (v: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI;
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)];
}

async function drawTile(code: string, z: number, x: number, y: number): Promise<ArrayBuffer> {
  const shape = shapes.get(code);
  if (!shape) return flat();
  const [w, s, e, n] = tileBounds(z, x, y);
  // etwas Rand, damit Nachbarkacheln an der Kante gleich aussehen
  const padX = (e - w) * 0.05;
  const padY = (n - s) * 0.05;
  const b = shape.bbox;
  if (e + padX < b[0] || w - padX > b[2] || n + padY < b[1] || s - padY > b[3]) return flat();

  const world = SIZE * 2 ** z;
  const px = (lng: number) => ((lng + 180) / 360) * world - x * SIZE;
  const py = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * world - y * SIZE;
  };

  // Mit Rand zeichnen und weichzeichnen, dann zuschneiden – so entstehen keine Rillen an Kachelgrenzen.
  const PAD = 12;
  const big = new OffscreenCanvas(SIZE + 2 * PAD, SIZE + 2 * PAD);
  const bctx = big.getContext('2d')!;
  bctx.fillStyle = GROUND;
  bctx.fillRect(0, 0, big.width, big.height);
  bctx.fillStyle = RAISED;
  // Weiche Kante: sonst erzeugt das Terrain-Gitter an der Grenze Zacken.
  bctx.filter = `blur(${z >= 7 ? 2 : 1.2}px)`;
  bctx.beginPath();
  for (const poly of shape.polys) {
    for (const ring of poly) {
      ring.forEach(([lng, lat], i) =>
        i === 0 ? bctx.moveTo(px(lng) + PAD, py(lat) + PAD) : bctx.lineTo(px(lng) + PAD, py(lat) + PAD),
      );
      bctx.closePath();
    }
  }
  bctx.fill('evenodd');
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(big, PAD, PAD, SIZE, SIZE, 0, 0, SIZE, SIZE);
  return encode(c);
}

/** Registriert das Protokoll „raised://CODE/z/x/y“ einmalig. */
export function registerRaisedTerrain() {
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('raised', async (params) => {
    const m = /^raised:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) return { data: await flat() };
    return { data: await drawTile(m[1], Number(m[2]), Number(m[3]), Number(m[4])) };
  });
}

export function setRaisedCountry(code: string, shape: CountryShape) {
  shapes = new Map(shapes);
  shapes.set(code, { polys: polygonsOf(shape), bbox: bboxOf(shape) });
}

/** Überhöhung so wählen, dass das Plateau bei jedem Zoom ca. `px` Pixel hoch wirkt. */
export function exaggerationFor(zoom: number, lat: number, px = 16): number {
  const metersPerPixel = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return Math.max(0.0005, (px * metersPerPixel) / PLATEAU_METERS);
}
