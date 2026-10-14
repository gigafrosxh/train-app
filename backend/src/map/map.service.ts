import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Database } from "../database/database";
import { RailService, effective, ms } from "../rail/rail.service";
import { Events } from "../common/events";
import { fail } from "../common/errors";
import { paginate } from "../common/validation";
import { along, locate, inside, Point, distance } from "./geometry";
@Injectable()
export class MapService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<void>;
  private revision = Date.now();
  private state = new Map<string, any>();
  private snapshots = new Map<string, any>();
  constructor(
    @Inject(Database) private db: Database,
    @Inject(RailService) private rail: RailService,
    @Inject(Events) private events: Events,
  ) {}
  async onModuleInit() {
    if (process.env.DISABLE_JOBS === "true") return;
    await this.refresh();
    this.timer = setInterval(
      () =>
        this.refresh().catch((e) =>
          console.error("Position refresh failed", e.message),
        ),
      5000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async shape(id: string) {
    const t = await this.rail.trip(id);
    const [row] = await this.db.query(
      `SELECT ST_AsGeoJSON(ST_LineMerge(ST_Collect(tr.geometry ORDER BY rt.sequence)))::json AS geometry FROM route_tracks rt JOIN tracks tr ON tr.id=rt.track_id WHERE rt.route_id=$1`,
      [t.routeId],
    );
    if (!row?.geometry || row.geometry.type !== "LineString")
      fail(
        404,
        "TRIP_SHAPE_UNAVAILABLE",
        "No continuous route geometry is available.",
      );
    let coords = row.geometry.coordinates as Point[];
    const first = await this.rail.station(t.origin.id),
      last = await this.rail.station(t.destination.id);
    if (
      locate(coords, first.coordinates).fraction >
      locate(coords, last.coordinates).fraction
    )
      coords = coords.slice().reverse();
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { tripId: id },
    };
  }
  private async calculate(t: any) {
    const now = Date.now();
    const next = t.stops.find(
      (s: any) =>
        ms(effective(s, "Departure") ?? effective(s, "Arrival")) > now,
    );
    const base = {
      tripId: t.id,
      lineName: t.lineName,
      trainNumber: t.trainNumber,
      coordinates: null as Point[] | Point | null,
      bearing: null as number | null,
      delaySeconds: t.delaySeconds,
      nextStopName: next?.station.name ?? null,
      positionType: "UNAVAILABLE",
      isStale: false,
      observedAt: null as string | null,
      calculatedAt: null as string | null,
      source: null as string | null,
      estimationMethod: null as string | null,
    };
    if (t.status !== "RUNNING") return base;
    const real = await this.db.one(
      "SELECT ST_X(coordinates) AS lng,ST_Y(coordinates) AS lat,observed_at,bearing,source FROM positions WHERE trip_id=$1",
      [t.id],
    );
    if (real && now - ms(real.observed_at) <= 120000)
      return {
        ...base,
        coordinates: [real.lng, real.lat],
        bearing: real.bearing,
        positionType: "REALTIME",
        observedAt: new Date(real.observed_at).toISOString(),
        source: real.source,
      };
    try {
      const shape = await this.shape(t.id),
        line = shape.geometry.coordinates;
      const fractions: number[] = [];
      for (const stop of t.stops) {
        const station = await this.rail.station(stop.station.id);
        const loc = locate(line, station.coordinates);
        if (loc.distance > 1000) return { ...base, isStale: !!real };
        fractions.push(loc.fraction);
      }
      if (fractions.some((v, i) => i > 0 && v < fractions[i - 1])) return base;
      let f = fractions[0];
      for (let i = 0; i < t.stops.length; i++) {
        const stop = t.stops[i],
          arr = ms(effective(stop, "Arrival")),
          dep = ms(effective(stop, "Departure"));
        if (arr && dep && now >= arr && now <= dep) {
          f = fractions[i];
          break;
        }
        if (i < t.stops.length - 1) {
          const end = ms(effective(t.stops[i + 1], "Arrival"));
          if (dep && end && now >= dep && now <= end) {
            f =
              fractions[i] +
              ((fractions[i + 1] - fractions[i]) * (now - dep)) /
                (end - dep || 1);
            break;
          }
        }
      }
      return {
        ...base,
        ...along(line, f),
        positionType: "ESTIMATED",
        isStale: !!real,
        observedAt: real ? new Date(real.observed_at).toISOString() : null,
        calculatedAt: new Date().toISOString(),
        source: "SCHEDULE",
        estimationMethod: t.stops.some(
          (s: any) => s.expectedArrival || s.expectedDeparture,
        )
          ? "SCHEDULE_WITH_UPDATES"
          : "SCHEDULE",
      };
    } catch (e: any) {
      if (e?.getStatus?.() !== 404) throw e;
      return { ...base, isStale: !!real };
    }
  }
  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.rebuild().finally(() => (this.pending = undefined));
    return this.pending;
  }
  private async rebuild() {
    const ids = await this.db.query(
      `SELECT t.id,c.country FROM trips t JOIN trains tr ON tr.id=t.train_id JOIN companies c ON c.id=tr.company_id WHERE EXISTS(SELECT 1 FROM trip_stops s WHERE s.trip_id=t.id AND COALESCE(s.expected_departure,s.scheduled_departure)<=now()) AND EXISTS(SELECT 1 FROM trip_stops s WHERE s.trip_id=t.id AND COALESCE(s.expected_arrival,s.scheduled_arrival)>=now())`,
    );
    const trips = await this.rail.details(ids.map((r) => r.id));
    const calculated = [];
    for (const t of trips)
      calculated.push({
        country: ids.find((r) => r.id === t.id).country,
        ...(await this.calculate(t)),
      });
    const next = new Map<string, any>();
    for (const item of calculated) {
      const old = this.state.get(item.tripId);
      const version = (old?.positionVersion ?? this.revision) + 1;
      next.set(item.tripId, { ...item, positionVersion: version });
    }
    const events: any[] = [];
    for (const [id, item] of next) {
      const old = this.state.get(id);
      this.revision++;
      events.push({ old, item, revision: this.revision });
    }
    for (const [id, old] of this.state)
      if (!next.has(id)) {
        this.revision++;
        events.push({
          old,
          item: {
            ...old,
            coordinates: null,
            positionType: "UNAVAILABLE",
            positionVersion: old.positionVersion + 1,
          },
          revision: this.revision,
        });
      }
    this.state = next;
    for (const e of events) this.events.emit("map.position", e);
  }
  async position(id: string) {
    const t = await this.rail.trip(id);
    await this.refresh();
    const v = this.state.get(id);
    if (v) {
      const { country, ...r } = v;
      return r;
    }
    return { ...(await this.calculate(t)), positionVersion: this.revision };
  }
  async trains(q: any, userId: string) {
    const c = await this.rail.country(q.country);
    const key = JSON.stringify([c.code, q.bbox ?? null, q.pageSize]);
    for (const [id, s] of this.snapshots)
      if (s.expires < Date.now()) this.snapshots.delete(id);
    let snap: any,
      token = q.snapshotToken;
    if (token) {
      snap = this.snapshots.get(token);
      if (!snap || snap.userId !== userId)
        fail(410, "MAP_SNAPSHOT_EXPIRED", "Reload the map.");
      if (snap.key !== key)
        fail(400, "MAP_SNAPSHOT_MISMATCH", "Snapshot filters changed.");
    } else {
      if (q.page !== 1)
        fail(400, "MAP_SNAPSHOT_REQUIRED", "Start with page 1.");
      if (
        [...this.snapshots.values()].filter((s) => s.userId === userId)
          .length >= 20
      )
        fail(429, "MAP_SNAPSHOT_LIMIT", "Too many map snapshots.");
      await this.refresh();
      token = randomUUID();
      const items = [...this.state.values()]
        .filter((v) => v.country === c.code && inside(v.coordinates, q.bbox))
        .map(({ country, ...v }) => v)
        .sort((a, b) => a.tripId.localeCompare(b.tripId));
      snap = {
        userId,
        key,
        items,
        at: Date.now(),
        expires: Date.now() + 120000,
        revision: this.revision,
      };
      this.snapshots.set(token, snap);
    }
    return {
      ...paginate(snap.items, q),
      snapshotToken: token,
      snapshotAt: new Date(snap.at).toISOString(),
      snapshotExpiresAt: new Date(snap.expires).toISOString(),
      snapshotRevision: snap.revision,
    };
  }
  async railways(q: any) {
    const c = await this.rail.country(q.country);
    const box = q.bbox?.split(",").map(Number) ?? [-180, -90, 180, 90];
    const tolerance = 360 / (256 * Math.pow(2, q.zoom));
    // Übersicht (kleiner Zoom): Abschnitte je Streckentyp zu wenigen Linien zusammenfassen,
    // sonst sprengt ein ganzes OSM-Landesnetz Antwortgröße und Limit.
    if (q.zoom < 10) {
      const skip = q.zoom < 8 ? ["industrial", "military", "test"] : [];
      const merged = await this.db.query(
        `SELECT usage, bool_and(electrified) AS electrified, min(source) AS source, min(attribution) AS attribution, max(updated_at) AS updated_at,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_LineMerge(ST_Collect(geometry)),$6))::json AS geometry
           FROM tracks WHERE country=$1 AND geometry && ST_MakeEnvelope($2,$3,$4,$5,4326) AND NOT (usage = ANY($7))
          GROUP BY usage`,
        [c.code, ...box, tolerance, skip],
      );
      return this.collection(c, merged.filter((r) => r.geometry).map((r) => ({ ...r, id: "merged:" + r.usage, name: null })));
    }
    const rows = await this.db.query(
      `SELECT id,name,usage,electrified,source,attribution,updated_at,ST_AsGeoJSON(ST_SimplifyPreserveTopology(geometry,$6))::json AS geometry FROM tracks WHERE country=$1 AND geometry && ST_MakeEnvelope($2,$3,$4,$5,4326) ORDER BY id LIMIT 10001`,
      [c.code, ...box, tolerance],
    );
    if (rows.length > 10000)
      fail(422, "MAP_AREA_TOO_LARGE", "Zoom in to load the rail network.");
    return this.collection(c, rows);
  }
  private collection(c: any, rows: any[]) {
    return {
      type: "FeatureCollection",
      features: rows.map((r) => ({
        type: "Feature",
        geometry: r.geometry,
        properties: {
          id: r.id,
          name: r.name,
          usage: r.usage,
          ...(r.electrified === null ? {} : { electrified: r.electrified }),
        },
      })),
      metadata: {
        country: c.code,
        source: [...new Set(rows.map((r) => r.source))].join(", "),
        attribution: [...new Set(rows.map((r) => r.attribution))].join("; "),
        updatedAt: rows.length
          ? new Date(
              Math.max(...rows.map((r) => ms(r.updated_at))),
            ).toISOString()
          : null,
        dataStatus: c.data_status,
      },
    };
  }
}
