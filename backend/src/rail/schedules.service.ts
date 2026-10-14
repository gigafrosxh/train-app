import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { EntityManager } from "typeorm";
import { Database, camel } from "../database/database";
import { RailService } from "./rail.service";
import {
  addDays,
  localTime,
  localToday,
  operates,
  chronological,
} from "./time";
import { fail } from "../common/errors";
@Injectable()
export class SchedulesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    @Inject(Database) private db: Database,
    @Inject(RailService) private rail: RailService,
  ) {}
  async onModuleInit() {
    if (process.env.DISABLE_JOBS === "true") return;
    await this.generate();
    this.timer = setInterval(
      () =>
        this.generate().catch((e) =>
          console.error("Schedule generation failed", e.message),
        ),
      60000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async validate(s: any, m: EntityManager) {
    if (s.validUntil < s.validFrom || s.validUntil > addDays(s.validFrom, 730))
      fail(
        400,
        "VALIDATION_FAILED",
        "Schedule validity must be 0 to 730 days.",
      );
    if (
      new Set(s.weekdays).size !== s.weekdays.length ||
      new Set(s.exceptions.map((e: any) => e.date)).size !== s.exceptions.length
    )
      fail(400, "VALIDATION_FAILED", "Duplicate calendar entries.");
    const r = await this.rail.route(s.routeId, m);
    if (
      s.stops.length !== r.stops.length ||
      s.stops.some((v: any, i: number) => v.routeStopId !== r.stops[i].id)
    )
      fail(400, "VALIDATION_FAILED", "Schedule stops must match route order.");
    await this.validateTrain(s.trainId, s.routeId, m);
    for (let day = s.validFrom; day <= s.validUntil; day = addDays(day, 1))
      if (operates(s, day)) this.times(s, day);
  }
  times(s: any, day: string) {
    const values = s.stops.map((t: any) => ({
      routeStopId: t.routeStopId,
      scheduledArrival:
        t.arrivalOffsetSeconds === null
          ? null
          : localTime(
              day,
              t.arrivalOffsetSeconds,
              s.timeZone,
              s.dstDisambiguation,
            ),
      scheduledDeparture:
        t.departureOffsetSeconds === null
          ? null
          : localTime(
              day,
              t.departureOffsetSeconds,
              s.timeZone,
              s.dstDisambiguation,
            ),
    }));
    chronological(values);
    return values;
  }
  async validateTrain(trainId: string, routeId: string, m: EntityManager) {
    const [r] = await m.query(
      "SELECT tr.active,tr.company_id=l.company_id AS matches FROM trains tr CROSS JOIN routes r JOIN lines l ON l.id=r.line_id WHERE tr.id=$1 AND r.id=$2",
      [trainId, routeId],
    );
    if (!r || !r.active || !r.matches)
      fail(
        400,
        "TRAIN_ROUTE_MISMATCH",
        "Choose an active train from the route company.",
      );
  }
  async special(d: any, m: EntityManager) {
    await this.validateTrain(d.trainId, d.routeId, m);
    const route = await this.rail.route(d.routeId, m);
    if (
      d.stops.length !== route.stops.length ||
      d.stops.some((s: any, i: number) => s.routeStopId !== route.stops[i].id)
    )
      fail(400, "VALIDATION_FAILED", "Stops must match the route order.");
    chronological(d.stops);
    const [t] = await m.query(
      "INSERT INTO trips(route_id,train_id,service_date) VALUES($1,$2,$3) RETURNING id",
      [d.routeId, d.trainId, d.serviceDate],
    );
    await this.writeStops(t.id, route, d.stops, m);
    return this.rail.trip(t.id, m);
  }
  private async writeStops(
    id: string,
    route: any,
    times: any[],
    m: EntityManager,
  ) {
    for (let i = 0; i < times.length; i++) {
      const s = times[i],
        r = route.stops[i];
      await m.query(
        `INSERT INTO trip_stops(trip_id,route_stop_id,station_id,sequence,scheduled_arrival,scheduled_departure) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(trip_id,sequence) DO UPDATE SET scheduled_arrival=EXCLUDED.scheduled_arrival,scheduled_departure=EXCLUDED.scheduled_departure,version=trip_stops.version+1`,
        [
          id,
          r.id,
          r.station.id,
          r.sequence,
          s.scheduledArrival,
          s.scheduledDeparture,
        ],
      );
    }
  }
  async regenerate(s: any, m: EntityManager) {
    const existing = await m.query(
      `SELECT t.id FROM trips t WHERE t.schedule_id=$1 AND EXISTS(SELECT 1 FROM trip_stops st WHERE st.trip_id=t.id AND st.scheduled_departure>now()) AND NOT EXISTS(SELECT 1 FROM trip_stops st WHERE st.trip_id=t.id AND st.scheduled_departure<=now()) FOR UPDATE`,
      [s.id],
    );
    for (const t of existing) {
      const [blocked] = await m.query(
        "SELECT EXISTS(SELECT 1 FROM tickets WHERE trip_id=$1) OR EXISTS(SELECT 1 FROM trips WHERE id=$1 AND version>1) OR EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=$1 AND (arrival_override OR departure_override)) AS blocked",
        [t.id],
      );
      if (blocked.blocked)
        fail(
          409,
          "SCHEDULE_CHANGE_CONFLICT",
          "A future trip has tickets or operational changes.",
        );
    }
    // Keep existing trip and stop identifiers, updating only untouched future instances.
    const route = await this.rail.route(s.routeId, m);
    for (const t of existing) {
      const [raw] = await m.query(
        "SELECT service_date::text FROM trips WHERE id=$1",
        [t.id],
      );
      const day = raw.service_date;
      if (day < s.validFrom || day > s.validUntil || !operates(s, day)) {
        await m.query(
          "UPDATE trips SET cancelled=true,version=version+1 WHERE id=$1",
          [t.id],
        );
        continue;
      }
      const [old] = await m.query(
        "SELECT array_agg(route_stop_id ORDER BY sequence) AS ids FROM trip_stops WHERE trip_id=$1",
        [t.id],
      );
      if (
        JSON.stringify(old.ids) !==
        JSON.stringify(route.stops.map((r: any) => r.id))
      )
        fail(
          409,
          "SCHEDULE_CHANGE_CONFLICT",
          "Changing route stops requires a new schedule.",
        );
      await this.writeStops(t.id, route, this.times(s, day), m);
      await m.query(
        "UPDATE trips SET train_id=$2,version=version+1,updated_at=now() WHERE id=$1",
        [t.id, s.trainId],
      );
    }
    await this.generateSchedule(s, m);
  }
  async generateSchedule(s: any, m: EntityManager) {
    const today = localToday(s.timeZone),
      route = await this.rail.route(s.routeId, m);
    for (let n = 0; n < 14; n++) {
      const day = addDays(today, n);
      if (day < s.validFrom || day > s.validUntil || !operates(s, day))
        continue;
      const times = this.times(s, day);
      const [t] = await m.query(
        "INSERT INTO trips(route_id,train_id,schedule_id,service_date) VALUES($1,$2,$3,$4) ON CONFLICT(schedule_id,service_date) DO NOTHING RETURNING id",
        [s.routeId, s.trainId, s.id, day],
      );
      if (t) await this.writeStops(t.id, route, times, m);
    }
  }
  async generate() {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.transaction(async (m) => {
        await m.query("SELECT pg_advisory_xact_lock(7319001)");
        for (const raw of await m.query(
          "SELECT *,valid_from::text,valid_until::text FROM schedules",
        ))
          await this.generateSchedule(camel(raw), m);
      });
    } finally {
      this.running = false;
    }
  }
}
