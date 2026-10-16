import { z } from "zod";
import { tripDetail } from "./rail.schemas";
type TripDetail = z.infer<typeof tripDetail>;
import { Inject, Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { createHash } from "node:crypto";
import { Database, camel } from "../database/database";
import { fail } from "../common/errors";
import { paginate } from "../common/validation";
import { windowFor } from "./time";
export const stationSql = `SELECT s.id,s.name,s.code,s.country,s.time_zone,s.aliases,s.version,ST_X(s.coordinates) AS lng,ST_Y(s.coordinates) AS lat FROM stations s`;
export const ref = (s: any) => ({
  id: s.id,
  name: s.name,
  code: s.code ?? null,
  timeZone: s.timeZone ?? s.time_zone,
});
/** Wichtige Halte zuerst: Bahnhöfe mit vielen Linien (für „über …“ auf der Tafel). */
const VIA_COUNT = 3;
export function pickVia(stops: any[], importance: Map<string, number>) {
  const candidates = stops.filter((s) => !s.cancelled);
  if (candidates.length <= VIA_COUNT) return candidates.map((s) => s.station);
  return candidates
    .map((s, i) => ({ s, i, n: importance.get(s.station.id) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, VIA_COUNT)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s.station);
}
/** Mindestumsteigezeit; knapper Umstieg mit verspätetem Zubringer gilt als gefährdet. */
const MIN_TRANSFER_SECONDS = 300;
const RISKY_TRANSFER_SECONDS = 600;
export const ms = (v: any) => (v ? new Date(v).getTime() : 0);
export const delta = (expected: any, scheduled: any) =>
  expected && scheduled
    ? Math.round((ms(expected) - ms(scheduled)) / 1000)
    : null;
export const effective = (s: any, kind: string) =>
  s["actual" + kind] ?? s["expected" + kind] ?? s["scheduled" + kind];
@Injectable()
export class RailService {
  constructor(@Inject(Database) public db: Database) {}
  async country(code?: string) {
    const c = await this.db.one(
      "SELECT c.* FROM countries c WHERE code=COALESCE($1,(SELECT active_country FROM settings WHERE id=1))",
      [code ?? null],
    );
    if (!c) fail(404, "COUNTRY_NOT_FOUND", "Country not found.");
    return c;
  }
  async settings() {
    const c = await this.country();
    return {
      activeCountry: c.code,
      tripGenerationDays: 14,
      searchWindow: windowFor(c.timezone),
    };
  }
  /**
   * Fehlertolerante Suche über station_key() (siehe Migration Usability): Treffer am Namensanfang zuerst,
   * dann Teiltreffer, Kürzel und Zweitnamen, zuletzt Tippfehler (Trigramm-Wortähnlichkeit ab 4 Zeichen).
   * Verglichen wird mit der normalisierten und der nur vereinfachten Eingabe, damit „St“ beim Tippen
   * noch „Stadlau“ findet und nicht nur „Sankt …“.
   */
  async stations(q: any) {
    const c = await this.country(q.country);
    const text = q.q?.trim() || null;
    const rows = await this.db.query(
      `WITH k AS (SELECT station_key($2) AS key, trim(regexp_replace(lower(unaccent($2)),'[^a-z0-9]+',' ','g')) AS raw)
       SELECT * FROM (
         SELECT x.*, CASE
             WHEN $2::text IS NULL THEN 0
             WHEN x.key LIKE k.key || '%' OR x.key LIKE k.raw || '%' THEN 0
             WHEN x.key LIKE '% ' || k.key || '%' OR x.key LIKE '% ' || k.raw || '%' OR lower(x.code) = lower($2) THEN 1
             WHEN x.key LIKE '%' || k.key || '%' OR x.key LIKE '%' || k.raw || '%' THEN 2
             WHEN EXISTS (SELECT 1 FROM unnest(x.aliases) a WHERE station_key(a) LIKE '%' || k.key || '%') THEN 2
             WHEN length(k.key) >= 4 AND word_similarity(k.key, x.key) >= 0.4 THEN 3
             ELSE NULL END AS rank,
           CASE WHEN $2::text IS NULL THEN 0 ELSE word_similarity(k.key, x.key) END AS sim
         FROM (${stationSql.replace("FROM stations s", ",station_key(s.name) AS key FROM stations s")} WHERE s.country=$1) x, k
       ) r WHERE r.rank IS NOT NULL ORDER BY r.rank, r.sim DESC, r.name, r.id`,
      [c.code, text],
    );
    return paginate(rows.map(({ key, rank, sim, ...r }: any) => this.stationRow(r)), q);
  }
  stationRow(r: any) {
    const { lng, lat, ...v } = camel(r);
    return { ...v, coordinates: [lng, lat] };
  }
  async station(id: string) {
    const r = await this.db.one(stationSql + " WHERE s.id=$1", [id]);
    if (!r) fail(404, "STATION_NOT_FOUND", "Station not found.");
    return this.stationRow(r);
  }
  /** Bahnhof mit den Linien, die dort halten (für Filter auf der Tafel). */
  async stationDetail(id: string) {
    const station = await this.station(id);
    const lines = await this.db.query(
      "SELECT DISTINCT l.id,l.name,l.color FROM route_stops rs JOIN routes r ON r.id=rs.route_id JOIN lines l ON l.id=r.line_id WHERE rs.station_id=$1 ORDER BY l.name,l.id",
      [id],
    );
    return { ...station, lines };
  }
  /** Bahnhöfe im Umkreis, nächster zuerst. Der Standort wird nicht gespeichert. */
  async nearby(q: any) {
    const c = await this.country(q.country);
    const rows = await this.db.query(
      stationSql.replace(
        "FROM stations s",
        ",ST_Distance(s.coordinates::geography, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) AS distance_meters FROM stations s",
      ) +
        " WHERE s.country=$1 ORDER BY s.coordinates <-> ST_SetSRID(ST_MakePoint($2,$3),4326), s.id LIMIT $4",
      [c.code, q.lng, q.lat, q.pageSize],
    );
    const items = rows
      .map((r: any) => ({ ...this.stationRow(r), distanceMeters: Math.round(r.distance_meters) }))
      .sort((a: any, b: any) => a.distanceMeters - b.distanceMeters);
    return { items, total: items.length, page: 1, pageSize: q.pageSize };
  }
  /** Anzahl Linien je Bahnhof; Grundlage für die Auswahl der „über“-Halte. */
  async importance(stationIds: string[]) {
    if (!stationIds.length) return new Map<string, number>();
    const rows = await this.db.query(
      "SELECT rs.station_id, count(DISTINCT r.line_id)::int AS n FROM route_stops rs JOIN routes r ON r.id=rs.route_id WHERE rs.station_id=ANY($1) GROUP BY rs.station_id",
      [[...new Set(stationIds)]],
    );
    return new Map<string, number>(rows.map((r: any) => [r.station_id, r.n]));
  }
  async lines(q: any) {
    const c = await this.country(q.country);
    return paginate(
      (
        await this.db.query(
          "SELECT l.* FROM lines l JOIN companies c ON c.id=l.company_id WHERE c.country=$1 AND ($2::uuid IS NULL OR l.company_id=$2) AND ($3::text IS NULL OR l.name ILIKE $3) ORDER BY l.name,l.id",
          [c.code, q.companyId ?? null, q.q ? "%" + q.q + "%" : null],
        )
      ).map(camel),
      q,
    );
  }
  async route(id: string, m: EntityManager = this.db.manager) {
    const [row] = await m.query("SELECT * FROM routes WHERE id=$1", [id]);
    if (!row) fail(404, "ROUTE_NOT_FOUND", "Route not found.");
    const stops: any[] = await m.query(
      "SELECT rs.id,rs.sequence,s.id AS station_id,s.name,s.code,s.time_zone FROM route_stops rs JOIN stations s ON s.id=rs.station_id WHERE rs.route_id=$1 ORDER BY rs.sequence",
      [id],
    );
    const tracks: any[] = await m.query(
      "SELECT track_id FROM route_tracks WHERE route_id=$1 ORDER BY sequence",
      [id],
    );
    return {
      ...camel(row),
      stops: stops.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        station: { id: s.station_id, name: s.name, code: s.code, timeZone: s.time_zone },
      })),
      trackIds: tracks.map((t) => t.track_id),
    };
  }
  async details(
    ids?: string[],
    m: EntityManager = this.db.manager,
  ): Promise<TripDetail[]> {
    if (ids?.length === 0) return [];
    const rows: any[] = await m.query(
      `SELECT t.*,p.observed_at AS last_observed_at,tr.train_number,l.id AS line_id,l.name AS line_name,l.color AS line_color,c.id AS company_id,c.name AS company_name,c.country FROM trips t JOIN trains tr ON tr.id=t.train_id JOIN routes r ON r.id=t.route_id JOIN lines l ON l.id=r.line_id JOIN companies c ON c.id=l.company_id LEFT JOIN positions p ON p.trip_id=t.id WHERE ($1::uuid[] IS NULL OR t.id=ANY($1)) ORDER BY t.service_date,t.id`,
      [ids ?? null],
    );
    if (!rows.length) return [];
    const stops: any[] = await m.query(
      "SELECT ts.*,s.name,s.code,s.time_zone FROM trip_stops ts JOIN stations s ON s.id=ts.station_id WHERE ts.trip_id=ANY($1) ORDER BY ts.sequence",
      [rows.map((r) => r.id)],
    );
    const grouped = new Map<string, any[]>();
    for (const row of stops) {
      const s = camel(row);
      const v = {
        id: s.id,
        sequence: s.sequence,
        station: { id: s.stationId, name: s.name, code: s.code, timeZone: s.timeZone },
        scheduledArrival: s.scheduledArrival,
        scheduledDeparture: s.scheduledDeparture,
        expectedArrival: s.expectedArrival,
        expectedDeparture: s.expectedDeparture,
        actualArrival: s.actualArrival,
        actualDeparture: s.actualDeparture,
        scheduledPlatform: s.scheduledPlatform,
        expectedPlatform: s.expectedPlatform,
        arrivalDelaySeconds: delta(s.expectedArrival, s.scheduledArrival),
        departureDelaySeconds: delta(s.expectedDeparture, s.scheduledDeparture),
        cancelled: s.cancelled,
        reasonCode: s.reasonCode,
        reasonText: s.reasonText,
        version: s.version,
      };
      grouped.set(s.tripId, [...(grouped.get(s.tripId) ?? []), v]);
    }
    return rows.map((row) => {
      const t = camel(row),
        s = grouped.get(t.id) ?? [];
      const first = s[0],
        last = s.at(-1);
      if (!first || !last) fail(500, "INVALID_TRIP", "Trip has no stops.");
      const next =
        s.find(
          (x) =>
            !x.cancelled &&
            ms(effective(x, "Departure") ?? effective(x, "Arrival")) >
              Date.now(),
        ) ?? last;
      const status: TripDetail["status"] = t.cancelled
        ? "CANCELLED"
        : Date.now() < ms(effective(first, "Departure"))
          ? "SCHEDULED"
          : Date.now() > ms(effective(last, "Arrival"))
            ? "COMPLETED"
            : "RUNNING";
      return {
        id: t.id,
        trainId: t.trainId,
        trainNumber: t.trainNumber,
        lineId: t.lineId,
        lineName: t.lineName,
        lineColor: t.lineColor,
        companyId: t.companyId,
        companyName: t.companyName,
        routeId: t.routeId,
        serviceDate: String(t.serviceDate).slice(0, 10),
        origin: first.station,
        destination: last.station,
        scheduledDeparture: first.scheduledDeparture,
        scheduledArrival: last.scheduledArrival,
        expectedDeparture: first.expectedDeparture,
        expectedArrival: last.expectedArrival,
        delaySeconds:
          next.departureDelaySeconds ??
          next.arrivalDelaySeconds ??
          t.delaySeconds,
        status,
        lastObservedAt: t.lastObservedAt ?? null,
        version: t.version,
        stops: s,
      };
    });
  }
  async trip(id: string, m?: EntityManager) {
    const t = (await this.details([id], m))[0];
    if (!t) fail(404, "TRIP_NOT_FOUND", "Trip not found.");
    return t;
  }
  async range(q: any, code?: string) {
    const c = await this.country(code ?? q.country);
    const w = windowFor(c.timezone);
    const from = q.from ?? new Date().toISOString(),
      to =
        q.to ?? new Date(Math.min(ms(from) + 86400000, ms(w.to))).toISOString();
    if (ms(from) < ms(w.from) || ms(from) >= ms(w.to) || ms(to) > ms(w.to))
      fail(
        400,
        "SEARCH_DATE_OUT_OF_RANGE",
        "Choose a date in the available timetable.",
        {
          fieldErrors: [
            {
              field: "from",
              code: "SEARCH_DATE_OUT_OF_RANGE",
              message: "Outside the available timetable.",
            },
          ],
        },
      );
    if (ms(to) <= ms(from) || ms(to) - ms(from) > 7 * 86400000)
      fail(
        400,
        "VALIDATION_FAILED",
        "Choose an increasing time range of at most 7 days.",
      );
    return { from, to, country: c.code };
  }
  async trips(q: any, workerId?: string) {
    const r = await this.range(q);
    const rows = await this.db.query(
      `SELECT DISTINCT t.id FROM trips t JOIN trip_stops s ON s.trip_id=t.id JOIN routes r ON r.id=t.route_id JOIN lines l ON l.id=r.line_id JOIN companies c ON c.id=l.company_id JOIN trains tr ON tr.id=t.train_id WHERE c.country=$1 AND s.sequence=(SELECT min(sequence) FROM trip_stops WHERE trip_id=t.id) AND s.scheduled_departure >= $2 AND s.scheduled_departure < $3 AND ($4::uuid IS NULL OR l.id=$4) AND ($5::uuid IS NULL OR tr.id=$5) AND ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM worker_assignments a WHERE a.worker_id=$6 AND (a.train_id=tr.id OR a.company_id=tr.company_id) AND (a.valid_from IS NULL OR a.valid_from<=now()) AND (a.valid_until IS NULL OR a.valid_until>now())))`,
      [
        r.country,
        r.from,
        r.to,
        q.lineId ?? null,
        q.trainId ?? null,
        workerId ?? null,
      ],
    );
    let trips = await this.details(rows.map((r) => r.id));
    if (q.status) trips = trips.filter((t) => t.status === q.status);
    trips.sort(
      (a, b) =>
        ms(a.scheduledDeparture) - ms(b.scheduledDeparture) ||
        a.id.localeCompare(b.id),
    );
    return paginate(
      trips.map(({ stops, ...t }) => t),
      q,
    );
  }
  boardEntry(
    t: any,
    s: any,
    kind: "Arrival" | "Departure",
    importance = new Map<string, number>(),
  ) {
    const i = t.stops.findIndex((x: any) => x.id === s.id);
    // Abfahrt: Halte danach (ohne Ziel); Ankunft: Halte davor (ohne Start)
    const around =
      kind === "Departure"
        ? t.stops.slice(i + 1, -1)
        : t.stops.slice(1, Math.max(i, 1));
    return {
      tripId: t.id,
      stopId: s.id,
      station: s.station,
      lineName: t.lineName,
      lineColor: t.lineColor,
      trainNumber: t.trainNumber,
      companyName: t.companyName,
      origin: t.origin,
      destination: t.destination,
      scheduledTime: s["scheduled" + kind],
      expectedTime: s["expected" + kind],
      actualTime: s["actual" + kind],
      delaySeconds: s[kind.toLowerCase() + "DelaySeconds"],
      scheduledPlatform: s.scheduledPlatform,
      expectedPlatform: s.expectedPlatform,
      platformChanged:
        !!s.expectedPlatform &&
        !!s.scheduledPlatform &&
        s.expectedPlatform !== s.scheduledPlatform,
      via: pickVia(around, importance),
      cancelled: t.status === "CANCELLED" || s.cancelled,
      reasonCode: s.reasonCode,
    };
  }
  async board(id: string, q: any, kind: "Arrival" | "Departure") {
    const station = await this.station(id);
    const r = await this.range(q, station.country);
    const col =
      kind === "Arrival" ? "scheduled_arrival" : "scheduled_departure";
    const ids = await this.db.query(
      `SELECT DISTINCT trip_id FROM trip_stops WHERE station_id=$1 AND ${col}>=$2 AND ${col}<$3`,
      [id, r.from, r.to],
    );
    const trips = await this.details(ids.map((r) => r.trip_id));
    const importance = await this.importance(
      trips.flatMap((t) => t.stops.map((x) => x.station.id)),
    );
    const entries = trips
      .flatMap((t) =>
        t.stops
          .filter(
            (s) =>
              s.station.id === id &&
              s[("scheduled" + kind) as keyof typeof s] &&
              ms((s as any)["scheduled" + kind]) >= ms(r.from) &&
              ms((s as any)["scheduled" + kind]) < ms(r.to),
          )
          .map((s) => this.boardEntry(t, s, kind, importance)),
      )
      .sort(
        (a, b) =>
          ms(a.scheduledTime) - ms(b.scheduledTime) ||
          a.stopId.localeCompare(b.stopId),
      );
    return paginate(entries, q);
  }
  /** Umstiegszeit zum vorherigen Abschnitt nach Echtzeit; knapp + verspäteter Zubringer = gefährdet. */
  transfer(prev: any, departure: number) {
    if (!prev) return { transferSeconds: null, transferAtRisk: false };
    const arrival = ms(prev.to.expectedTime ?? prev.to.scheduledTime);
    const transferSeconds = Math.round((departure - arrival) / 1000);
    return {
      transferSeconds,
      transferAtRisk:
        transferSeconds < MIN_TRANSFER_SECONDS ||
        (transferSeconds < RISKY_TRANSFER_SECONDS &&
          (prev.to.delaySeconds ?? 0) > 0),
    };
  }
  async connections(q: any) {
    const origin = await this.station(q.fromStationId);
    await this.station(q.toStationId);
    if (q.fromStationId === q.toStationId)
      fail(400, "VALIDATION_FAILED", "Origin and destination must differ.");
    await this.range(
      {
        from: q.departAfter,
        to: new Date(ms(q.departAfter) + 1).toISOString(),
      },
      origin.country,
    );
    const ids = await this.db.query(
      `SELECT DISTINCT trip_id FROM trip_stops WHERE scheduled_departure >= $1::timestamptz - interval '1 day' AND scheduled_departure < $1::timestamptz + interval '3 days'`,
      [q.departAfter],
    );
    const trips = (await this.details(ids.map((r) => r.trip_id))).filter(
      (t) => t.status !== "CANCELLED",
    );
    const importance = await this.importance(
      trips.flatMap((t) => t.stops.map((x) => x.station.id)),
    );
    const byStation = new Map<string, any[]>();
    for (const t of trips)
      for (let i = 0; i < t.stops.length - 1; i++) {
        const s = t.stops[i];
        if (!s.cancelled && s.scheduledDeparture)
          byStation.set(s.station.id, [
            ...(byStation.get(s.station.id) ?? []),
            { t, i },
          ]);
      }
    const results: any[] = [];
    let examined = 0;
    const walk = (
      stationId: string,
      earliest: number,
      legs: any[],
      seen: Set<string>,
    ) => {
      for (const { t, i } of byStation.get(stationId) ?? []) {
        if (++examined > 100000)
          fail(422, "SEARCH_TOO_BROAD", "Narrow your connection search.");
        if (seen.has(t.id)) continue;
        const a = t.stops[i],
          departure = ms(effective(a, "Departure"));
        if (
          departure < earliest ||
          departure > ms(q.departAfter) + (legs.length ? 48 : 24) * 3600000
        )
          continue;
        for (let j = i + 1; j < t.stops.length; j++) {
          const b = t.stops[j];
          if (b.cancelled || !b.scheduledArrival) continue;
          const arrival = ms(effective(b, "Arrival"));
          if (arrival > ms(q.departAfter) + 48 * 3600000) continue;
          const leg = {
            tripId: t.id,
            lineName: t.lineName,
            lineColor: t.lineColor,
            trainNumber: t.trainNumber,
            from: this.boardEntry(t, a, "Departure", importance),
            to: this.boardEntry(t, b, "Arrival", importance),
            ...this.transfer(legs.at(-1), departure),
          };
          const path = [...legs, leg];
          if (b.station.id === q.toStationId) {
            const start = ms(
              path[0].from.expectedTime ?? path[0].from.scheduledTime,
            );
            results.push({
              id: createHash("sha256")
                .update(
                  path
                    .map((l) => l.tripId + l.from.stopId + l.to.stopId)
                    .join(":"),
                )
                .digest("hex")
                .slice(0, 32),
              departure: new Date(start).toISOString(),
              arrival: new Date(arrival).toISOString(),
              durationSeconds: (arrival - start) / 1000,
              transfers: path.length - 1,
              legs: path,
            });
          } else if (path.length <= q.maxTransfers)
            walk(
              b.station.id,
              arrival + 300000,
              path,
              new Set([...seen, t.id]),
            );
        }
      }
    };
    walk(q.fromStationId, ms(q.departAfter), [], new Set());
    return paginate(
      [...new Map(results.map((r) => [r.id, r])).values()].sort(
        (a, b) =>
          ms(a.departure) - ms(b.departure) ||
          ms(a.arrival) - ms(b.arrival) ||
          a.id.localeCompare(b.id),
      ),
      q,
    );
  }
  /** Aktive Störungen; ohne Bahnhof/Linie alle des Landes, sonst nur betroffene (und netzweite). */
  async disruptions(q: any) {
    const c = await this.country(q.country);
    const at = q.activeAt ?? new Date().toISOString();
    const rows = await this.db.query(
      `SELECT * FROM disruptions WHERE country=$1 AND valid_from<=$2 AND (valid_until IS NULL OR valid_until>$2)
       AND ($3::uuid IS NULL OR $3=ANY(station_ids) OR (cardinality(station_ids)=0 AND cardinality(line_ids)=0))
       AND ($4::uuid IS NULL OR $4=ANY(line_ids) OR (cardinality(station_ids)=0 AND cardinality(line_ids)=0))
       ORDER BY CASE severity WHEN 'SEVERE' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, valid_from DESC, id`,
      [c.code, at, q.stationId ?? null, q.lineId ?? null],
    );
    return paginate(rows.map(camel), q);
  }
}
