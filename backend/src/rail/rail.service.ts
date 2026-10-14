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
export const stationSql = `SELECT s.id,s.name,s.code,s.country,s.time_zone,s.version,ST_X(s.coordinates) AS lng,ST_Y(s.coordinates) AS lat FROM stations s`;
export const ref = (s: any) => ({
  id: s.id,
  name: s.name,
  code: s.code ?? null,
});
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
  async stations(q: any) {
    const c = await this.country(q.country);
    const rows = await this.db.query(
      stationSql +
        " WHERE s.country=$1 AND ($2::text IS NULL OR s.name ILIKE $2 OR s.code ILIKE $2) ORDER BY s.name,s.id",
      [c.code, q.q ? "%" + q.q + "%" : null],
    );
    return paginate(
      rows.map((r) => {
        const { lng, lat, ...v } = camel(r);
        return { ...v, coordinates: [lng, lat] };
      }),
      q,
    );
  }
  async station(id: string) {
    const r = await this.db.one(stationSql + " WHERE s.id=$1", [id]);
    if (!r) fail(404, "STATION_NOT_FOUND", "Station not found.");
    const { lng, lat, ...v } = camel(r);
    return { ...v, coordinates: [lng, lat] };
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
      "SELECT rs.id,rs.sequence,s.id AS station_id,s.name,s.code FROM route_stops rs JOIN stations s ON s.id=rs.station_id WHERE rs.route_id=$1 ORDER BY rs.sequence",
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
        station: { id: s.station_id, name: s.name, code: s.code },
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
      `SELECT t.*,tr.train_number,l.id AS line_id,l.name AS line_name,l.color AS line_color,c.id AS company_id,c.name AS company_name,c.country FROM trips t JOIN trains tr ON tr.id=t.train_id JOIN routes r ON r.id=t.route_id JOIN lines l ON l.id=r.line_id JOIN companies c ON c.id=l.company_id WHERE ($1::uuid[] IS NULL OR t.id=ANY($1)) ORDER BY t.service_date,t.id`,
      [ids ?? null],
    );
    if (!rows.length) return [];
    const stops: any[] = await m.query(
      "SELECT ts.*,s.name,s.code FROM trip_stops ts JOIN stations s ON s.id=ts.station_id WHERE ts.trip_id=ANY($1) ORDER BY ts.sequence",
      [rows.map((r) => r.id)],
    );
    const grouped = new Map<string, any[]>();
    for (const row of stops) {
      const s = camel(row);
      const v = {
        id: s.id,
        sequence: s.sequence,
        station: { id: s.stationId, name: s.name, code: s.code },
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
  boardEntry(t: any, s: any, kind: "Arrival" | "Departure") {
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
          .map((s) => this.boardEntry(t, s, kind)),
      )
      .sort(
        (a, b) =>
          ms(a.scheduledTime) - ms(b.scheduledTime) ||
          a.stopId.localeCompare(b.stopId),
      );
    return paginate(entries, q);
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
            from: this.boardEntry(t, a, "Departure"),
            to: this.boardEntry(t, b, "Arrival"),
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
}
