/**
 * Realistisches Demo-Netz für Österreich auf den importierten OSM-Daten.
 *
 * - Bahnhöfe: vorhandene Stationen (OSM-Import) über ihren Namen.
 * - Streckenverlauf: kürzester Weg im OSM-Gleisnetz zwischen zwei Halten (Dijkstra/A*).
 *   Jeder Abschnitt wird als eigene Strecke (source DEMO_ROUTE) gespeichert und über
 *   route_tracks verknüpft – so kann das Backend Zugpositionen entlang der Strecke schätzen.
 * - Fahrzeiten: aus der Weglänge und der Zuggattung, plus Haltezeit.
 * - Alle IDs sind deterministisch: das Skript kann gefahrlos mehrfach laufen.
 *
 * Voraussetzung: OSM-Import (Strecken + Bahnhöfe) für AT ist gelaufen.
 * Aufruf: npm run seed:network
 */
import { connect, source } from "../src/database/database";
import { Database } from "../src/database/database";
import { RailService } from "../src/rail/rail.service";
import { SchedulesService } from "../src/rail/schedules.service";
import { addDays, localToday } from "../src/rail/time";
import { seedId } from "./seed";

type Pt = [number, number];
type TrainType = "REGIONAL" | "INTERCITY" | "HIGH_SPEED" | "NIGHT";

interface LineDef {
  key: string;
  company: string;
  prefix: string;
  name: string;
  color: string;
  type: TrainType;
  numberBase: number;
  stops: string[];
  /** erste Abfahrt (Minuten ab 0:00), Takt, letzte Abfahrt */
  first: number;
  every: number;
  last: number;
}

const COMPANIES: Record<string, { name: string; code: string }> = {
  alpen: { name: "Alpenbahn (Demo)", code: "DEMO" },
  west: { name: "Westexpress (Demo)", code: "WEX" },
  sued: { name: "Südbahn Regio (Demo)", code: "SRG" },
};

const h = (hh: number, mm = 0) => hh * 60 + mm;

const LINES: LineDef[] = [
  {
    key: "rj-west",
    company: "alpen",
    prefix: "RJ",
    name: "RJ Westbahn",
    color: "#C8102E",
    type: "HIGH_SPEED",
    numberBase: 540,
    stops: [
      "Wien Hauptbahnhof",
      "Wien Meidling",
      "St. Pölten Hauptbahnhof",
      "Amstetten",
      "Linz Hauptbahnhof",
      "Wels Hauptbahnhof",
      "Attnang-Puchheim",
      "Salzburg Hauptbahnhof",
    ],
    first: h(6, 25),
    every: 60,
    last: h(21, 25),
  },
  {
    key: "wex",
    company: "west",
    prefix: "WEX",
    name: "Westexpress",
    color: "#0F7A3D",
    type: "INTERCITY",
    numberBase: 900,
    stops: [
      "Wien Westbahnhof",
      "Tullnerfeld",
      "St. Pölten Hauptbahnhof",
      "Amstetten",
      "Linz Hauptbahnhof",
      "Wels Hauptbahnhof",
      "Attnang-Puchheim",
      "Vöcklabruck",
      "Salzburg Hauptbahnhof",
    ],
    first: h(6, 8),
    every: 120,
    last: h(20, 8),
  },
  {
    key: "rj-sued",
    company: "alpen",
    prefix: "RJ",
    name: "RJ Südbahn",
    color: "#B3123A",
    type: "HIGH_SPEED",
    numberBase: 650,
    stops: [
      "Wien Hauptbahnhof",
      "Wien Meidling",
      "Wiener Neustadt Hauptbahnhof",
      "Semmering",
      "Mürzzuschlag",
      "Bruck an der Mur",
      "Graz Hauptbahnhof",
    ],
    first: h(6, 58),
    every: 120,
    last: h(20, 58),
  },
  {
    key: "rjx-koralm",
    company: "alpen",
    prefix: "RJX",
    name: "RJX Koralm",
    color: "#7A1FA2",
    type: "HIGH_SPEED",
    numberBase: 770,
    stops: [
      "Graz Hauptbahnhof",
      "Weststeiermark",
      "St. Paul im Lavanttal",
      "Klagenfurt Hauptbahnhof",
      "Villach Hauptbahnhof",
    ],
    first: h(6, 5),
    every: 60,
    last: h(22, 5),
  },
  {
    key: "ic-tauern",
    company: "alpen",
    prefix: "IC",
    name: "IC Tauern",
    color: "#1565C0",
    type: "INTERCITY",
    numberBase: 690,
    stops: [
      "Salzburg Hauptbahnhof",
      "Hallein",
      "Bischofshofen",
      "Schwarzach-St. Veit",
      "Bad Gastein",
      "Mallnitz-Obervellach",
      "Spittal-Millstättersee",
      "Villach Hauptbahnhof",
      "Klagenfurt Hauptbahnhof",
    ],
    first: h(7, 12),
    every: 120,
    last: h(19, 12),
  },
  {
    key: "rj-arlberg",
    company: "alpen",
    prefix: "RJ",
    name: "RJ Arlberg",
    color: "#D84315",
    type: "HIGH_SPEED",
    numberBase: 360,
    stops: [
      "Innsbruck Hauptbahnhof",
      "Ötztal",
      "Landeck-Zams",
      "St. Anton am Arlberg",
      "Bludenz",
      "Feldkirch",
      "Dornbirn",
      "Bregenz",
    ],
    first: h(6, 40),
    every: 120,
    last: h(20, 40),
  },
  {
    key: "rex-gisela",
    company: "alpen",
    prefix: "REX",
    name: "REX Giselabahn",
    color: "#00838F",
    type: "REGIONAL",
    numberBase: 1510,
    stops: [
      "Salzburg Hauptbahnhof",
      "Hallein",
      "Bischofshofen",
      "Schwarzach-St. Veit",
      "Zell am See",
      "Saalfelden",
      "Kitzbühel",
      "Wörgl Hauptbahnhof",
      "Jenbach",
      "Innsbruck Hauptbahnhof",
    ],
    first: h(5, 50),
    every: 120,
    last: h(19, 50),
  },
  {
    key: "rex-inntal",
    company: "alpen",
    prefix: "REX",
    name: "REX Unterinntal",
    color: "#2E7D32",
    type: "REGIONAL",
    numberBase: 5330,
    stops: [
      "Kufstein",
      "Wörgl Hauptbahnhof",
      "Jenbach",
      "Innsbruck Hauptbahnhof",
    ],
    first: h(5, 35),
    every: 60,
    last: h(22, 35),
  },
  {
    key: "s-brenner",
    company: "alpen",
    prefix: "S",
    name: "S-Bahn Brenner",
    color: "#283593",
    type: "REGIONAL",
    numberBase: 5100,
    stops: [
      "Innsbruck Hauptbahnhof",
      "Matrei am Brenner",
      "Steinach am Brenner",
    ],
    first: h(6, 31),
    every: 60,
    last: h(21, 31),
  },
  {
    key: "cjx-ost",
    company: "sued",
    prefix: "CJX",
    name: "CJX Ostbahn",
    color: "#5D4037",
    type: "REGIONAL",
    numberBase: 7720,
    stops: ["Wien Hauptbahnhof", "Bruck an der Leitha", "Nickelsdorf"],
    first: h(6, 15),
    every: 60,
    last: h(21, 15),
  },
  {
    key: "s7",
    company: "sued",
    prefix: "S",
    name: "S7 Flughafen",
    color: "#0091EA",
    type: "REGIONAL",
    numberBase: 2420,
    stops: ["Wien Mitte", "Flughafen Wien"],
    first: h(5, 2),
    every: 30,
    last: h(23, 32),
  },
  {
    key: "ic-mur",
    company: "sued",
    prefix: "IC",
    name: "IC Murtal",
    color: "#6A1B9A",
    type: "INTERCITY",
    numberBase: 530,
    stops: [
      "Graz Hauptbahnhof",
      "Bruck an der Mur",
      "Leoben Hauptbahnhof",
      "Knittelfeld",
      "Klagenfurt Hauptbahnhof",
    ],
    first: h(7, 45),
    every: 240,
    last: h(19, 45),
  },
  {
    key: "nj",
    company: "alpen",
    prefix: "NJ",
    name: "Nightjet",
    color: "#1A237E",
    type: "NIGHT",
    numberBase: 246,
    stops: [
      "Wien Hauptbahnhof",
      "St. Pölten Hauptbahnhof",
      "Linz Hauptbahnhof",
      "Salzburg Hauptbahnhof",
      "Wörgl Hauptbahnhof",
      "Innsbruck Hauptbahnhof",
      "Landeck-Zams",
      "Feldkirch",
      "Bregenz",
    ],
    first: h(21, 40),
    every: 24 * 60,
    last: h(21, 40),
  },
];

/** Durchschnittsgeschwindigkeit zwischen Halten (km/h) und Haltezeit (s) je Gattung. */
const SPEED: Record<TrainType, number> = {
  HIGH_SPEED: 115,
  INTERCITY: 95,
  REGIONAL: 70,
  NIGHT: 80,
};
const DWELL: Record<TrainType, number> = {
  HIGH_SPEED: 120,
  INTERCITY: 120,
  REGIONAL: 60,
  NIGHT: 300,
};

// ------------------------------------------------------------------ Geometrie

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function dist(a: Pt, b: Pt) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const lengthOf = (pts: Pt[]) =>
  pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

/** Gleisgraph aus OSM-Linien. Knoten = exakte Koordinaten (gemeinsame OSM-Knoten verbinden Wege). */
class TrackGraph {
  private index = new Map<string, number>();
  readonly pts: Pt[] = [];
  readonly adj: number[][] = [];
  readonly w: number[][] = [];
  private grid = new Map<string, number[]>();

  private node(p: Pt) {
    const k = p[0].toFixed(7) + "," + p[1].toFixed(7);
    let i = this.index.get(k);
    if (i === undefined) {
      i = this.pts.length;
      this.index.set(k, i);
      this.pts.push(p);
      this.adj.push([]);
      this.w.push([]);
      const g = this.cell(p);
      const list = this.grid.get(g);
      if (list) list.push(i);
      else this.grid.set(g, [i]);
    }
    return i;
  }

  private cell(p: Pt, dx = 0, dy = 0) {
    return `${Math.floor(p[0] * 50) + dx}:${Math.floor(p[1] * 50) + dy}`;
  }

  addLine(coords: Pt[]) {
    for (let i = 1; i < coords.length; i++) {
      const a = this.node(coords[i - 1]);
      const b = this.node(coords[i]);
      if (a === b) continue;
      const d = dist(coords[i - 1], coords[i]);
      this.adj[a].push(b);
      this.w[a].push(d);
      this.adj[b].push(a);
      this.w[b].push(d);
    }
  }

  /**
   * Lücken schließen: Offene Gleisenden (Grad 1) mit dem nächsten fremden Knoten im Umkreis
   * von 300 m verbinden. OSM-Wege teilen sich nicht immer einen exakten Knoten (z. B. an
   * Kachelgrenzen des Imports), sonst entstehen riesige Umwege.
   */
  bridgeGaps(maxMeters = 300) {
    let added = 0;
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      if (this.adj[i].length !== 1) continue;
      const p = this.pts[i];
      let best = -1;
      let bestD = maxMeters;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of this.grid.get(this.cell(p, dx, dy)) ?? []) {
            if (j === i || this.adj[i].includes(j)) continue;
            const d = dist(p, this.pts[j]);
            if (d < bestD) {
              bestD = d;
              best = j;
            }
          }
      if (best >= 0) {
        this.adj[i].push(best);
        this.w[i].push(bestD);
        this.adj[best].push(i);
        this.w[best].push(bestD);
        added++;
      }
    }
    return added;
  }

  /** Zusammenhangskomponente je Knoten; Bahnhöfe nur an große Netzteile anbinden (keine Abstellgleise). */
  private comp: Int32Array | null = null;
  private compSize: number[] = [];
  components() {
    const n = this.pts.length;
    const comp = new Int32Array(n).fill(-1);
    let c = 0;
    for (let s = 0; s < n; s++) {
      if (comp[s] !== -1) continue;
      let size = 0;
      const stack = [s];
      comp[s] = c;
      while (stack.length) {
        const i = stack.pop()!;
        size++;
        for (const j of this.adj[i])
          if (comp[j] === -1) {
            comp[j] = c;
            stack.push(j);
          }
      }
      this.compSize.push(size);
      c++;
    }
    this.comp = comp;
    return this.compSize.filter((x) => x > 1000).length;
  }

  /** Nächster Knoten im Umkreis von ca. 2 km, bevorzugt im großen Netz. */
  nearest(p: Pt): { i: number; d: number } | null {
    let best: { i: number; d: number } | null = null;
    let bestBig: { i: number; d: number } | null = null;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of this.grid.get(this.cell(p, dx, dy)) ?? []) {
          const d = dist(p, this.pts[i]);
          if (!best || d < best.d) best = { i, d };
          const big = !this.comp || this.compSize[this.comp[i]] > 1000;
          if (big && (!bestBig || d < bestBig.d)) bestBig = { i, d };
        }
    return bestBig ?? best;
  }

  /** Alle Knoten im großen Netz im Umkreis (Meter). */
  within(p: Pt, meters: number): { i: number; d: number }[] {
    const out: { i: number; d: number }[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of this.grid.get(this.cell(p, dx, dy)) ?? []) {
          const d = dist(p, this.pts[i]);
          if (d <= meters && (!this.comp || this.compSize[this.comp[i]] > 1000))
            out.push({ i, d });
        }
    return out;
  }

  /**
   * A* von mehreren Startknoten (z. B. alle Gleise am Bahnhof) zu irgendeinem Zielknoten.
   * Startkosten = Abstand zum Bahnhof, damit bevorzugt nahe Gleise gewählt werden.
   */
  pathMulti(
    from: { i: number; d: number }[],
    to: { i: number; d: number }[],
    goal: Pt,
  ): number[] | null {
    const targets = new Map(to.map((t) => [t.i, t.d]));
    const n = this.pts.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1,
            r = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };
    for (const s of from) {
      g[s.i] = s.d;
      push(s.d + dist(this.pts[s.i], goal), s.i);
    }
    let end = -1;
    while (heap.length) {
      const [, i] = pop();
      if (closed[i]) continue;
      if (targets.has(i)) {
        end = i;
        break;
      }
      closed[i] = 1;
      const adj = this.adj[i],
        w = this.w[i];
      for (let k = 0; k < adj.length; k++) {
        const j = adj[k];
        const ng = g[i] + w[k];
        if (ng < g[j]) {
          g[j] = ng;
          prev[j] = i;
          push(ng + dist(this.pts[j], goal), j);
        }
      }
    }
    if (end < 0) return null;
    const out: number[] = [];
    for (let i = end; i !== -1; i = prev[i]) out.unshift(i);
    return out;
  }
}

// ------------------------------------------------------------------ Seed

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeding is disabled in production");
  await connect();

  console.log("Lade Gleisnetz …");
  const graph = new TrackGraph();
  const rows: { g: { coordinates: Pt[] } }[] = await source.query(
    "SELECT ST_AsGeoJSON(geometry)::json AS g FROM tracks WHERE country='AT' AND usage IN ('main','branch','unknown','industrial') AND source <> 'DEMO_ROUTE'",
  );
  for (const r of rows) graph.addLine(r.g.coordinates);
  const bridged = graph.bridgeGaps();
  const big = graph.components();
  console.log(
    `  ${rows.length} Abschnitte, ${graph.pts.length} Knoten, ${bridged} Lücken geschlossen, ${big} große Netzteile`,
  );
  if (!rows.length)
    throw new Error("Keine OSM-Strecken für AT – zuerst im Setup importieren.");

  // Bahnhöfe über Namen (OSM-Station bevorzugt, dann eine mit Kürzel)
  const stationCache = new Map<string, { id: string; at: Pt } | null>();
  async function station(name: string) {
    if (!stationCache.has(name)) {
      const [s] = await source.query(
        "SELECT id, ST_X(coordinates) AS lng, ST_Y(coordinates) AS lat FROM stations WHERE country='AT' AND name=$1 ORDER BY source_id IS NULL, code IS NULL LIMIT 1",
        [name],
      );
      stationCache.set(
        name,
        s ? { id: s.id, at: [Number(s.lng), Number(s.lat)] } : null,
      );
    }
    return stationCache.get(name)!;
  }

  // Abschnitt zwischen zwei Bahnhöfen: Weg im Gleisnetz, Endpunkte exakt auf den Bahnhöfen
  const sections = new Map<
    string,
    { id: string; meters: number; routed: boolean }
  >();
  async function section(
    a: { id: string; at: Pt },
    b: { id: string; at: Pt },
    label: string,
  ) {
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = x.id + ":" + y.id;
    const cached = sections.get(key);
    if (cached) return cached;
    let coords: Pt[] = [x.at, y.at];
    let routed = false;
    let starts = graph.within(x.at, 800),
      ends = graph.within(y.at, 800);
    const na = graph.nearest(x.at),
      nb = graph.nearest(y.at);
    if (!starts.length && na && na.d < 1500) starts = [na];
    if (!ends.length && nb && nb.d < 1500) ends = [nb];
    if (starts.length && ends.length) {
      const p = graph.pathMulti(starts, ends, y.at);
      if (p) {
        const candidate: Pt[] = [x.at, ...p.map((i) => graph.pts[i]), y.at];
        // Plausibilität: echter Weg höchstens 2,5× so lang wie die Luftlinie (+5 km)
        const direct = dist(x.at, y.at);
        if (lengthOf(candidate) <= direct * 2.5 + 5000) {
          coords = candidate;
          routed = true;
        } else
          console.warn(
            `  ! Umweg für ${label}: ${Math.round(lengthOf(candidate) / 1000)} km statt ~${Math.round(direct / 1000)} km`,
          );
      }
    }
    if (!routed)
      console.warn(
        `  ! Kein plausibler Weg im Gleisnetz für ${label} – Luftlinie`,
      );
    const id = seedId("net-section:" + key);
    await source.query(
      `INSERT INTO tracks(id,country,name,usage,electrified,geometry,source,attribution)
       VALUES($1,'AT',$2,'main',true,ST_SetSRID(ST_GeomFromGeoJSON($3),4326),'DEMO_ROUTE','© OpenStreetMap contributors — ODbL (Demo-Route)')
       ON CONFLICT(id) DO UPDATE SET geometry=EXCLUDED.geometry, name=EXCLUDED.name, updated_at=now(), version=tracks.version+1`,
      [
        id,
        "Demo-Route " + label,
        JSON.stringify({ type: "LineString", coordinates: coords }),
      ],
    );
    const s = { id, meters: lengthOf(coords), routed };
    sections.set(key, s);
    return s;
  }

  const today = localToday("Europe/Vienna");
  let schedules = 0;

  for (const [key, c] of Object.entries(COMPANIES))
    await source.query(
      "INSERT INTO companies(id,name,code,country) VALUES($1,$2,$3,'AT') ON CONFLICT DO NOTHING",
      [seedId(key === "alpen" ? "company" : "company:" + key), c.name, c.code],
    );
  const companyId = (key: string) =>
    seedId(key === "alpen" ? "company" : "company:" + key);

  for (const line of LINES) {
    const found = [];
    for (const name of line.stops) {
      const s = await station(name);
      if (s) found.push({ name, ...s });
      else console.warn(`  ! Bahnhof fehlt: ${name} (${line.name})`);
    }
    if (found.length < 2) {
      console.warn(`  ! Linie übersprungen: ${line.name}`);
      continue;
    }
    console.log(`${line.name}: ${found.map((s) => s.name).join(" – ")}`);

    // Abschnitte und Fahrzeiten (Minuten, auf ganze Minuten gerundet)
    const legs = [];
    for (let i = 1; i < found.length; i++)
      legs.push(
        await section(
          found[i - 1],
          found[i],
          `${found[i - 1].name} – ${found[i].name}`,
        ),
      );
    const runMin = legs.map((l) =>
      Math.max(2, Math.round((l.meters / 1000 / SPEED[line.type]) * 60)),
    );

    const lineId = seedId("net-line:" + line.key);
    await source.query(
      "INSERT INTO lines(id,company_id,name,code,color) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color",
      [
        lineId,
        companyId(line.company),
        line.name,
        line.key.toUpperCase().slice(0, 12),
        line.color,
      ],
    );

    for (const dir of [0, 1]) {
      const stops = dir ? [...found].reverse() : found;
      const runs = dir ? [...runMin].reverse() : runMin;
      const legIds = dir ? [...legs].reverse() : legs;
      const routeId = seedId(`net-route:${line.key}:${dir}`);
      const last = stops[stops.length - 1];
      await source.query(
        "INSERT INTO routes(id,line_id,name,direction) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
        [routeId, lineId, `${line.name} → ${last.name}`, last.name],
      );
      for (let i = 0; i < stops.length; i++)
        await source.query(
          "INSERT INTO route_stops(id,route_id,station_id,sequence) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
          [seedId(`net-stop:${line.key}:${dir}:${i}`), routeId, stops[i].id, i],
        );
      await source.query("DELETE FROM route_tracks WHERE route_id=$1", [
        routeId,
      ]);
      for (let i = 0; i < legIds.length; i++)
        await source.query(
          "INSERT INTO route_tracks(route_id,track_id,sequence) VALUES($1,$2,$3)",
          [routeId, legIds[i].id, i],
        );

      // Ein Zug je Abfahrt, Gegenrichtung 7 Minuten versetzt
      let k = 0;
      for (
        let start = line.first + (dir ? 7 : 0);
        start <= line.last + (dir ? 7 : 0);
        start += line.every, k++
      ) {
        const number = line.numberBase + k * 2 + dir;
        const trainId = seedId(`net-train:${line.key}:${number}`);
        await source.query(
          "INSERT INTO trains(id,company_id,train_number,name,type) VALUES($1,$2,$3,NULL,$4) ON CONFLICT DO NOTHING",
          [
            trainId,
            companyId(line.company),
            `${line.prefix} ${number}`,
            line.type,
          ],
        );
        let t = start * 60;
        const sched = stops.map((_, i) => {
          if (i > 0) t += runs[i - 1] * 60;
          const arrival = i === 0 ? null : t;
          if (i > 0 && i < stops.length - 1) t += DWELL[line.type];
          return {
            routeStopId: seedId(`net-stop:${line.key}:${dir}:${i}`),
            arrivalOffsetSeconds: arrival,
            departureOffsetSeconds: i === stops.length - 1 ? null : t,
          };
        });
        await source.query(
          `INSERT INTO schedules(id,route_id,train_id,time_zone,valid_from,valid_until,weekdays,stops,dst_disambiguation)
           VALUES($1,$2,$3,'Europe/Vienna',$4,$5,ARRAY[1,2,3,4,5,6,7],$6,'EARLIER')
           ON CONFLICT(id) DO UPDATE SET stops=EXCLUDED.stops, valid_until=EXCLUDED.valid_until`,
          [
            seedId(`net-schedule:${line.key}:${number}`),
            routeId,
            trainId,
            today,
            addDays(today, 365),
            JSON.stringify(sched),
          ],
        );
        schedules++;
      }
    }
  }

  const routed = [...sections.values()].filter((s) => s.routed).length;
  console.log(
    `Abschnitte: ${sections.size} (${routed} im Gleisnetz, ${sections.size - routed} Luftlinie), Fahrpläne: ${schedules}`,
  );
  console.log("Erzeuge Fahrten für 14 Tage …");
  const db = new Database();
  await new SchedulesService(db, new RailService(db)).generate();
  console.log("Fertig.");
}

if (require.main === module)
  main()
    .then(() => source.destroy())
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
