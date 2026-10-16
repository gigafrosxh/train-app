// In-Memory-Backend für die Entwicklung ohne NestJS. Bildet docs/api-contract.md nach.
// Zustand wird im localStorage gehalten, damit Worker-Änderungen einen Reload überleben.

import { Subject } from 'rxjs';
import { addDays, DEFAULT_TIME_ZONE, localDate, zonedToUtc } from '../i18n/format.service';
import {
  AdminUser,
  BoardEntry,
  Company,
  Connection,
  Country,
  Dashboard,
  DelayReason,
  Disruption,
  ImportJob,
  Line,
  LngLat,
  MapTrain,
  NextTrip,
  RailwayCollection,
  Route,
  Schedule,
  NearbyStation,
  Station,
  StationDetail,
  StationRef,
  TicketSummary,
  Track,
  Train,
  TripAlert,
  TripDetail,
  TripStatus,
  TripStop,
  TripSummary,
  WorkerAssignment,
} from '../models/api.models';
import { readStorage, writeStorage } from '../util/storage';
import { COMPANIES, LINES, STATIONS, TRACKS } from './data/austria';
import { along, RailGraph } from './geo';

export class MockError {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly fieldErrors?: { field: string; code: string; message: string }[],
    readonly details?: Record<string, unknown>,
  ) {}
}

/** Zugangsdaten nur für den Mock-Modus (siehe frontend/README.md). */
export const DEMO_PASSWORD = 'demo1234';
export const DEMO_ACCOUNTS = [
  { email: 'user@demo.at', role: 'USER' as const },
  { email: 'worker@demo.at', role: 'WORKER' as const },
  { email: 'admin@demo.at', role: 'ADMIN' as const },
];

type MockUser = AdminUser & { password: string };

interface StopOverride {
  version: number;
  expectedArrival?: string | null;
  expectedDeparture?: string | null;
  expectedPlatform?: string | null;
  cancelled?: boolean;
  reasonCode?: DelayReason | null;
  reasonText?: string | null;
}

interface TripOverride {
  version: number;
  delaySeconds?: number;
  delayFrom?: string;
  reasonCode?: DelayReason | null;
  reasonText?: string | null;
  cancelled?: boolean;
  stops: Record<string, StopOverride>;
}

interface SpecialTrip {
  id: string;
  routeId: string;
  trainId: string;
  serviceDate: string;
  stops: { routeStopId: string; scheduledArrival: string | null; scheduledDeparture: string | null }[];
}

type StoredTicket = TicketSummary & { ownerId: string };

interface State {
  stations: Station[];
  companies: Company[];
  trains: Train[];
  lines: Line[];
  routes: Route[];
  tracks: Track[];
  schedules: Schedule[];
  users: MockUser[];
  tickets: StoredTicket[];
  recent: { userId: string; tripId: string; at: string }[];
  assignments: WorkerAssignment[];
  overrides: Record<string, TripOverride>;
  special: SpecialTrip[];
  activeCountry: string;
  countries: Country[];
  imports: ImportJob[];
  disruptions: Disruption[];
  /** Lieblingsbahnhöfe je Benutzer (IDs in Anzeigereihenfolge) */
  favorites: Record<string, string[]>;
  seq: number;
}

/**
 * Gleiche Normalisierung wie station_key() im Backend: Umlaute (ü → ue), Akzente, ß, Abkürzungen
 * (Hbf, Bf, St.) und Satzzeichen. „raw“ ohne Abkürzungen, damit „St“ beim Tippen „Stadlau“ findet.
 */
export function stationKey(t: string, expand = true): string {
  let k = t
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase();
  if (expand) k = k.replace(/hbf\b/g, 'hauptbahnhof').replace(/bf\b/g, 'bahnhof').replace(/\bst\.?(\s|$)/g, 'sankt$1');
  return k.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Wie pg_trgm word_similarity (vereinfacht): Anteil der Eingabe-Trigramme im am besten passenden Wort. */
function wordSimilarity(q: string, key: string): number {
  const tri = (w: string) => {
    const p = `  ${w} `;
    const out = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const a = tri(q);
  let best = 0;
  for (const w of key.split(' ')) {
    const b = tri(w);
    const common = [...a].filter((x) => b.has(x)).length;
    best = Math.max(best, common / a.size);
  }
  return best;
}

interface SkStop {
  id: string;
  routeStopId: string;
  sequence: number;
  station: StationRef;
  at: LngLat;
  schArr: string | null;
  schDep: string | null;
  platform: string;
}

interface Skeleton {
  id: string;
  routeId: string;
  train: Train;
  line: Line;
  company: Company;
  serviceDate: string;
  stops: SkStop[];
  firstDep: number;
  lastArr: number;
}

const STORAGE_KEY = 'gleis.mock.v3';
const TZ = DEFAULT_TIME_ZONE;
const GENERATION_DAYS = 14;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);
const ref = (s: Station): StationRef => ({ id: s.id, name: s.name, code: s.code, timeZone: s.timeZone });

export class MockDb {
  private s: State;
  private graph!: RailGraph;
  private readonly skeletons = new Map<string, Skeleton[]>();
  private readonly dayBase = new Map<string, number>();

  /** Fahrten, die sich geändert haben (für Socket-Events). */
  readonly tripChanged$ = new Subject<string>();
  readonly scheduleChanged$ = new Subject<{ scheduleId: string; affected: string[] }>();

  constructor() {
    const raw = readStorage(STORAGE_KEY);
    let state: State | null = null;
    try {
      state = raw ? (JSON.parse(raw) as State) : null;
    } catch {
      state = null;
    }
    this.s = state ?? this.seed();
    // Neue und ältere gespeicherte Stände um Störungen/Favoriten ergänzen
    if (!state?.disruptions) this.s.disruptions = this.seedDisruptions();
    this.s.favorites ??= {};
    this.rebuildGraph();
    if (!state) this.save();
  }

  reset() {
    this.s = this.seed();
    this.s.disruptions = this.seedDisruptions();
    this.skeletons.clear();
    this.rebuildGraph();
    this.save();
  }

  private save() {
    writeStorage(STORAGE_KEY, JSON.stringify(this.s));
  }

  private id(prefix: string) {
    this.s.seq += 1;
    return `${prefix}-${Date.now().toString(36)}${this.s.seq.toString(36)}`;
  }

  private rebuildGraph() {
    this.graph = new RailGraph(this.s.tracks.map((t) => t.geometry.coordinates as LngLat[]));
  }

  // ------------------------------------------------------------------ Seed

  private seed(): State {
    const stations: Station[] = STATIONS.map((st) => ({
      id: st.id,
      name: st.name,
      code: st.code,
      country: 'AT',
      coordinates: st.at,
      timeZone: TZ,
      version: 1,
    }));
    const byId = new Map(stations.map((st) => [st.id, st]));
    const tracks: Track[] = TRACKS.map((t) => ({
      id: t.id,
      country: 'AT',
      name: t.name,
      usage: t.usage,
      electrified: t.electrified,
      geometry: {
        type: 'LineString',
        coordinates: t.points.map((p) => (typeof p === 'string' ? byId.get(p)!.coordinates : p)),
      },
      version: 1,
    }));
    const companies: Company[] = COMPANIES.map((c) => ({ ...c, country: 'AT', version: 1 }));
    const lines: Line[] = [];
    const routes: Route[] = [];
    const trains: Train[] = [];
    const schedules: Schedule[] = [];

    for (const l of LINES) {
      lines.push({ id: l.id, companyId: l.companyId, name: l.name, code: l.code, color: l.color, version: 1 });
      const total = l.minutes[l.minutes.length - 1];
      const dirs = [
        { suffix: 'a', stops: l.stops, minutes: l.minutes },
        { suffix: 'b', stops: [...l.stops].reverse(), minutes: [...l.minutes].reverse().map((m) => total - m) },
      ];
      dirs.forEach((dir, d) => {
        const routeId = `ro-${l.id.slice(3)}-${dir.suffix}`;
        const last = byId.get(dir.stops[dir.stops.length - 1])!;
        routes.push({
          id: routeId,
          lineId: l.id,
          name: `${l.name} → ${last.name}`,
          direction: last.name,
          stops: dir.stops.map((sid, i) => ({ id: `${routeId}-s${i + 1}`, sequence: i + 1, station: ref(byId.get(sid)!) })),
          trackIds: [],
          version: 1,
        });
        let k = 0;
        for (let start = l.first + (d === 1 ? 7 : 0); start <= l.last + (d === 1 ? 7 : 0); start += l.every, k++) {
          const number = l.numberBase + k * 2 + d;
          const trainId = `tn-${l.id.slice(3)}-${number}`;
          trains.push({
            id: trainId,
            companyId: l.companyId,
            trainNumber: `${l.code} ${number}`,
            name: null,
            type: l.trainType,
            active: true,
            version: 1,
          });
          const n = dir.stops.length;
          schedules.push({
            id: `sc-${l.id.slice(3)}-${number}`,
            routeId,
            trainId,
            timeZone: TZ,
            validFrom: '2026-01-01',
            validUntil: '2027-12-31',
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            stops: dir.stops.map((_, i) => {
              const arr = (start + dir.minutes[i]) * 60;
              return {
                routeStopId: `${routeId}-s${i + 1}`,
                arrivalOffsetSeconds: i === 0 ? null : arr,
                departureOffsetSeconds: i === n - 1 ? null : i === 0 ? arr : arr + 120,
              };
            }),
            exceptions: [],
            version: 1,
          });
        }
      });
    }

    const now = new Date().toISOString();
    const users: MockUser[] = [
      this.makeUser('us-user', 'user@demo.at', 'Lena Huber', 'USER', now),
      this.makeUser('us-worker', 'worker@demo.at', 'Markus Gruber', 'WORKER', now),
      this.makeUser('us-admin', 'admin@demo.at', 'Sabine Leitner', 'ADMIN', now),
    ];

    const westbahnTrains = trains.filter((t) => t.id.startsWith('tn-rj-west')).slice(0, 6);
    const assignments: WorkerAssignment[] = [
      {
        id: 'wa-1', workerId: 'us-worker', workerName: 'Markus Gruber', scope: 'COMPANY', trainId: null,
        trainNumber: null, companyId: 'co-westbahn', companyName: 'WESTbahn', validFrom: null, validUntil: null, version: 1,
      },
      ...westbahnTrains.map<WorkerAssignment>((t, i) => ({
        id: `wa-t${i}`, workerId: 'us-worker', workerName: 'Markus Gruber', scope: 'TRAIN', trainId: t.id,
        trainNumber: t.trainNumber, companyId: 'co-oebb', companyName: 'ÖBB Personenverkehr',
        validFrom: null, validUntil: null, version: 1,
      })),
    ];

    const countries: Country[] = [
      { code: 'AT', names: { de: 'Österreich', en: 'Austria' }, enabled: true, dataStatus: 'READY' },
      { code: 'DE', names: { de: 'Deutschland', en: 'Germany' }, enabled: true, dataStatus: 'NOT_IMPORTED' },
      { code: 'CH', names: { de: 'Schweiz', en: 'Switzerland' }, enabled: true, dataStatus: 'NOT_IMPORTED' },
      { code: 'CZ', names: { de: 'Tschechien', en: 'Czechia' }, enabled: true, dataStatus: 'NOT_IMPORTED' },
      { code: 'HU', names: { de: 'Ungarn', en: 'Hungary' }, enabled: false, dataStatus: 'NOT_IMPORTED' },
    ];

    const state: State = {
      stations, companies, trains, lines, routes, tracks, schedules, users,
      tickets: [], recent: [], assignments, overrides: {}, special: [],
      activeCountry: 'AT', countries, imports: [], disruptions: [], favorites: {}, seq: 0,
    };
    this.s = state;
    this.skeletons.clear();
    this.rebuildGraph();
    state.tickets = this.seedTickets();
    return state;
  }

  private seedDisruptions(): Disruption[] {
    const from = new Date(Date.now() - 3600000).toISOString();
    const until = new Date(Date.now() + 7 * 86400000).toISOString();
    const station = this.s.stations.find((x) => /Salzburg/.test(x.name));
    return [
      {
        id: 'di-demo-1',
        country: 'AT',
        severity: 'WARNING',
        reasonCode: 'CONSTRUCTION',
        title: 'Bauarbeiten Salzburg Hbf',
        text: 'Einzelne Züge fahren von anderen Bahnsteigen ab. Bitte Anzeigen beachten.',
        validFrom: from,
        validUntil: until,
        stationIds: station ? [station.id] : [],
        lineIds: [],
        createdAt: from,
        version: 1,
      },
    ];
  }

  private makeUser(id: string, email: string, name: string, role: MockUser['role'], now: string): MockUser {
    return {
      id, email, displayName: name, role, mustChangePassword: false,
      preferences: { language: 'de', theme: 'system', fontScale: 'md' },
      status: 'ACTIVE', createdAt: now, lastLoginAt: null, version: 1, password: DEMO_PASSWORD,
    };
  }

  private seedTickets(): StoredTicket[] {
    const now = Date.now();
    const pick = (lineId: string, after: number, fromId: string, toId: string) => {
      for (let d = 0; d < 3; d++) {
        const date = addDays(localDate(iso(after)), d);
        const sk = this.skeletonsFor(date).find((t) => {
          if (t.line.id !== lineId) return false;
          const a = t.stops.findIndex((s) => s.station.id === fromId);
          const b = t.stops.findIndex((s) => s.station.id === toId);
          return a >= 0 && b > a && ms(t.stops[a].schDep) > after;
        });
        if (sk) return sk;
      }
      return null;
    };
    const tickets: StoredTicket[] = [];
    const make = (
      sk: Skeleton | null, fromId: string, toId: string, extra: Partial<StoredTicket>,
    ) => {
      if (!sk) return;
      const a = sk.stops.find((s) => s.station.id === fromId)!;
      const b = sk.stops.find((s) => s.station.id === toId)!;
      tickets.push({
        id: `tk-${tickets.length + 1}`, ownerId: 'us-user', reference: `AT-${(hash(sk.id) % 900000) + 100000}`,
        companyId: sk.company.id, companyName: sk.company.name, tripId: sk.id,
        origin: a.station, destination: b.station,
        validFrom: iso(ms(a.schDep) - 3 * 3600000), validUntil: iso(ms(b.schArr) + 3 * 3600000),
        status: 'ACTIVE', verified: true, qrPayload: `GLEIS:${sk.id}:${a.id}:${b.id}`,
        productName: 'Standard-Ticket', travelClass: 2, boardingStopId: a.id, alightingStopId: b.id,
        ...extra,
      });
    };
    make(pick('li-rj-west', now + 50 * 60000, 'st-wien-hbf', 'st-linz'), 'st-wien-hbf', 'st-linz', {});
    make(pick('li-koralm', now + 26 * 3600000, 'st-graz', 'st-klagenfurt'), 'st-graz', 'st-klagenfurt', {
      verified: false, qrPayload: null, productName: 'Sparschiene', travelClass: 2, reference: 'SS-48211',
    });
    make(pick('li-s7', now - 30 * 3600000, 'st-wien-mitte', 'st-flughafen'), 'st-wien-mitte', 'st-flughafen', {
      productName: 'Einzelfahrt', travelClass: 2,
    });
    tickets.push({
      id: 'tk-klima', ownerId: 'us-user', reference: 'KT-2026-77341', companyId: null, companyName: null, tripId: null,
      origin: null, destination: null, validFrom: '2026-03-01T00:00:00.000Z', validUntil: '2027-02-28T22:59:59.000Z',
      status: 'ACTIVE', verified: true, qrPayload: 'GLEIS:KLIMATICKET:KT-2026-77341', productName: 'KlimaTicket Ö',
      travelClass: 2, boardingStopId: null, alightingStopId: null,
    });
    return tickets;
  }

  // ------------------------------------------------------------- Fahrten

  private base(date: string): number {
    let b = this.dayBase.get(date);
    if (b === undefined) {
      b = Date.parse(zonedToUtc(date, 12 * 3600, TZ)) - 12 * 3600000;
      this.dayBase.set(date, b);
    }
    return b;
  }

  private offsetToIso(date: string, seconds: number | null): string | null {
    if (seconds === null) return null;
    const days = Math.floor(seconds / 86400);
    return iso(this.base(addDays(date, days)) + (seconds - days * 86400) * 1000);
  }

  private runsOn(sc: Schedule, date: string): boolean {
    if (date < sc.validFrom || date > sc.validUntil) return false;
    const ex = sc.exceptions.find((e) => e.date === date);
    if (ex) return ex.runs;
    const wd = new Date(date + 'T12:00:00Z').getUTCDay() || 7;
    return sc.weekdays.includes(wd);
  }

  private skeletonsFor(date: string): Skeleton[] {
    const cached = this.skeletons.get(date);
    if (cached) return cached;
    const out: Skeleton[] = [];
    for (const sc of this.s.schedules) {
      if (!this.runsOn(sc, date)) continue;
      const sk = this.buildFromSchedule(sc, date);
      if (sk) out.push(sk);
    }
    for (const sp of this.s.special.filter((t) => t.serviceDate === date)) {
      const sk = this.buildSpecial(sp);
      if (sk) out.push(sk);
    }
    out.sort((a, b) => a.firstDep - b.firstDep);
    this.skeletons.set(date, out);
    return out;
  }

  private context(routeId: string, trainId: string) {
    const route = this.s.routes.find((r) => r.id === routeId);
    const train = this.s.trains.find((t) => t.id === trainId);
    const line = route && this.s.lines.find((l) => l.id === route.lineId);
    const company = line && this.s.companies.find((c) => c.id === line.companyId);
    if (!route || !train || !line || !company) return null;
    return { route, train, line, company };
  }

  private finish(id: string, ctx: NonNullable<ReturnType<MockDb['context']>>, date: string, stops: SkStop[]): Skeleton | null {
    if (stops.length < 2) return null;
    return {
      id, routeId: ctx.route.id, train: ctx.train, line: ctx.line, company: ctx.company, serviceDate: date, stops,
      firstDep: ms(stops[0].schDep ?? stops[0].schArr),
      lastArr: ms(stops[stops.length - 1].schArr ?? stops[stops.length - 1].schDep),
    };
  }

  private skStop(tripId: string, rs: Route['stops'][number], arr: string | null, dep: string | null): SkStop | null {
    const st = this.s.stations.find((x) => x.id === rs.station.id);
    if (!st) return null;
    return {
      id: `${tripId}.${rs.id}`, routeStopId: rs.id, sequence: rs.sequence, station: ref(st), at: st.coordinates,
      schArr: arr, schDep: dep, platform: String((hash(st.id + tripId.slice(0, -11)) % 8) + 1),
    };
  }

  private buildFromSchedule(sc: Schedule, date: string): Skeleton | null {
    const ctx = this.context(sc.routeId, sc.trainId);
    if (!ctx) return null;
    const id = `tp.${sc.id}.${date}`;
    const stops: SkStop[] = [];
    for (const rs of [...ctx.route.stops].sort((a, b) => a.sequence - b.sequence)) {
      const ss = sc.stops.find((x) => x.routeStopId === rs.id);
      if (!ss) continue;
      const s = this.skStop(id, rs, this.offsetToIso(date, ss.arrivalOffsetSeconds), this.offsetToIso(date, ss.departureOffsetSeconds));
      if (s) stops.push(s);
    }
    return this.finish(id, ctx, date, stops);
  }

  private buildSpecial(sp: SpecialTrip): Skeleton | null {
    const ctx = this.context(sp.routeId, sp.trainId);
    if (!ctx) return null;
    const stops: SkStop[] = [];
    for (const x of sp.stops) {
      const rs = ctx.route.stops.find((r) => r.id === x.routeStopId);
      if (!rs) continue;
      const s = this.skStop(sp.id, rs, x.scheduledArrival, x.scheduledDeparture);
      if (s) stops.push(s);
    }
    return this.finish(sp.id, ctx, sp.serviceDate, stops);
  }

  private skeleton(tripId: string): Skeleton | null {
    const sp = this.s.special.find((t) => t.id === tripId);
    if (sp) return this.skeletonsFor(sp.serviceDate).find((t) => t.id === tripId) ?? null;
    const m = /^tp\.(.+)\.(\d{4}-\d{2}-\d{2})$/.exec(tripId);
    if (!m) return null;
    return this.skeletonsFor(m[2]).find((t) => t.id === tripId) ?? null;
  }

  private invalidate() {
    this.skeletons.clear();
  }

  /** Simulierte Verspätung je Fahrt – deterministisch, damit Reloads gleich aussehen. */
  private simulated(sk: Skeleton, now: number): { delay: number; fromIndex: number; reason: DelayReason | null; cancelled: boolean } {
    const h = hash(sk.id);
    const none = { delay: 0, fromIndex: 0, reason: null, cancelled: false };
    if (sk.firstDep > now + 2 * 3600000) return none;
    const r = h % 100;
    const fromIndex = (h >> 8) % Math.max(1, sk.stops.length - 1);
    const reasons: DelayReason[] = ['TECHNICAL', 'WEATHER', 'STAFF', 'CONSTRUCTION', 'OTHER'];
    const reason = reasons[(h >> 4) % reasons.length];
    if (r < 60) return none;
    if (r < 84) return { delay: (2 + ((h >> 12) % 7)) * 60, fromIndex, reason: null, cancelled: false };
    if (r < 96) return { delay: (10 + ((h >> 12) % 16)) * 60, fromIndex, reason, cancelled: false };
    if (r < 98) return { delay: -60, fromIndex, reason: null, cancelled: false };
    return { ...none, cancelled: true, reason };
  }

  private live(sk: Skeleton, now = Date.now()): TripDetail {
    const ov = this.s.overrides[sk.id];
    const sim = this.simulated(sk, now);
    const cancelled = ov?.cancelled ?? sim.cancelled;
    const delayFrom = ov?.delayFrom ? ms(ov.delayFrom) : Infinity;

    const stops: TripStop[] = sk.stops.map((st, i) => {
      const so = ov?.stops[st.id];
      const schedTime = ms(st.schDep ?? st.schArr);
      let delay = i >= sim.fromIndex ? sim.delay : 0;
      if (ov?.delaySeconds !== undefined && schedTime + delay * 1000 >= delayFrom) delay = ov.delaySeconds;
      if (i === 0 && delay < 0) delay = 0;

      const expArr = so?.expectedArrival !== undefined ? so.expectedArrival : st.schArr ? iso(ms(st.schArr) + delay * 1000) : null;
      const expDep = so?.expectedDeparture !== undefined ? so.expectedDeparture : st.schDep ? iso(ms(st.schDep) + Math.max(delay, 0) * 1000) : null;
      const stopCancelled = cancelled || (so?.cancelled ?? false);
      const reasonCode = so?.reasonCode ?? (delay >= 300 || stopCancelled ? (ov?.reasonCode ?? sim.reason) : null);
      return {
        id: st.id,
        sequence: st.sequence,
        station: st.station,
        scheduledArrival: st.schArr,
        scheduledDeparture: st.schDep,
        expectedArrival: stopCancelled ? null : expArr,
        expectedDeparture: stopCancelled ? null : expDep,
        actualArrival: !stopCancelled && expArr && ms(expArr) <= now ? expArr : null,
        actualDeparture: !stopCancelled && expDep && ms(expDep) <= now ? expDep : null,
        scheduledPlatform: st.platform,
        expectedPlatform: so?.expectedPlatform !== undefined ? so.expectedPlatform : st.platform,
        arrivalDelaySeconds: st.schArr && expArr && !stopCancelled ? (ms(expArr) - ms(st.schArr)) / 1000 : null,
        departureDelaySeconds: st.schDep && expDep && !stopCancelled ? (ms(expDep) - ms(st.schDep)) / 1000 : null,
        cancelled: stopCancelled,
        reasonCode,
        reasonText: so?.reasonText ?? (reasonCode ? (ov?.reasonText ?? null) : null),
        version: so?.version ?? 1,
      };
    });

    const first = stops[0];
    const last = stops[stops.length - 1];
    const expectedDeparture = first.expectedDeparture;
    const expectedArrival = last.expectedArrival;
    let status: TripStatus = 'SCHEDULED';
    if (cancelled) status = 'CANCELLED';
    else if (expectedArrival && ms(expectedArrival) <= now) status = 'COMPLETED';
    else if (expectedDeparture && ms(expectedDeparture) <= now) status = 'RUNNING';

    // Abweichung am nächsten bedienten Halt
    let delaySeconds = 0;
    const next = stops.find((s) => !s.cancelled && ms(s.expectedDeparture ?? s.expectedArrival) > now) ?? last;
    delaySeconds = next.departureDelaySeconds ?? next.arrivalDelaySeconds ?? 0;

    return {
      id: sk.id,
      trainId: sk.train.id,
      trainNumber: sk.train.trainNumber,
      lineId: sk.line.id,
      lineName: sk.line.name,
      routeId: sk.routeId,
      companyId: sk.company.id,
      lineColor: sk.line.color,
      companyName: sk.company.name,
      serviceDate: sk.serviceDate,
      origin: first.station,
      destination: last.station,
      scheduledDeparture: first.scheduledDeparture ?? first.scheduledArrival!,
      scheduledArrival: last.scheduledArrival ?? last.scheduledDeparture!,
      expectedDeparture,
      expectedArrival,
      delaySeconds,
      status,
      version: ov?.version ?? 1,
      stops,
    };
  }

  private summary(d: TripDetail): TripSummary {
    const { stops: _stops, ...rest } = d;
    return rest;
  }

  private windowDates(from: number, to: number): string[] {
    const dates: string[] = [];
    let d = addDays(localDate(iso(from), TZ), -1);
    const end = localDate(iso(to), TZ);
    while (d <= end) {
      dates.push(d);
      d = addDays(d, 1);
    }
    return dates;
  }

  private skeletonsBetween(from: number, to: number): Skeleton[] {
    return this.windowDates(from, to).flatMap((d) => this.skeletonsFor(d));
  }

  searchWindow() {
    const today = localDate(new Date().toISOString(), TZ);
    return {
      from: zonedToUtc(today, 0, TZ),
      to: zonedToUtc(addDays(today, GENERATION_DAYS), 0, TZ),
    };
  }

  private checkWindow(from: number, field: string) {
    const w = this.searchWindow();
    if (from < ms(w.from) - 86400000 || from >= ms(w.to)) {
      throw new MockError(400, 'SEARCH_DATE_OUT_OF_RANGE', 'Date outside the search window', [
        { field, code: 'OUT_OF_RANGE', message: 'Outside search window' },
      ]);
    }
  }

  trip(id: string): TripDetail {
    const sk = this.skeleton(id);
    if (!sk) throw new MockError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    return this.live(sk);
  }

  trips(q: { from?: string; to?: string; lineId?: string; trainId?: string; status?: string; allowedTrainIds?: Set<string> | null; q?: string }): TripSummary[] {
    const from = q.from ? ms(q.from) : Date.now();
    const to = q.to ? ms(q.to) : from + 24 * 3600000;
    this.checkWindow(from, 'from');
    if (to - from > 7 * 86400000) throw new MockError(400, 'VALIDATION_FAILED', 'Window too large');
    const now = Date.now();
    const needle = q.q?.toLowerCase().trim();
    return this.skeletonsBetween(from, to)
      .filter((t) => t.firstDep >= from && t.firstDep < to)
      .filter((t) => !q.lineId || t.line.id === q.lineId)
      .filter((t) => !q.trainId || t.train.id === q.trainId)
      .filter((t) => !q.allowedTrainIds || q.allowedTrainIds.has(t.train.id))
      .filter((t) => !needle || t.train.trainNumber.toLowerCase().includes(needle) || t.line.name.toLowerCase().includes(needle))
      .map((t) => this.summary(this.live(t, now)))
      .filter((t) => !q.status || t.status === q.status)
      .sort((a, b) => ms(a.scheduledDeparture) - ms(b.scheduledDeparture) || a.id.localeCompare(b.id));
  }

  /** Läuft gerade oder beginnt bald: für den Worker-Plan nützlicher als nur Abfahrt im Fenster. */
  operationsTrips(q: { from?: string; to?: string; allowedTrainIds: Set<string> | null; q?: string; status?: string }): TripSummary[] {
    const from = q.from ? ms(q.from) : Date.now() - 3 * 3600000;
    const to = q.to ? ms(q.to) : Date.now() + 12 * 3600000;
    return this.trips({ ...q, from: iso(from), to: iso(to) });
  }

  private importanceCache: Map<string, number> | null = null;
  /** Anzahl Linien je Bahnhof (für die Auswahl der „über“-Halte). */
  private importance(): Map<string, number> {
    if (!this.importanceCache) {
      const lines = new Map<string, Set<string>>();
      for (const r of this.s.routes)
        for (const st of r.stops) lines.set(st.station.id, (lines.get(st.station.id) ?? new Set()).add(r.lineId));
      this.importanceCache = new Map([...lines].map(([k, v]) => [k, v.size]));
    }
    return this.importanceCache;
  }

  private via(stops: TripStop[]): StationRef[] {
    const c = stops.filter((s) => !s.cancelled);
    if (c.length <= 3) return c.map((s) => s.station);
    const imp = this.importance();
    return c
      .map((s, i) => ({ s, i, n: imp.get(s.station.id) ?? 0 }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .slice(0, 3)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.s.station);
  }

  private board(sk: Skeleton, detail: TripDetail, idx: number, kind: 'dep' | 'arr'): BoardEntry {
    const st = detail.stops[idx];
    const sched = kind === 'dep' ? st.scheduledDeparture : st.scheduledArrival;
    const around = kind === 'dep' ? detail.stops.slice(idx + 1, -1) : detail.stops.slice(1, Math.max(idx, 1));
    return {
      tripId: detail.id,
      stopId: st.id,
      station: st.station,
      lineName: detail.lineName,
      trainNumber: detail.trainNumber,
      lineColor: detail.lineColor,
      companyName: detail.companyName,
      reasonCode: st.reasonCode,
      origin: detail.origin,
      destination: detail.destination,
      scheduledTime: sched!,
      expectedTime: kind === 'dep' ? st.expectedDeparture : st.expectedArrival,
      actualTime: kind === 'dep' ? st.actualDeparture : st.actualArrival,
      delaySeconds: kind === 'dep' ? st.departureDelaySeconds : st.arrivalDelaySeconds,
      scheduledPlatform: st.scheduledPlatform,
      expectedPlatform: st.expectedPlatform,
      platformChanged: !!st.expectedPlatform && !!st.scheduledPlatform && st.expectedPlatform !== st.scheduledPlatform,
      via: this.via(around),
      cancelled: st.cancelled,
    };
  }

  boardFor(stationId: string, kind: 'dep' | 'arr', fromIso?: string, toIso?: string): BoardEntry[] {
    if (!this.s.stations.some((s) => s.id === stationId)) throw new MockError(404, 'STATION_NOT_FOUND', 'Station not found');
    const from = fromIso ? ms(fromIso) : Date.now() - 5 * 60000;
    const to = toIso ? ms(toIso) : from + 24 * 3600000;
    this.checkWindow(from, 'from');
    const out: BoardEntry[] = [];
    const now = Date.now();
    for (const sk of this.skeletonsBetween(from - 12 * 3600000, to)) {
      const idx = sk.stops.findIndex((s) => s.station.id === stationId);
      if (idx < 0) continue;
      const st = sk.stops[idx];
      const t = kind === 'dep' ? st.schDep : st.schArr;
      if (!t) continue;
      const detail = this.live(sk, now);
      const exp = kind === 'dep' ? detail.stops[idx].expectedDeparture : detail.stops[idx].expectedArrival;
      const relevant = Math.max(ms(t), exp ? ms(exp) : 0);
      if (relevant < from || ms(t) >= to) continue;
      out.push(this.board(sk, detail, idx, kind));
    }
    return out.sort((a, b) => ms(a.scheduledTime) - ms(b.scheduledTime) || a.stopId.localeCompare(b.stopId));
  }

  connections(fromId: string, toId: string, departAfterIso: string | undefined, maxTransfers: number): Connection[] {
    if (fromId === toId) throw new MockError(400, 'VALIDATION_FAILED', 'Same station', [
      { field: 'toStationId', code: 'SAME_STATION', message: 'Same station' },
    ]);
    const after = departAfterIso ? ms(departAfterIso) : Date.now();
    this.checkWindow(after, 'departAfter');
    const until = after + 24 * 3600000;
    const now = Date.now();
    const pool = this.skeletonsBetween(after, until).filter((t) => t.lastArr > after);
    const details = new Map<string, TripDetail>();
    const det = (sk: Skeleton) => {
      let d = details.get(sk.id);
      if (!d) {
        d = this.live(sk, now);
        details.set(sk.id, d);
      }
      return d;
    };
    const timeOf = (s: TripStop, kind: 'dep' | 'arr') =>
      ms(kind === 'dep' ? (s.expectedDeparture ?? s.scheduledDeparture) : (s.expectedArrival ?? s.scheduledArrival));

    const results: Connection[] = [];
    const leg = (sk: Skeleton, d: TripDetail, i: number, j: number) => ({
      tripId: d.id, lineName: d.lineName, lineColor: d.lineColor, trainNumber: d.trainNumber,
      from: this.board(sk, d, i, 'dep'), to: this.board(sk, d, j, 'arr'),
    });
    const build = (raw: ReturnType<typeof leg>[]): Connection => {
      // Umstiegszeit nach Echtzeit; knapp + verspäteter Zubringer = gefährdet (wie Backend)
      const legs = raw.map((l, i) => {
        if (!i) return { ...l, transferSeconds: null, transferAtRisk: false };
        const prev = raw[i - 1].to;
        const t = Math.round((ms(l.from.expectedTime ?? l.from.scheduledTime) - ms(prev.expectedTime ?? prev.scheduledTime)) / 1000);
        return { ...l, transferSeconds: t, transferAtRisk: t < 300 || (t < 600 && (prev.delaySeconds ?? 0) > 0) };
      });
      const dep = legs[0].from.expectedTime ?? legs[0].from.scheduledTime;
      const last = legs[legs.length - 1].to;
      const arr = last.expectedTime ?? last.scheduledTime;
      return {
        id: legs.map((l) => `${l.tripId}:${l.from.stopId}:${l.to.stopId}`).join('|'),
        departure: dep, arrival: arr, durationSeconds: (ms(arr) - ms(dep)) / 1000, transfers: legs.length - 1, legs,
      };
    };

    for (const sk of pool) {
      const i = sk.stops.findIndex((s) => s.station.id === fromId);
      if (i < 0 || !sk.stops[i].schDep) continue;
      const d = det(sk);
      if (d.stops[i].cancelled || timeOf(d.stops[i], 'dep') < after || timeOf(d.stops[i], 'dep') > until) continue;
      const j = sk.stops.findIndex((s, k) => k > i && s.station.id === toId);
      if (j > 0 && !d.stops[j].cancelled) {
        results.push(build([leg(sk, d, i, j)]));
        continue;
      }
      if (maxTransfers < 1) continue;
      // ein Umstieg
      let best: Connection | null = null;
      for (let k = i + 1; k < sk.stops.length; k++) {
        if (d.stops[k].cancelled) continue;
        const x = sk.stops[k].station.id;
        const arrX = timeOf(d.stops[k], 'arr');
        for (const sk2 of pool) {
          if (sk2.id === sk.id || sk2.line.id === sk.line.id) continue;
          const m = sk2.stops.findIndex((s) => s.station.id === x);
          if (m < 0 || !sk2.stops[m].schDep) continue;
          const n = sk2.stops.findIndex((s, q) => q > m && s.station.id === toId);
          if (n < 0) continue;
          const d2 = det(sk2);
          const depX = timeOf(d2.stops[m], 'dep');
          if (d2.stops[m].cancelled || d2.stops[n].cancelled || depX < arrX + 300000 || depX > arrX + 3 * 3600000) continue;
          const c = build([leg(sk, d, i, k), leg(sk2, d2, m, n)]);
          if (!best || ms(c.arrival) < ms(best.arrival)) best = c;
        }
      }
      if (best) results.push(best);
    }
    // dominierte Verbindungen entfernen
    const filtered = results.filter(
      (c) => !results.some((o) => o !== c && ms(o.departure) >= ms(c.departure) && ms(o.arrival) < ms(c.arrival)),
    );
    const seen = new Set<string>();
    return filtered
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      .sort((a, b) => ms(a.departure) - ms(b.departure) || ms(a.arrival) - ms(b.arrival));
  }

  // --------------------------------------------------------------- Karte

  railways(country: string): RailwayCollection {
    const c = this.s.countries.find((x) => x.code === country);
    return {
      type: 'FeatureCollection',
      features: this.s.tracks
        .filter((t) => t.country === country)
        .map((t) => ({
          type: 'Feature',
          geometry: t.geometry,
          properties: { id: t.id, usage: t.usage, ...(t.electrified === null ? {} : { electrified: t.electrified }), ...(t.name ? { name: t.name } : {}) },
        })),
      metadata: {
        country,
        source: 'Demo-Daten (vereinfacht)',
        attribution: '© OpenStreetMap-Mitwirkende (vereinfacht)',
        updatedAt: new Date().toISOString(),
        dataStatus: c?.dataStatus ?? 'NOT_IMPORTED',
      },
    };
  }

  position(sk: Skeleton, d: TripDetail, now = Date.now()): MapTrain {
    const base: MapTrain = {
      tripId: d.id, positionVersion: Math.floor(now / 1000), lineName: d.lineName, trainNumber: d.trainNumber,
      coordinates: null, bearing: null, delaySeconds: d.delaySeconds, nextStopName: null,
      positionType: 'UNAVAILABLE', isStale: false, observedAt: null, calculatedAt: null, source: null, estimationMethod: null,
    };
    if (d.status !== 'RUNNING') return base;
    const stops = d.stops.filter((s) => !s.cancelled);
    const t = (v: string | null) => ms(v);
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i];
      const arr = t(s.expectedArrival ?? s.scheduledArrival);
      const dep = t(s.expectedDeparture ?? s.scheduledDeparture);
      const skStop = sk.stops.find((x) => x.id === s.id)!;
      const next = stops[i + 1];
      if ((Number.isNaN(arr) || now >= arr) && (Number.isNaN(dep) || now < dep)) {
        const nextAt = next ? sk.stops.find((x) => x.id === next.id)!.at : skStop.at;
        return this.estimated(base, skStop.at, next ? along(this.graph.path(skStop.at, nextAt), 0.001).bearing : 0, s.station.name, d, now);
      }
      if (next && now >= dep) {
        const nArr = t(next.expectedArrival ?? next.scheduledArrival);
        if (now < nArr) {
          const nextSk = sk.stops.find((x) => x.id === next.id)!;
          const f = (now - dep) / (nArr - dep);
          const p = along(this.graph.path(skStop.at, nextSk.at), f);
          return this.estimated(base, p.at, p.bearing, next.station.name, d, now);
        }
      }
    }
    return base;
  }

  private estimated(base: MapTrain, at: LngLat, bearing: number, nextStop: string, d: TripDetail, now: number): MapTrain {
    return {
      ...base,
      coordinates: [Number(at[0].toFixed(6)), Number(at[1].toFixed(6))],
      bearing: Math.round(bearing),
      nextStopName: nextStop,
      positionType: 'ESTIMATED',
      calculatedAt: iso(now),
      source: 'schedule',
      estimationMethod: d.delaySeconds !== 0 || this.s.overrides[d.id] ? 'SCHEDULE_WITH_UPDATES' : 'SCHEDULE',
    };
  }

  mapTrains(country: string, bbox: number[] | null): MapTrain[] {
    const now = Date.now();
    const out: MapTrain[] = [];
    for (const sk of this.skeletonsBetween(now - 12 * 3600000, now)) {
      if (sk.firstDep > now + 60000 || sk.lastArr < now - 3 * 3600000) continue;
      if (!this.s.stations.some((st) => st.id === sk.stops[0].station.id && st.country === country)) continue;
      const d = this.live(sk, now);
      if (d.status !== 'RUNNING') continue;
      const p = this.position(sk, d, now);
      if (!p.coordinates) continue;
      if (bbox && (p.coordinates[0] < bbox[0] || p.coordinates[1] < bbox[1] || p.coordinates[0] > bbox[2] || p.coordinates[1] > bbox[3])) continue;
      out.push(p);
    }
    return out;
  }

  tripPosition(tripId: string): MapTrain {
    const sk = this.skeleton(tripId);
    if (!sk) throw new MockError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    return this.position(sk, this.live(sk));
  }

  tripShape(tripId: string) {
    const sk = this.skeleton(tripId);
    if (!sk) throw new MockError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    const coords: LngLat[] = [];
    for (let i = 1; i < sk.stops.length; i++) {
      const part = this.graph.path(sk.stops[i - 1].at, sk.stops[i].at);
      coords.push(...(i === 1 ? part : part.slice(1)));
    }
    return { type: 'Feature' as const, properties: { tripId }, geometry: { type: 'LineString' as const, coordinates: coords } };
  }

  // ------------------------------------------------------- Konto & Home

  findUserByEmail(email: string) {
    return this.s.users.find((u) => u.email.toLowerCase() === email.toLowerCase().trim()) ?? null;
  }

  user(id: string) {
    return this.s.users.find((u) => u.id === id) ?? null;
  }

  publicUser(u: MockUser) {
    const { password: _p, status: _s, createdAt: _c, lastLoginAt: _l, version: _v, ...rest } = u;
    return rest;
  }

  adminUser(u: MockUser): AdminUser {
    const { password: _p, ...rest } = u;
    return rest;
  }

  touchLogin(u: MockUser) {
    u.lastLoginAt = new Date().toISOString();
    this.save();
  }

  register(email: string, password: string, displayName: string) {
    const fe: { field: string; code: string; message: string }[] = [];
    if (!/^\S+@\S+\.\S+$/.test(email ?? '')) fe.push({ field: 'email', code: 'INVALID', message: 'Invalid email' });
    if ((password ?? '').length < 8) fe.push({ field: 'password', code: 'TOO_SHORT', message: 'Min. 8 characters' });
    if (!displayName?.trim()) fe.push({ field: 'displayName', code: 'REQUIRED', message: 'Required' });
    if (fe.length) throw new MockError(400, 'VALIDATION_FAILED', 'Validation failed', fe);
    if (this.findUserByEmail(email)) throw new MockError(409, 'EMAIL_TAKEN', 'Email already registered');
    const u = this.makeUser(this.id('us'), email.trim(), displayName.trim(), 'USER', new Date().toISOString());
    u.password = password;
    this.s.users.push(u);
    this.save();
    return this.publicUser(u);
  }

  updateMe(u: MockUser, body: { displayName?: string; preferences?: Partial<MockUser['preferences']> }) {
    if (body.displayName !== undefined) {
      if (!body.displayName.trim()) throw new MockError(400, 'VALIDATION_FAILED', 'Name required', [{ field: 'displayName', code: 'REQUIRED', message: 'Required' }]);
      u.displayName = body.displayName.trim();
    }
    if (body.preferences) u.preferences = { ...u.preferences, ...body.preferences };
    u.version++;
    this.save();
    return this.publicUser(u);
  }

  changePassword(u: MockUser, current: string, next: string) {
    if (u.password !== current) throw new MockError(400, 'AUTH_WRONG_PASSWORD', 'Current password is wrong', [{ field: 'currentPassword', code: 'WRONG', message: 'Wrong password' }]);
    if ((next ?? '').length < 8) throw new MockError(400, 'VALIDATION_FAILED', 'Too short', [{ field: 'newPassword', code: 'TOO_SHORT', message: 'Min. 8 characters' }]);
    u.password = next;
    u.mustChangePassword = false;
    this.save();
  }

  private ticketStatus(t: StoredTicket): StoredTicket {
    if (t.status === 'CANCELLED') return t;
    return { ...t, status: ms(t.validUntil) < Date.now() ? 'EXPIRED' : 'ACTIVE' };
  }

  private stripTicket(t: StoredTicket): TicketSummary {
    const { ownerId: _o, ...rest } = this.ticketStatus(t);
    return rest;
  }

  tickets(userId: string): TicketSummary[] {
    return this.s.tickets
      .filter((t) => t.ownerId === userId)
      .map((t) => this.stripTicket(t))
      .sort((a, b) => ms(a.validFrom) - ms(b.validFrom) || a.id.localeCompare(b.id));
  }

  ticket(userId: string, id: string): TicketSummary {
    const t = this.s.tickets.find((x) => x.id === id && x.ownerId === userId);
    if (!t) throw new MockError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    return this.stripTicket(t);
  }

  createTicket(userId: string, body: Record<string, unknown>): TicketSummary {
    const fe: { field: string; code: string; message: string }[] = [];
    const str = (k: string) => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : null);
    if (!str('reference')) fe.push({ field: 'reference', code: 'REQUIRED', message: 'Required' });
    if (!str('validFrom')) fe.push({ field: 'validFrom', code: 'REQUIRED', message: 'Required' });
    if (!str('validUntil')) fe.push({ field: 'validUntil', code: 'REQUIRED', message: 'Required' });
    if (str('validFrom') && str('validUntil') && ms(str('validUntil')) <= ms(str('validFrom')))
      fe.push({ field: 'validUntil', code: 'BEFORE_START', message: 'Must be after validFrom' });
    let origin: StationRef | null = null;
    let destination: StationRef | null = null;
    let boardingStopId: string | null = null;
    let alightingStopId: string | null = null;
    let companyId = str('companyId');
    const tripId = str('tripId');
    if (tripId) {
      const sk = this.skeleton(tripId);
      if (!sk) fe.push({ field: 'tripId', code: 'NOT_FOUND', message: 'Trip not found' });
      else {
        const bi = str('boardingStopId') ? sk.stops.findIndex((s) => s.id === str('boardingStopId')) : 0;
        const ai = str('alightingStopId') ? sk.stops.findIndex((s) => s.id === str('alightingStopId')) : sk.stops.length - 1;
        if (bi < 0) fe.push({ field: 'boardingStopId', code: 'NOT_IN_TRIP', message: 'Stop not in trip' });
        if (ai < 0) fe.push({ field: 'alightingStopId', code: 'NOT_IN_TRIP', message: 'Stop not in trip' });
        if (bi >= 0 && ai >= 0 && ai <= bi) fe.push({ field: 'alightingStopId', code: 'ORDER', message: 'Must be after boarding' });
        if (bi >= 0 && ai > bi) {
          boardingStopId = sk.stops[bi].id;
          alightingStopId = sk.stops[ai].id;
          origin = sk.stops[bi].station;
          destination = sk.stops[ai].station;
          companyId = companyId ?? sk.company.id;
        }
      }
    } else {
      const o = str('originStationId') && this.s.stations.find((s) => s.id === str('originStationId'));
      const d = str('destinationStationId') && this.s.stations.find((s) => s.id === str('destinationStationId'));
      origin = o ? ref(o) : null;
      destination = d ? ref(d) : null;
    }
    if (fe.length) throw new MockError(400, 'VALIDATION_FAILED', 'Validation failed', fe);
    const company = companyId ? this.s.companies.find((c) => c.id === companyId) : null;
    const tc = body['travelClass'];
    const t: StoredTicket = {
      id: this.id('tk'), ownerId: userId, reference: str('reference')!, companyId: company?.id ?? null,
      companyName: company?.name ?? null, tripId, origin, destination,
      validFrom: new Date(str('validFrom')!).toISOString(), validUntil: new Date(str('validUntil')!).toISOString(),
      status: 'ACTIVE', verified: false, qrPayload: str('qrPayload'), productName: str('productName'),
      travelClass: tc === 1 || tc === 2 ? tc : null, boardingStopId, alightingStopId,
    };
    this.s.tickets.push(t);
    this.save();
    return this.stripTicket(t);
  }

  deleteTicket(userId: string, id: string) {
    const i = this.s.tickets.findIndex((x) => x.id === id && x.ownerId === userId);
    if (i < 0) throw new MockError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
    this.s.tickets.splice(i, 1);
    this.save();
  }

  markViewed(userId: string, tripId: string) {
    if (!this.skeleton(tripId)) throw new MockError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    this.s.recent = this.s.recent.filter((r) => !(r.userId === userId && r.tripId === tripId));
    this.s.recent.unshift({ userId, tripId, at: new Date().toISOString() });
    this.s.recent = this.s.recent.slice(0, 200);
    this.save();
  }

  dashboard(userId: string): Dashboard {
    const now = Date.now();
    const tickets = this.tickets(userId).filter((t) => t.status === 'ACTIVE');
    const activeTickets = tickets.slice(0, 10);

    let nextTrip: NextTrip | null = null;
    const alerts: TripAlert[] = [];
    for (const t of tickets) {
      if (!t.tripId) continue;
      const sk = this.skeleton(t.tripId);
      if (!sk) continue;
      const d = this.live(sk, now);
      const boarding = d.stops.find((s) => s.id === t.boardingStopId) ?? d.stops[0];
      const alighting = d.stops.find((s) => s.id === t.alightingStopId) ?? d.stops[d.stops.length - 1];
      const dep = ms(boarding.expectedDeparture ?? boarding.scheduledDeparture);
      const arr = ms(alighting.expectedArrival ?? alighting.scheduledArrival);
      if (arr > now && d.status !== 'CANCELLED' && (!nextTrip || dep < ms(nextTrip.boardingStop?.expectedDeparture ?? nextTrip.scheduledDeparture))) {
        nextTrip = { ...this.summary(d), ticketId: t.id, boardingStop: boarding, alightingStop: alighting };
      }
      if (arr < now || dep > now + 7 * 86400000) continue;
      if (d.status === 'CANCELLED') {
        alerts.push({ id: `al-${d.id}-c`, tripId: d.id, code: 'TRIP_CANCELLED', severity: 'WARNING', delaySeconds: null, reasonCode: boarding.reasonCode, reasonText: boarding.reasonText, createdAt: iso(now - 600000) });
      } else if ((boarding.departureDelaySeconds ?? 0) >= 300) {
        alerts.push({ id: `al-${d.id}-d`, tripId: d.id, code: 'TRIP_DELAYED', severity: (boarding.departureDelaySeconds ?? 0) >= 900 ? 'WARNING' : 'INFO', delaySeconds: boarding.departureDelaySeconds, reasonCode: boarding.reasonCode, reasonText: boarding.reasonText, createdAt: iso(now - 300000) });
      }
      if (boarding.expectedPlatform && boarding.expectedPlatform !== boarding.scheduledPlatform) {
        alerts.push({ id: `al-${d.id}-p`, tripId: d.id, code: 'PLATFORM_CHANGED', severity: 'INFO', delaySeconds: null, reasonCode: null, reasonText: null, createdAt: iso(now - 200000) });
      }
    }

    const recentTrips: TripSummary[] = [];
    for (const r of this.s.recent.filter((x) => x.userId === userId)) {
      const sk = this.skeleton(r.tripId);
      if (sk) recentTrips.push(this.summary(this.live(sk, now)));
      if (recentTrips.length >= 10) break;
    }
    return { nextTrip, recentTrips, activeTickets, alerts: alerts.slice(0, 20) };
  }

  // ------------------------------------------------------------- Worker

  allowedTrainIds(u: MockUser): Set<string> | null {
    if (u.role === 'ADMIN') return null;
    const now = new Date().toISOString();
    const ids = new Set<string>();
    for (const a of this.s.assignments.filter((x) => x.workerId === u.id)) {
      if ((a.validFrom && a.validFrom > now) || (a.validUntil && a.validUntil <= now)) continue;
      if (a.scope === 'TRAIN' && a.trainId) ids.add(a.trainId);
      if (a.scope === 'COMPANY') this.s.trains.filter((t) => t.companyId === a.companyId).forEach((t) => ids.add(t.id));
    }
    return ids;
  }

  assignmentsOf(userId: string) {
    return this.s.assignments.filter((a) => a.workerId === userId);
  }

  private checkTripAccess(u: MockUser, sk: Skeleton) {
    const allowed = this.allowedTrainIds(u);
    if (allowed && !allowed.has(sk.train.id)) throw new MockError(403, 'AUTH_FORBIDDEN', 'Not allowed for this train');
  }

  patchTrip(u: MockUser, tripId: string, body: Record<string, unknown>): TripDetail {
    const sk = this.skeleton(tripId);
    if (!sk) throw new MockError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    this.checkTripAccess(u, sk);
    const ov = this.s.overrides[tripId] ?? { version: 1, stops: {} };
    if (body['version'] !== ov.version) throw new MockError(409, 'TRIP_VERSION_CONFLICT', 'Trip was changed in the meantime');
    const keys = ['delaySeconds', 'reasonCode', 'reasonText', 'cancelled'].filter((k) => k in body);
    if (!keys.length) throw new MockError(400, 'VALIDATION_FAILED', 'No change');
    if ('delaySeconds' in body) {
      const v = Number(body['delaySeconds']);
      if (!Number.isFinite(v) || v < -3600 || v > 24 * 3600) throw new MockError(400, 'VALIDATION_FAILED', 'Invalid delay', [{ field: 'delaySeconds', code: 'RANGE', message: 'Out of range' }]);
      ov.delaySeconds = Math.round(v);
      ov.delayFrom = new Date().toISOString();
    }
    if ('reasonCode' in body) ov.reasonCode = body['reasonCode'] as DelayReason | null;
    if ('reasonText' in body) ov.reasonText = (body['reasonText'] as string | null) || null;
    if ('cancelled' in body) ov.cancelled = !!body['cancelled'];
    ov.version += 1;
    this.s.overrides[tripId] = ov;
    this.save();
    this.tripChanged$.next(tripId);
    return this.live(sk);
  }

  patchStop(u: MockUser, tripId: string, stopId: string, body: Record<string, unknown>): TripStop {
    const sk = this.skeleton(tripId);
    if (!sk) throw new MockError(404, 'TRIP_NOT_FOUND', 'Trip not found');
    this.checkTripAccess(u, sk);
    const st = sk.stops.find((s) => s.id === stopId);
    if (!st) throw new MockError(404, 'STOP_NOT_FOUND', 'Stop not found');
    const ov = this.s.overrides[tripId] ?? { version: 1, stops: {} };
    const so = ov.stops[stopId] ?? { version: 1 };
    if (body['version'] !== so.version) throw new MockError(409, 'TRIP_VERSION_CONFLICT', 'Stop was changed in the meantime');
    for (const k of ['expectedArrival', 'expectedDeparture', 'expectedPlatform', 'cancelled', 'reasonCode', 'reasonText'] as const) {
      if (k in body) (so as unknown as Record<string, unknown>)[k] = body[k];
    }
    const a = so.expectedArrival ?? null;
    const d = so.expectedDeparture ?? null;
    if (a && d && ms(d) < ms(a)) throw new MockError(400, 'VALIDATION_FAILED', 'Departure before arrival', [{ field: 'expectedDeparture', code: 'BEFORE_ARRIVAL', message: 'Departure before arrival' }]);
    if (body['propagate']) {
      if (!('expectedArrival' in body) && !('expectedDeparture' in body))
        throw new MockError(400, 'VALIDATION_FAILED', 'propagate needs a new expected time');
      // Verspätung dieses Halts auf alle folgenden übertragen
      const delay = d && st.schDep ? (ms(d) - ms(st.schDep)) / 1000 : a && st.schArr ? (ms(a) - ms(st.schArr)) / 1000 : 0;
      for (const next of sk.stops.filter((x) => x.sequence > st.sequence)) {
        const o = ov.stops[next.id] ?? { version: 1 };
        if (o.cancelled) continue;
        if (next.schArr) o.expectedArrival = iso(ms(next.schArr) + delay * 1000);
        if (next.schDep) o.expectedDeparture = iso(ms(next.schDep) + delay * 1000);
        o.version += 1;
        ov.stops[next.id] = o;
      }
    }
    so.version += 1;
    ov.stops[stopId] = so;
    ov.version += 1;
    this.s.overrides[tripId] = ov;
    this.save();
    this.tripChanged$.next(tripId);
    return this.live(sk).stops.find((s) => s.id === stopId)!;
  }

  // -------------------------------------------------------------- Admin

  settings() {
    return { activeCountry: this.s.activeCountry, tripGenerationDays: GENERATION_DAYS, searchWindow: this.searchWindow() };
  }

  countries() {
    return this.s.countries;
  }

  setActiveCountry(code: string) {
    const c = this.s.countries.find((x) => x.code === code);
    if (!c || !c.enabled) throw new MockError(400, 'COUNTRY_NOT_ENABLED', 'Country not available', [{ field: 'activeCountry', code: 'NOT_ENABLED', message: 'Not available' }]);
    this.s.activeCountry = code;
    this.save();
    return this.settings();
  }

  startImport(country: string, kind: ImportJob['kind']): ImportJob {
    const c = this.s.countries.find((x) => x.code === country);
    if (!c) throw new MockError(400, 'VALIDATION_FAILED', 'Unknown country');
    const running = this.s.imports.find(
      (j) => j.country === country && j.kind === kind && (j.status === 'QUEUED' || j.status === 'RUNNING') && this.progressJob(j).status !== 'DONE',
    );
    if (running) throw new MockError(409, 'IMPORT_ALREADY_RUNNING', 'Import already running', undefined, { jobId: running.id });
    const job: ImportJob = { id: this.id('im'), country, kind, status: 'QUEUED', progress: 0, startedAt: new Date().toISOString(), finishedAt: null, errorCode: null, errorMessage: null };
    this.s.imports.push(job);
    c.dataStatus = 'IMPORTING';
    this.save();
    return job;
  }

  /** Simulierter Fortschritt über ca. 8 Sekunden. */
  private progressJob(j: ImportJob): ImportJob {
    if (j.status === 'DONE' || j.status === 'FAILED') return j;
    const elapsed = Date.now() - ms(j.startedAt);
    if (elapsed < 1000) return { ...j, status: 'QUEUED', progress: null };
    if (elapsed < 8000) return { ...j, status: 'RUNNING', progress: Math.round(((elapsed - 1000) / 7000) * 100) };
    j.status = 'DONE';
    j.progress = 100;
    j.finishedAt = new Date().toISOString();
    const c = this.s.countries.find((x) => x.code === j.country);
    if (c) c.dataStatus = 'READY';
    this.save();
    return j;
  }

  importJob(id: string): ImportJob {
    const j = this.s.imports.find((x) => x.id === id);
    if (!j) throw new MockError(404, 'IMPORT_NOT_FOUND', 'Import not found');
    return this.progressJob(j);
  }

  private collection(resource: string): { list: { id: string; version: number }[]; prefix: string } {
    const map: Record<string, [unknown[], string]> = {
      companies: [this.s.companies, 'co'],
      stations: [this.s.stations, 'st'],
      trains: [this.s.trains, 'tn'],
      lines: [this.s.lines, 'li'],
      routes: [this.s.routes, 'ro'],
      tracks: [this.s.tracks, 'tr'],
      schedules: [this.s.schedules, 'sc'],
      users: [this.s.users, 'us'],
      'worker-assignments': [this.s.assignments, 'wa'],
      disruptions: [this.s.disruptions, 'di'],
    };
    const entry = map[resource];
    if (!entry) throw new MockError(404, 'NOT_FOUND', 'Unknown resource');
    return { list: entry[0] as { id: string; version: number }[], prefix: entry[1] };
  }

  adminList(resource: string, q: Record<string, string>): unknown[] {
    if (resource === 'trips') {
      const date = q['date'] || localDate(new Date().toISOString(), TZ);
      return this.skeletonsFor(date)
        .filter((t) => !q['lineId'] || t.line.id === q['lineId'])
        .filter((t) => !q['special'] || t.id.startsWith('sp-'))
        .map((t) => this.summary(this.live(t)));
    }
    const { list } = this.collection(resource);
    let items = list as unknown as Record<string, unknown>[];
    const needle = q['q']?.toLowerCase().trim();
    if (needle) {
      items = items.filter((x) =>
        ['name', 'code', 'trainNumber', 'email', 'displayName', 'workerName'].some((k) => String(x[k] ?? '').toLowerCase().includes(needle)),
      );
    }
    for (const f of ['companyId', 'lineId', 'routeId', 'trainId', 'workerId', 'role', 'status', 'country']) {
      if (q[f]) items = items.filter((x) => x[f] === q[f]);
    }
    if (resource === 'users') return (items as unknown as MockUser[]).map((u) => this.adminUser(u));
    return items;
  }

  adminGet(resource: string, id: string): unknown {
    if (resource === 'trips') return this.trip(id);
    const item = this.collection(resource).list.find((x) => x.id === id);
    if (!item) throw new MockError(404, 'NOT_FOUND', 'Not found');
    return resource === 'users' ? this.adminUser(item as MockUser) : item;
  }

  private required(body: Record<string, unknown>, fields: string[]) {
    const fe = fields
      .filter((f) => body[f] === undefined || body[f] === null || body[f] === '' || (Array.isArray(body[f]) && !(body[f] as unknown[]).length))
      .map((f) => ({ field: f, code: 'REQUIRED', message: 'Required' }));
    if (fe.length) throw new MockError(400, 'VALIDATION_FAILED', 'Validation failed', fe);
  }

  private resolveRouteStops(routeId: string, stops: { id?: string; stationId: string; sequence: number }[], existing?: Route) {
    return [...stops]
      .sort((a, b) => a.sequence - b.sequence)
      .map((s, i) => {
        const st = this.s.stations.find((x) => x.id === s.stationId);
        if (!st) throw new MockError(400, 'VALIDATION_FAILED', 'Unknown station', [{ field: `stops[${i}].stationId`, code: 'NOT_FOUND', message: 'Unknown station' }]);
        const keep = s.id && existing?.stops.some((x) => x.id === s.id);
        return { id: keep ? s.id! : `${routeId}-s${this.id('x')}`, sequence: i + 1, station: ref(st) };
      });
  }

  adminCreate(resource: string, body: Record<string, unknown>, actor: MockUser): unknown {
    const now = new Date().toISOString();
    switch (resource) {
      case 'companies': {
        this.required(body, ['name', 'code', 'country']);
        if (this.s.companies.some((c) => c.code === body['code'])) throw new MockError(409, 'CODE_TAKEN', 'Code exists', [{ field: 'code', code: 'TAKEN', message: 'Code exists' }]);
        const c: Company = { id: this.id('co'), name: String(body['name']), code: String(body['code']), country: String(body['country']), version: 1 };
        this.s.companies.push(c);
        return this.done(c);
      }
      case 'disruptions': {
        this.required(body, ['country', 'severity', 'title', 'validFrom']);
        if (body['validUntil'] && ms(String(body['validUntil'])) <= ms(String(body['validFrom'])))
          throw new MockError(400, 'VALIDATION_FAILED', 'The end must follow the start', [{ field: 'validUntil', code: 'BEFORE_START', message: 'End before start' }]);
        const x: Disruption = {
          id: this.id('di'),
          country: String(body['country']),
          severity: body['severity'] as Disruption['severity'],
          reasonCode: (body['reasonCode'] as DelayReason) ?? null,
          title: String(body['title']),
          text: String(body['text'] ?? ''),
          validFrom: String(body['validFrom']),
          validUntil: (body['validUntil'] as string) || null,
          stationIds: (body['stationIds'] as string[]) ?? [],
          lineIds: (body['lineIds'] as string[]) ?? [],
          createdAt: now,
          version: 1,
        };
        this.s.disruptions.push(x);
        this.disruptionChanged$.next(x.id);
        return this.done(x);
      }
      case 'stations': {
        this.required(body, ['name', 'country', 'coordinates', 'timeZone']);
        const st: Station = { id: this.id('st'), name: String(body['name']), code: (body['code'] as string) || null, country: String(body['country']), coordinates: body['coordinates'] as LngLat, timeZone: String(body['timeZone']), version: 1 };
        this.s.stations.push(st);
        return this.done(st);
      }
      case 'trains': {
        this.required(body, ['companyId', 'trainNumber', 'type']);
        const t: Train = { id: this.id('tn'), companyId: String(body['companyId']), trainNumber: String(body['trainNumber']), name: (body['name'] as string) || null, type: body['type'] as Train['type'], active: body['active'] !== false, version: 1 };
        this.s.trains.push(t);
        return this.done(t);
      }
      case 'lines': {
        this.required(body, ['companyId', 'name', 'code']);
        const l: Line = { id: this.id('li'), companyId: String(body['companyId']), name: String(body['name']), code: String(body['code']), color: (body['color'] as string) || null, version: 1 };
        this.s.lines.push(l);
        return this.done(l);
      }
      case 'routes': {
        this.required(body, ['lineId', 'name', 'direction', 'stops']);
        const id = this.id('ro');
        const stops = body['stops'] as { stationId: string; sequence: number }[];
        if (stops.length < 2) throw new MockError(400, 'VALIDATION_FAILED', 'At least two stops', [{ field: 'stops', code: 'TOO_FEW', message: 'At least two stops' }]);
        const r: Route = { id, lineId: String(body['lineId']), name: String(body['name']), direction: String(body['direction']), stops: this.resolveRouteStops(id, stops), trackIds: (body['trackIds'] as string[]) ?? [], version: 1 };
        this.s.routes.push(r);
        return this.done(r);
      }
      case 'tracks': {
        this.required(body, ['country', 'usage', 'geometry']);
        const t: Track = { id: this.id('tr'), country: String(body['country']), name: (body['name'] as string) || null, usage: body['usage'] as Track['usage'], electrified: (body['electrified'] as boolean | null) ?? null, geometry: body['geometry'] as Track['geometry'], version: 1 };
        this.s.tracks.push(t);
        this.rebuildGraph();
        return this.done(t);
      }
      case 'schedules': {
        this.required(body, ['routeId', 'trainId', 'timeZone', 'validFrom', 'validUntil', 'weekdays', 'stops']);
        const sc: Schedule = { id: this.id('sc'), routeId: String(body['routeId']), trainId: String(body['trainId']), timeZone: String(body['timeZone']), validFrom: String(body['validFrom']), validUntil: String(body['validUntil']), weekdays: body['weekdays'] as number[], stops: body['stops'] as Schedule['stops'], exceptions: (body['exceptions'] as Schedule['exceptions']) ?? [], version: 1 };
        this.validateSchedule(sc);
        this.s.schedules.push(sc);
        this.invalidate();
        return this.done(sc);
      }
      case 'trips': {
        this.required(body, ['routeId', 'trainId', 'serviceDate', 'stops']);
        const sp: SpecialTrip = { id: this.id('sp'), routeId: String(body['routeId']), trainId: String(body['trainId']), serviceDate: String(body['serviceDate']), stops: body['stops'] as SpecialTrip['stops'] };
        const route = this.s.routes.find((r) => r.id === sp.routeId);
        if (!route || route.stops.length !== sp.stops.length) throw new MockError(400, 'VALIDATION_FAILED', 'All route stops required', [{ field: 'stops', code: 'INCOMPLETE', message: 'All route stops required' }]);
        this.s.special.push(sp);
        this.invalidate();
        this.save();
        return this.trip(sp.id);
      }
      case 'users': {
        this.required(body, ['email', 'displayName', 'role', 'temporaryPassword']);
        if (this.findUserByEmail(String(body['email']))) throw new MockError(409, 'EMAIL_TAKEN', 'Email exists', [{ field: 'email', code: 'TAKEN', message: 'Email exists' }]);
        if (String(body['temporaryPassword']).length < 8) throw new MockError(400, 'VALIDATION_FAILED', 'Too short', [{ field: 'temporaryPassword', code: 'TOO_SHORT', message: 'Min. 8 characters' }]);
        const u = this.makeUser(this.id('us'), String(body['email']).trim(), String(body['displayName']).trim(), body['role'] as MockUser['role'], now);
        u.password = String(body['temporaryPassword']);
        u.mustChangePassword = true;
        this.s.users.push(u);
        this.save();
        return this.adminUser(u);
      }
      case 'worker-assignments': {
        this.required(body, ['workerId', 'scope']);
        const worker = this.s.users.find((u) => u.id === body['workerId'] && u.role === 'WORKER');
        if (!worker) throw new MockError(400, 'VALIDATION_FAILED', 'Not a worker', [{ field: 'workerId', code: 'NOT_WORKER', message: 'Not a worker' }]);
        const scope = body['scope'] as 'TRAIN' | 'COMPANY';
        const train = scope === 'TRAIN' ? this.s.trains.find((t) => t.id === body['trainId']) : null;
        const company = scope === 'COMPANY' ? this.s.companies.find((c) => c.id === body['companyId']) : train ? this.s.companies.find((c) => c.id === train.companyId) : null;
        if (scope === 'TRAIN' && !train) throw new MockError(400, 'VALIDATION_FAILED', 'Train required', [{ field: 'trainId', code: 'REQUIRED', message: 'Required' }]);
        if (scope === 'COMPANY' && !company) throw new MockError(400, 'VALIDATION_FAILED', 'Company required', [{ field: 'companyId', code: 'REQUIRED', message: 'Required' }]);
        const a: WorkerAssignment = {
          id: this.id('wa'), workerId: worker.id, workerName: worker.displayName, scope,
          trainId: train?.id ?? null, trainNumber: train?.trainNumber ?? null,
          companyId: company?.id ?? null, companyName: company?.name ?? null,
          validFrom: (body['validFrom'] as string) || null, validUntil: (body['validUntil'] as string) || null, version: 1,
        };
        this.s.assignments.push(a);
        return this.done(a);
      }
    }
    void actor;
    throw new MockError(404, 'NOT_FOUND', 'Unknown resource');
  }

  private validateSchedule(sc: Schedule) {
    const route = this.s.routes.find((r) => r.id === sc.routeId);
    if (!route) throw new MockError(400, 'VALIDATION_FAILED', 'Unknown route', [{ field: 'routeId', code: 'NOT_FOUND', message: 'Unknown route' }]);
    let last = -1;
    for (const [i, st] of sc.stops.entries()) {
      for (const v of [st.arrivalOffsetSeconds, st.departureOffsetSeconds]) {
        if (v === null) continue;
        if (v < last) throw new MockError(400, 'VALIDATION_FAILED', 'Times not in order', [{ field: `stops[${i}]`, code: 'ORDER', message: 'Times not in order' }]);
        last = v;
      }
    }
  }

  private done<T>(x: T): T {
    this.save();
    return x;
  }

  adminUpdate(resource: string, id: string, body: Record<string, unknown>, actor: MockUser): unknown {
    const { list } = this.collection(resource);
    const item = list.find((x) => x.id === id) as unknown as Record<string, unknown> & { id: string; version: number };
    if (!item) throw new MockError(404, 'NOT_FOUND', 'Not found');
    if (body['version'] !== item.version) throw new MockError(409, 'VERSION_CONFLICT', 'Changed in the meantime');
    const { version: _v, id: _id, ...changes } = body;

    if (resource === 'users') {
      const u = item as unknown as MockUser;
      if (u.id === actor.id && ((changes['role'] && changes['role'] !== 'ADMIN') || changes['status'] === 'LOCKED'))
        throw new MockError(409, 'USER_SELF_MODIFICATION', 'You cannot demote or lock yourself');
      const admins = this.s.users.filter((x) => x.role === 'ADMIN' && x.status === 'ACTIVE');
      if (u.role === 'ADMIN' && admins.length === 1 && ((changes['role'] && changes['role'] !== 'ADMIN') || changes['status'] === 'LOCKED'))
        throw new MockError(409, 'LAST_ADMIN_REQUIRED', 'At least one admin required');
      for (const k of ['role', 'status', 'displayName'] as const) if (changes[k] !== undefined) (u as unknown as Record<string, unknown>)[k] = changes[k];
      u.version++;
      this.save();
      return this.adminUser(u);
    }
    if (resource === 'worker-assignments') {
      for (const k of ['validFrom', 'validUntil']) if (k in changes) item[k] = changes[k] || null;
      item.version++;
      return this.done(item);
    }
    if (resource === 'routes') {
      const r = item as unknown as Route;
      if (changes['stops']) {
        const stops = changes['stops'] as { id?: string; stationId: string; sequence: number }[];
        if (stops.length < 2) throw new MockError(400, 'VALIDATION_FAILED', 'At least two stops', [{ field: 'stops', code: 'TOO_FEW', message: 'At least two stops' }]);
        const next = this.resolveRouteStops(r.id, stops, r);
        const removed = r.stops.filter((s) => !next.some((n) => n.id === s.id)).map((s) => s.id);
        if (removed.length && this.s.schedules.some((sc) => sc.routeId === r.id && sc.stops.some((x) => removed.includes(x.routeStopId))))
          throw new MockError(409, 'ROUTE_CHANGE_CONFLICT', 'Schedules still use these stops');
        r.stops = next;
        delete changes['stops'];
      }
      Object.assign(r, changes);
      r.version++;
      this.invalidate();
      return this.done(r);
    }
    Object.assign(item, changes);
    item.version++;
    if (resource === 'disruptions') this.disruptionChanged$.next(id);
    if (resource === 'tracks') this.rebuildGraph();
    if (resource === 'schedules') {
      this.validateSchedule(item as unknown as Schedule);
      this.invalidate();
      this.scheduleChanged$.next({ scheduleId: id, affected: [] });
    }
    if (['stations', 'trains', 'lines', 'companies'].includes(resource)) this.invalidate();
    return this.done(item);
  }

  adminDelete(resource: string, id: string, version: number, actor: MockUser) {
    if (resource === 'trips') {
      const i = this.s.special.findIndex((t) => t.id === id);
      if (i < 0) throw new MockError(409, 'RESOURCE_IN_USE', 'Regular trips cannot be deleted. Cancel them instead.');
      if (this.s.tickets.some((t) => t.tripId === id)) throw new MockError(409, 'RESOURCE_IN_USE', 'Tickets exist');
      this.s.special.splice(i, 1);
      this.invalidate();
      this.save();
      return;
    }
    const { list } = this.collection(resource);
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) throw new MockError(404, 'NOT_FOUND', 'Not found');
    if (list[idx].version !== version) throw new MockError(409, 'VERSION_CONFLICT', 'Changed in the meantime');
    const inUse =
      (resource === 'companies' && (this.s.lines.some((l) => l.companyId === id) || this.s.trains.some((t) => t.companyId === id))) ||
      (resource === 'stations' && this.s.routes.some((r) => r.stops.some((s) => s.station.id === id))) ||
      (resource === 'lines' && this.s.routes.some((r) => r.lineId === id)) ||
      (resource === 'routes' && this.s.schedules.some((s) => s.routeId === id)) ||
      (resource === 'trains' && this.s.schedules.some((s) => s.trainId === id)) ||
      (resource === 'users' && id === actor.id);
    if (inUse) throw new MockError(409, resource === 'users' ? 'USER_SELF_MODIFICATION' : 'RESOURCE_IN_USE', 'Resource in use');
    list.splice(idx, 1);
    if (resource === 'tracks') this.rebuildGraph();
    if (resource === 'schedules') this.invalidate();
    if (resource === 'disruptions') this.disruptionChanged$.next(id);
    this.save();
  }

  // ------------------------------------------------- Bahnhöfe, Störungen

  /** Suche wie im Backend: Namensanfang, Wortanfang, Teiltreffer/Kürzel/Zweitname, Tippfehler. */
  searchStations(q: string, country: string | null): Station[] {
    const list = this.s.stations.filter((x) => !country || x.country === country);
    const text = q.trim();
    if (!text) return list.slice().sort((a, b) => a.name.localeCompare(b.name));
    const key = stationKey(text);
    const raw = stationKey(text, false);
    const ranked = list
      .map((st) => {
        const k = stationKey(st.name);
        const has = (p: string) => k.includes(p);
        const rank =
          k.startsWith(key) || k.startsWith(raw) ? 0
          : has(' ' + key) || has(' ' + raw) || (st.code ?? '').toLowerCase() === text.toLowerCase() ? 1
          : has(key) || has(raw) || (st.aliases ?? []).some((a) => stationKey(a).includes(key)) ? 2
          : key.length >= 4 && wordSimilarity(key, k) >= 0.4 ? 3
          : null;
        return { st, rank, sim: wordSimilarity(key, k) };
      })
      .filter((x) => x.rank !== null) as { st: Station; rank: number; sim: number }[];
    return ranked.sort((a, b) => a.rank - b.rank || b.sim - a.sim || a.st.name.localeCompare(b.st.name)).map((x) => x.st);
  }

  stationDetail(id: string): StationDetail {
    const st = this.s.stations.find((x) => x.id === id);
    if (!st) throw new MockError(404, 'STATION_NOT_FOUND', 'Station not found');
    const lineIds = new Set(this.s.routes.filter((r) => r.stops.some((x) => x.station.id === id)).map((r) => r.lineId));
    const lines = this.s.lines
      .filter((l) => lineIds.has(l.id))
      .map((l) => ({ id: l.id, name: l.name, color: l.color }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ...st, lines };
  }

  nearby(lng: number, lat: number, size: number, country: string): NearbyStation[] {
    const rad = (d: number) => (d * Math.PI) / 180;
    const dist = (c: LngLat) => {
      const dLat = rad(c[1] - lat);
      const dLng = rad(c[0] - lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(c[1])) * Math.sin(dLng / 2) ** 2;
      return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
    };
    return this.s.stations
      .filter((x) => x.country === country)
      .map((x) => ({ ...x, distanceMeters: dist(x.coordinates) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, size);
  }

  favorites(userId: string): StationRef[] {
    return (this.s.favorites[userId] ?? [])
      .map((id) => this.s.stations.find((x) => x.id === id))
      .filter((x): x is Station => !!x)
      .map((x) => ({ id: x.id, name: x.name, code: x.code, timeZone: x.timeZone }));
  }

  setFavorites(userId: string, ids: unknown): StationRef[] {
    if (!Array.isArray(ids) || ids.length > 12) throw new MockError(400, 'VALIDATION_FAILED', 'At most 12 stations');
    if (new Set(ids).size !== ids.length) throw new MockError(400, 'VALIDATION_FAILED', 'Each station only once');
    if (ids.some((id) => !this.s.stations.some((x) => x.id === id)))
      throw new MockError(400, 'STATION_NOT_FOUND', 'Station not found', [{ field: 'stationIds', code: 'STATION_NOT_FOUND', message: 'Unknown station' }]);
    this.s.favorites[userId] = ids as string[];
    this.save();
    return this.favorites(userId);
  }

  readonly disruptionChanged$ = new Subject<string>();

  disruptions(q: { country: string; stationId?: string; lineId?: string; activeAt?: string }): Disruption[] {
    const at = q.activeAt ? ms(q.activeAt) : Date.now();
    const order = { SEVERE: 0, WARNING: 1, INFO: 2 };
    const general = (x: Disruption) => !x.stationIds.length && !x.lineIds.length;
    return this.s.disruptions
      .filter((x) => x.country === q.country && ms(x.validFrom) <= at && (!x.validUntil || ms(x.validUntil) > at))
      .filter((x) => !q.stationId || x.stationIds.includes(q.stationId) || general(x))
      .filter((x) => !q.lineId || x.lineIds.includes(q.lineId) || general(x))
      .sort((a, b) => order[a.severity] - order[b.severity] || ms(b.validFrom) - ms(a.validFrom));
  }

  /** Für Socket-Events: aktuelle Fahrtdaten. */
  tripDetailSafe(id: string): TripDetail | null {
    const sk = this.skeleton(id);
    return sk ? this.live(sk) : null;
  }
}
