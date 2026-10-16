import {
  HttpErrorResponse,
  HttpEvent,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Observable, Subject, delay, dematerialize, materialize, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { readStorage, writeStorage } from '../util/storage';
import { Ack, RealtimeTransport } from '../realtime/realtime.service';
import { MockDb, MockError } from './mock-db';

/** Eine gemeinsame Instanz für Interceptor und Socket-Mock. */
let db: MockDb | null = null;
export function mockDb(): MockDb {
  db ??= new MockDb();
  return db;
}

const ACCESS_TTL = 15 * 60;

/** Globale, monotone Revision des Kartenstands (Snapshot und Ereignisse). */
let mapRevision = 1;
const snapshots = new Map<string, { items: unknown[]; at: string; expires: number; revision: number; filter: string }>();
const REFRESH_KEY = 'gleis.mock.refresh'; // simuliert das HttpOnly-Refresh-Cookie

function b64url(obj: object) {
  return btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeToken(userId: string, role: string) {
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TTL;
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: userId, role, exp })}.mock`;
}

function readToken(header: string | null): { sub: string; exp: number } | null {
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = header.slice(7).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

function fail(req: HttpRequest<unknown>, e: MockError) {
  return new HttpErrorResponse({
    status: e.status,
    statusText: e.code,
    url: req.url,
    error: {
      statusCode: e.status,
      code: e.code,
      message: e.message,
      ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
      ...(e.details ? { details: e.details } : {}),
      requestId: Math.random().toString(36).slice(2, 10),
    },
  });
}

function page<T>(items: T[], params: URLSearchParams) {
  const p = Math.max(1, Number(params.get('page') ?? 1));
  const size = Math.min(500, Math.max(1, Number(params.get('pageSize') ?? 20)));
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size };
}

function authResponse(userId: string) {
  const d = mockDb();
  const u = d.user(userId)!;
  return { accessToken: makeToken(u.id, u.role), expiresIn: ACCESS_TTL, user: d.publicUser(u) };
}

type Handler = (ctx: {
  req: HttpRequest<unknown>;
  m: RegExpExecArray;
  q: URLSearchParams;
  body: Record<string, unknown>;
  userId: string | null;
}) => unknown;

const R = (method: string, path: string, h: Handler, open = false) => ({
  method,
  re: new RegExp('^' + path.replace(/:(\w+)/g, '([^/]+)') + '$'),
  h,
  open,
});

function me(userId: string | null) {
  const u = userId ? mockDb().user(userId) : null;
  if (!u) throw new MockError(401, 'AUTH_SESSION_EXPIRED', 'Session expired');
  if (u.status === 'LOCKED') throw new MockError(401, 'AUTH_ACCOUNT_LOCKED', 'Account locked');
  return u;
}

function requireRole(userId: string | null, ...roles: string[]) {
  const u = me(userId);
  if (!roles.includes(u.role)) throw new MockError(403, 'AUTH_FORBIDDEN', 'Not allowed');
  return u;
}

const routes = [
  // ---------------- Auth
  R('GET', '/auth/csrf', () => {
    document.cookie = `XSRF-TOKEN=mock-${Math.random().toString(36).slice(2)}; path=/; SameSite=Lax`;
    return null;
  }, true),
  R('POST', '/auth/login', ({ body }) => {
    const d = mockDb();
    const u = d.findUserByEmail(String(body['email'] ?? ''));
    if (!u || u.password !== body['password']) throw new MockError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    if (u.status === 'LOCKED') throw new MockError(403, 'AUTH_ACCOUNT_LOCKED', 'Account locked');
    d.touchLogin(u);
    writeStorage(REFRESH_KEY, u.id);
    return authResponse(u.id);
  }, true),
  R('POST', '/auth/register', ({ body }) =>
    mockDb().register(String(body['email'] ?? ''), String(body['password'] ?? ''), String(body['displayName'] ?? '')), true),
  R('POST', '/auth/refresh', () => {
    const id = readStorage(REFRESH_KEY);
    const u = id ? mockDb().user(id) : null;
    if (!u || u.status === 'LOCKED') throw new MockError(401, 'AUTH_SESSION_EXPIRED', 'No session');
    return authResponse(u.id);
  }, true),
  R('POST', '/auth/logout', () => {
    writeStorage(REFRESH_KEY, null);
    return null;
  }, true),

  // ---------------- Konto
  R('GET', '/me', ({ userId }) => mockDb().publicUser(me(userId))),
  R('PATCH', '/me', ({ userId, body }) => mockDb().updateMe(me(userId), body)),
  R('PATCH', '/me/password', ({ userId, body }) => {
    mockDb().changePassword(me(userId), String(body['currentPassword'] ?? ''), String(body['newPassword'] ?? ''));
    writeStorage(REFRESH_KEY, null);
    return null;
  }),
  R('GET', '/me/dashboard', ({ userId }) => mockDb().dashboard(me(userId).id)),
  R('POST', '/me/recent-trips', ({ userId, body }) => {
    if (body['kind'] !== 'VIEWED') throw new MockError(400, 'VALIDATION_FAILED', 'Only VIEWED');
    mockDb().markViewed(me(userId).id, String(body['tripId']));
    return null;
  }),
  R('GET', '/me/favorite-stations', ({ userId }) => mockDb().favorites(me(userId).id)),
  R('PUT', '/me/favorite-stations', ({ userId, body }) => mockDb().setFavorites(me(userId).id, body['stationIds'])),
  R('GET', '/me/tickets', ({ userId, q }) => {
    let items = mockDb().tickets(me(userId).id);
    const status = q.get('status');
    if (status) items = items.filter((t) => t.status === status);
    return page(items, q);
  }),
  R('GET', '/me/tickets/:id', ({ userId, m }) => mockDb().ticket(me(userId).id, m[1])),
  R('POST', '/me/tickets', ({ userId, body }) => mockDb().createTicket(me(userId).id, body)),
  R('DELETE', '/me/tickets/:id', ({ userId, m }) => {
    mockDb().deleteTicket(me(userId).id, m[1]);
    return null;
  }),

  // ---------------- Länder & Einstellungen
  R('GET', '/settings', ({ userId }) => (me(userId), mockDb().settings())),
  R('GET', '/countries', ({ userId, q }) => (me(userId), page(mockDb().countries(), q))),
  R('PATCH', '/admin/settings', ({ userId, body }) => (requireRole(userId, 'ADMIN'), mockDb().setActiveCountry(String(body['activeCountry'])))),

  // ---------------- Rail Service
  R('GET', '/stations', ({ userId, q }) => (me(userId), page(mockDb().searchStations(q.get('q') ?? '', q.get('country')), q))),
  // vor /stations/:id
  R('GET', '/stations/nearby', ({ userId, q }) => {
    me(userId);
    const lng = Number(q.get('lng'));
    const lat = Number(q.get('lat'));
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)
      throw new MockError(400, 'VALIDATION_FAILED', 'Invalid position');
    const size = Math.min(20, Math.max(1, Number(q.get('pageSize') ?? 5)));
    const items = mockDb().nearby(lng, lat, size, q.get('country') ?? mockDb().settings().activeCountry);
    return { items, total: items.length, page: 1, pageSize: size };
  }),
  R('GET', '/stations/:id', ({ userId, m }) => (me(userId), mockDb().stationDetail(m[1]))),
  R('GET', '/stations/:id/departures', ({ userId, m, q }) =>
    (me(userId), page(mockDb().boardFor(m[1], 'dep', q.get('from') ?? undefined, q.get('to') ?? undefined), q))),
  R('GET', '/stations/:id/arrivals', ({ userId, m, q }) =>
    (me(userId), page(mockDb().boardFor(m[1], 'arr', q.get('from') ?? undefined, q.get('to') ?? undefined), q))),
  R('GET', '/lines', ({ userId, q }) => {
    me(userId);
    const items = (mockDb().adminList('lines', { q: q.get('q') ?? '', companyId: q.get('companyId') ?? '' }) as { name: string }[])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    return page(items, q);
  }),
  R('GET', '/routes/:id', ({ userId, m }) => (me(userId), mockDb().adminGet('routes', m[1]))),
  R('GET', '/trips', ({ userId, q }) =>
    (me(userId), page(mockDb().trips({
      from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, lineId: q.get('lineId') ?? undefined,
      trainId: q.get('trainId') ?? undefined, status: q.get('status') ?? undefined,
    }), q))),
  R('GET', '/trips/:id', ({ userId, m }) => (me(userId), mockDb().trip(decodeURIComponent(m[1])))),
  R('GET', '/trips/:id/position', ({ userId, m }) => (me(userId), mockDb().tripPosition(decodeURIComponent(m[1])))),
  R('GET', '/trips/:id/shape', ({ userId, m }) => (me(userId), mockDb().tripShape(decodeURIComponent(m[1])))),
  R('GET', '/disruptions', ({ userId, q }) =>
    (me(userId), page(mockDb().disruptions({
      country: q.get('country') ?? mockDb().settings().activeCountry, stationId: q.get('stationId') ?? undefined,
      lineId: q.get('lineId') ?? undefined, activeAt: q.get('activeAt') ?? undefined,
    }), q))),
  R('GET', '/health/status', () => ({ status: 'ok', realtime: 'SCHEDULE_ONLY', lastPositionAt: null }), true),
  R('GET', '/connections', ({ userId, q }) => {
    me(userId);
    const from = q.get('fromStationId');
    const to = q.get('toStationId');
    if (!from || !to) throw new MockError(400, 'VALIDATION_FAILED', 'Stations required', [
      ...(!from ? [{ field: 'fromStationId', code: 'REQUIRED', message: 'Required' }] : []),
      ...(!to ? [{ field: 'toStationId', code: 'REQUIRED', message: 'Required' }] : []),
    ]);
    return page(mockDb().connections(from, to, q.get('departAfter') ?? undefined, Number(q.get('maxTransfers') ?? 2)), q);
  }),

  // ---------------- Karte
  R('GET', '/map/railways', ({ userId, q }) => (me(userId), mockDb().railways(q.get('country') ?? mockDb().settings().activeCountry))),
  R('GET', '/map/trains', ({ userId, q }) => {
    me(userId);
    const country = q.get('country') ?? mockDb().settings().activeCountry;
    const filter = `${userId}|${country}|${q.get('bbox') ?? ''}|${q.get('pageSize') ?? 100}`;
    const token = q.get('snapshotToken');
    let snap = token ? snapshots.get(token) : undefined;
    if (token && !snap) throw new MockError(410, 'MAP_SNAPSHOT_EXPIRED', 'Snapshot expired');
    if (snap && snap.expires < Date.now()) {
      snapshots.delete(token!);
      throw new MockError(410, 'MAP_SNAPSHOT_EXPIRED', 'Snapshot expired');
    }
    if (snap && snap.filter !== filter) throw new MockError(400, 'MAP_SNAPSHOT_MISMATCH', 'Filter changed');
    let snapshotToken = token;
    if (!snap) {
      const bbox = q.get('bbox')?.split(',').map(Number) ?? null;
      const items = mockDb().mapTrains(country, bbox).sort((a, b) => a.tripId.localeCompare(b.tripId));
      snapshotToken = 'snap-' + Math.random().toString(36).slice(2);
      snap = { items, at: new Date().toISOString(), expires: Date.now() + 120000, revision: mapRevision, filter };
      snapshots.set(snapshotToken, snap);
    }
    const size = Math.min(500, Math.max(1, Number(q.get('pageSize') ?? 100)));
    return {
      ...page(snap.items, new URLSearchParams({ page: q.get('page') ?? '1', pageSize: String(size) })),
      snapshotToken,
      snapshotAt: snap.at,
      snapshotExpiresAt: new Date(snap.expires).toISOString(),
      snapshotRevision: snap.revision,
    };
  }),

  // ---------------- Worker
  R('GET', '/operations/trips', ({ userId, q }) => {
    const u = requireRole(userId, 'WORKER', 'ADMIN');
    return page(mockDb().operationsTrips({
      from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, q: q.get('q') ?? undefined,
      status: q.get('status') ?? undefined, allowedTrainIds: mockDb().allowedTrainIds(u),
    }), q);
  }),
  R('GET', '/operations/assignments', ({ userId, q }) => page(mockDb().assignmentsOf(requireRole(userId, 'WORKER', 'ADMIN').id), q)),
  R('PATCH', '/operations/trips/:id', ({ userId, m, body }) =>
    mockDb().patchTrip(requireRole(userId, 'WORKER', 'ADMIN'), decodeURIComponent(m[1]), body)),
  R('PATCH', '/operations/trips/:id/stops/:stop', ({ userId, m, body }) =>
    mockDb().patchStop(requireRole(userId, 'WORKER', 'ADMIN'), decodeURIComponent(m[1]), decodeURIComponent(m[2]), body)),

  // ---------------- Admin
  R('POST', '/admin/imports', ({ userId, body }) => (requireRole(userId, 'ADMIN'), mockDb().startImport(String(body['country']), body['kind'] as 'RAILWAYS'))),
  R('GET', '/admin/imports/:id', ({ userId, m }) => (requireRole(userId, 'ADMIN'), mockDb().importJob(m[1]))),
  R('GET', '/admin/audit', ({ userId, q }) => (requireRole(userId, 'ADMIN'), page([], q))),
  R('GET', '/admin/:res', ({ userId, m, q }) => {
    requireRole(userId, 'ADMIN');
    const query: Record<string, string> = {};
    q.forEach((v, k) => (query[k] = v));
    return page(mockDb().adminList(m[1], query), q);
  }),
  R('GET', '/admin/:res/:id', ({ userId, m }) => (requireRole(userId, 'ADMIN'), mockDb().adminGet(m[1], decodeURIComponent(m[2])))),
  R('POST', '/admin/:res', ({ userId, m, body }) => mockDb().adminCreate(m[1], body, requireRole(userId, 'ADMIN'))),
  R('PATCH', '/admin/:res/:id', ({ userId, m, body }) => mockDb().adminUpdate(m[1], decodeURIComponent(m[2]), body, requireRole(userId, 'ADMIN'))),
  R('DELETE', '/admin/:res/:id', ({ userId, m, q }) => {
    mockDb().adminDelete(m[1], decodeURIComponent(m[2]), Number(q.get('version')), requireRole(userId, 'ADMIN'));
    return null;
  }),
];

const PASSWORD_CHANGE_ALLOWED = ['GET /me', 'PATCH /me/password'];
const CREATED = /^POST \/(me\/tickets|admin\/(?!imports))/;

/** Beantwortet alle /api/v1-Anfragen lokal, mit kleiner Verzögerung wie im echten Netz. */
export const mockBackendInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiBase)) return next(req);
  const url = new URL(req.urlWithParams, location.origin);
  const path = url.pathname.slice(environment.apiBase.length) || '/';
  const route = routes.find((r) => r.method === req.method && r.re.test(path));
  const latency = 120 + Math.random() * 200;

  const respond = (): Observable<HttpEvent<unknown>> => {
    if (!route) return throwError(() => fail(req, new MockError(404, 'NOT_FOUND', `No mock for ${req.method} ${path}`)));
    let userId: string | null = null;
    if (!route.open) {
      const token = readToken(req.headers.get('Authorization'));
      if (!token || token.exp * 1000 < Date.now()) {
        return throwError(() => fail(req, new MockError(401, 'AUTH_SESSION_EXPIRED', 'Token missing or expired')));
      }
      userId = token.sub;
      const u = mockDb().user(userId);
      if (u?.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.includes(`${req.method} ${path}`)) {
        return throwError(() => fail(req, new MockError(403, 'AUTH_PASSWORD_CHANGE_REQUIRED', 'Change your password first')));
      }
    }
    try {
      const body = structuredClone(
        route.h({ req, m: route.re.exec(path)!, q: url.searchParams, body: (req.body ?? {}) as Record<string, unknown>, userId }),
      );
      const key = `${req.method} ${path}`;
      const status =
        body === null ? (req.method === 'GET' ? 204 : 204) : key === 'POST /admin/imports' ? 202 : CREATED.test(key) || key === 'POST /auth/register' ? 201 : 200;
      return of(new HttpResponse({ status, body, url: req.url }));
    } catch (e) {
      if (e instanceof MockError) return throwError(() => fail(req, e));
      console.error('[mock]', e);
      return throwError(() => fail(req, new MockError(500, 'INTERNAL', 'Mock error')));
    }
  };

  // Verzögerung auch für Fehler
  return respond().pipe(materialize(), delay(latency), dematerialize());
};

/**
 * Simulierter Socket: sendet trip.updated nach Worker-Änderungen und alle
 * 4 Sekunden Positionen für den abonnierten Kartenausschnitt.
 */
export class MockRealtimeTransport implements RealtimeTransport {
  readonly events$ = new Subject<{ name: string; payload: unknown }>();
  readonly connected$ = new Subject<void>();
  private trips = new Set<string>();
  private map: { subscriptionId: string; country: string; bbox: number[] } | null = null;
  private removedVersion = 0;
  private visible = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private connected = false;

  constructor() {
    mockDb().tripChanged$.subscribe((tripId) => {
      if (!this.connected || !this.trips.has(tripId)) return;
      const d = mockDb().tripDetailSafe(tripId);
      if (d) this.push('trip.updated', tripId, d.version, d);
    });
    mockDb().scheduleChanged$.subscribe(({ scheduleId, affected }) => {
      if (this.connected) this.push('schedule.updated', scheduleId, Date.now(), { scheduleId, country: 'AT', affectedTripIds: affected, requiresRefetch: true });
    });
    mockDb().disruptionChanged$.subscribe((id) => {
      if (this.connected) this.push('disruption.updated', id, Date.now(), { id });
    });
  }

  connect(): void {
    this.connected = true;
    if (!this.timer) this.timer = setInterval(() => this.tick(), 4000);
    setTimeout(() => this.connected$.next(), 50);
  }

  disconnect(): void {
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.trips.clear();
    this.map = null;
    this.visible.clear();
  }

  emit(event: string, payload: unknown): Promise<Ack> {
    const p = payload as { tripIds?: string[]; country?: string; bbox?: number[]; subscriptionId?: string };
    switch (event) {
      case 'trips.subscribe':
        if ((p.tripIds?.length ?? 0) > 100) return Promise.resolve({ ok: false, error: { code: 'TOO_MANY', message: 'Max 100' } });
        p.tripIds?.forEach((id) => this.trips.add(id));
        break;
      case 'trips.unsubscribe':
        p.tripIds?.forEach((id) => this.trips.delete(id));
        break;
      case 'map.subscribe':
        if (!p.subscriptionId) return Promise.resolve({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'subscriptionId required' } });
        this.map = { subscriptionId: p.subscriptionId, country: p.country!, bbox: p.bbox! };
        this.visible.clear();
        return Promise.resolve({ ok: true, subscriptionId: p.subscriptionId } as Ack);
      case 'map.unsubscribe':
        this.map = null;
        this.visible.clear();
        break;
    }
    return Promise.resolve({ ok: true });
  }

  private push(name: string, entityId: string, version: number, data: unknown, map?: { subscriptionId: string; mapRevision: number }) {
    this.seq += 1;
    this.events$.next({
      name,
      payload: { eventId: `ev-${this.seq}`, occurredAt: new Date().toISOString(), entityId, version, data, ...(map ?? {}) },
    });
  }

  private tick() {
    if (!this.connected || !this.map) return;
    mapRevision += 1;
    const meta = { subscriptionId: this.map.subscriptionId, mapRevision };
    const trains = mockDb().mapTrains(this.map.country, this.map.bbox);
    const now = new Set<string>();
    for (const t of trains) {
      now.add(t.tripId);
      this.push('trip.position.updated', t.tripId, t.positionVersion, t, meta);
    }
    for (const id of this.visible) {
      this.removedVersion = Math.max(this.removedVersion + 1, Math.floor(Date.now() / 1000));
      if (!now.has(id)) this.push('map.train.removed', id, this.removedVersion, { tripId: id }, meta);
    }
    this.visible = now;
  }
}
