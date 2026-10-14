// Geometrie-Hilfen für den Mock: Wegsuche im Streckennetz und Interpolation.

import { LngLat } from '../models/api.models';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distance(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const key = (p: LngLat) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

/** Ungerichteter Graph aus Linienzügen; Knoten = Koordinaten. */
export class RailGraph {
  private readonly adj = new Map<string, { to: string; w: number }[]>();
  private readonly coords = new Map<string, LngLat>();
  private readonly cache = new Map<string, LngLat[]>();

  constructor(lines: LngLat[][]) {
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) this.addEdge(line[i - 1], line[i]);
    }
  }

  private addEdge(a: LngLat, b: LngLat) {
    const ka = key(a);
    const kb = key(b);
    this.coords.set(ka, a);
    this.coords.set(kb, b);
    const w = distance(a, b);
    if (!this.adj.has(ka)) this.adj.set(ka, []);
    if (!this.adj.has(kb)) this.adj.set(kb, []);
    this.adj.get(ka)!.push({ to: kb, w });
    this.adj.get(kb)!.push({ to: ka, w });
  }

  /** Kürzester Weg zwischen zwei Punkten; ohne Verbindung: Luftlinie. */
  path(from: LngLat, to: LngLat): LngLat[] {
    const ks = key(from);
    const kt = key(to);
    const cacheKey = ks + '|' + kt;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    if (!this.adj.has(ks) || !this.adj.has(kt)) return [from, to];

    const dist = new Map<string, number>([[ks, 0]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([ks]);
    while (open.size) {
      let cur = '';
      let best = Infinity;
      for (const k of open) {
        const d = dist.get(k)!;
        if (d < best) {
          best = d;
          cur = k;
        }
      }
      open.delete(cur);
      if (cur === kt) break;
      for (const { to: nb, w } of this.adj.get(cur) ?? []) {
        const nd = best + w;
        if (nd < (dist.get(nb) ?? Infinity)) {
          dist.set(nb, nd);
          prev.set(nb, cur);
          open.add(nb);
        }
      }
    }
    if (!dist.has(kt)) return [from, to];
    const out: LngLat[] = [];
    for (let k: string | undefined = kt; k; k = prev.get(k)) out.unshift(this.coords.get(k)!);
    this.cache.set(cacheKey, out);
    return out;
  }
}

/** Punkt bei Anteil t (0..1) entlang eines Linienzugs, inkl. Fahrtrichtung. */
export function along(line: LngLat[], t: number): { at: LngLat; bearing: number } {
  if (line.length < 2) return { at: line[0], bearing: 0 };
  const segs = line.slice(1).map((p, i) => distance(line[i], p));
  const total = segs.reduce((a, b) => a + b, 0);
  let target = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const f = segs[i] === 0 ? 0 : target / segs[i];
      const a = line[i];
      const b = line[i + 1];
      return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing: bearing(a, b) };
    }
    target -= segs[i];
  }
  return { at: line[line.length - 1], bearing: 0 };
}
