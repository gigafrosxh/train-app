import { Inject, Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import { Database, camel, audit } from "../database/database";
import { RailService } from "../rail/rail.service";
import { SchedulesService } from "../rail/schedules.service";
import { Events } from "../common/events";
import { fail } from "../common/errors";
import { paginate } from "../common/validation";
import { publicUser } from "../auth/auth.service";
const columns: Record<string, string[]> = {
  companies: ["name", "code", "country"],
  stations: ["name", "code", "country", "timeZone"],
  trains: ["companyId", "trainNumber", "name", "type", "active"],
  lines: ["companyId", "name", "code", "color"],
  tracks: ["country", "name", "usage", "electrified"],
  routes: ["lineId", "name", "direction"],
  schedules: [
    "routeId",
    "trainId",
    "timeZone",
    "validFrom",
    "validUntil",
    "weekdays",
    "stops",
    "exceptions",
    "dstDisambiguation",
  ],
  "worker-assignments": [
    "workerId",
    "scope",
    "trainId",
    "companyId",
    "validFrom",
    "validUntil",
  ],
};
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const table = (resource: string) =>
  resource === "worker-assignments" ? "worker_assignments" : resource;
@Injectable()
export class AdminService {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(RailService) private rail: RailService,
    @Inject(SchedulesService) private schedules: SchedulesService,
    @Inject(Events) private events: Events,
  ) {}
  async get(
    resource: string,
    id: string,
    m: EntityManager = this.db.manager,
  ): Promise<any> {
    if (resource === "routes") return this.rail.route(id, m);
    if (resource === "trips") return this.rail.trip(id, m);
    if (resource === "worker-assignments") {
      const rows = await this.assignments(
        { page: 1, pageSize: 100 },
        undefined,
        m,
        id,
      );
      if (!rows.items[0])
        fail(404, "RESOURCE_NOT_FOUND", "Assignment not found.");
      return rows.items[0];
    }
    const geo =
      resource === "stations"
        ? ",ST_AsGeoJSON(coordinates)::json AS point"
        : resource === "tracks"
          ? ",ST_AsGeoJSON(geometry)::json AS shape"
          : "";
    const [r] = await m.query(
      `SELECT *${geo} FROM ${table(resource)} WHERE id=$1`,
      [id],
    );
    if (!r) fail(404, "RESOURCE_NOT_FOUND", "Record not found.");
    const v = camel(r);
    if (resource === "users")
      return {
        ...publicUser(r),
        status: r.status,
        createdAt: v.createdAt,
        lastLoginAt: v.lastLoginAt,
        version: v.version,
      };
    if (v.point) {
      v.coordinates = v.point.coordinates;
      delete v.point;
    }
    if (v.shape) {
      v.geometry = v.shape;
      delete v.shape;
    }
    delete v.sourceId;
    return v;
  }
  async list(resource: string, q: any) {
    if (resource === "trips") return this.rail.trips(q);
    if (resource === "worker-assignments") return this.assignments(q);
    const rows = await this.db.query(
      `SELECT id FROM ${table(resource)} ORDER BY id`,
    );
    let data = await Promise.all(rows.map((r) => this.get(resource, r.id)));
    data = data.filter(
      (r) =>
        (!q.country || !r.country || r.country === q.country) &&
        (!q.companyId || r.companyId === q.companyId) &&
        (!q.role || r.role === q.role) &&
        (!q.status || r.status === q.status) &&
        (!q.q ||
          [r.name, r.email, r.displayName, r.trainNumber, r.code].some((v) =>
            v?.toLowerCase().includes(q.q.toLowerCase()),
          )),
    );
    return paginate(data, q);
  }
  async save(resource: string, d: any, actor: string, id?: string) {
    const result = await this.db.transaction(async (m) => {
      if (resource === "trips") {
        if (id)
          fail(
            400,
            "VALIDATION_FAILED",
            "Use operations endpoints to edit trips.",
          );
        const r = await this.schedules.special(d, m);
        await audit(m, actor, "trips.create", r.id);
        return r;
      }
      let current: any;
      if (id) {
        const [lock] = await m.query(
          `SELECT version FROM ${table(resource)} WHERE id=$1 FOR UPDATE`,
          [id],
        );
        if (!lock) fail(404, "RESOURCE_NOT_FOUND", "Record not found.");
        if (lock.version !== d.version)
          fail(409, "VERSION_CONFLICT", "The record was changed. Reload it.");
        current = await this.get(resource, id, m);
      }
      const input = { ...current, ...d };
      if (resource === "schedules") await this.schedules.validate(input, m);
      if (resource === "worker-assignments") {
        const [worker] = await m.query(
          "SELECT id FROM users WHERE id=$1 AND role='WORKER'",
          [input.workerId],
        );
        if (!worker) fail(400, "VALIDATION_FAILED", "Choose a worker.");
        if (
          (input.scope === "TRAIN" &&
            (!input.trainId || (!id && input.companyId))) ||
          (input.scope === "COMPANY" && (!input.companyId || input.trainId))
        )
          fail(
            400,
            "VALIDATION_FAILED",
            "Choose exactly the target required by scope.",
          );
        if (
          input.validFrom &&
          input.validUntil &&
          input.validUntil <= input.validFrom
        )
          fail(400, "VALIDATION_FAILED", "Assignment end must follow start.");
      }
      if (resource === "routes") {
        if (
          new Set(input.stops.map((s: any) => s.sequence)).size !==
          input.stops.length
        )
          fail(400, "VALIDATION_FAILED", "Stop sequence must be unique.");
        if (id && d.stops) {
          const [used] = await m.query(
            "SELECT EXISTS(SELECT 1 FROM schedules WHERE route_id=$1) AS used",
            [id],
          );
          const previous = current.stops.map((s: any) => ({
            id: s.id,
            stationId: s.station.id,
            sequence: s.sequence,
          }));
          if (used.used && JSON.stringify(previous) !== JSON.stringify(d.stops))
            fail(
              409,
              "ROUTE_CHANGE_CONFLICT",
              "Create a new route for a schedule with changed stops.",
            );
        }
      }
      const fields = columns[resource].filter((k) => d[k] !== undefined);
      const values = fields.map((k) =>
        ["stops", "exceptions"].includes(k) ? JSON.stringify(d[k]) : d[k],
      );
      let names = fields.map(snake),
        expressions = values.map((_, i) => "$" + (i + 1));
      if (resource === "stations" && d.coordinates) {
        values.push(d.coordinates[0], d.coordinates[1]);
        names.push("coordinates");
        expressions.push(
          `ST_SetSRID(ST_MakePoint($${values.length - 1},$${values.length}),4326)`,
        );
      }
      if (resource === "tracks" && d.geometry) {
        values.push(JSON.stringify(d.geometry));
        names.push("geometry");
        expressions.push(
          `ST_SetSRID(ST_GeomFromGeoJSON($${values.length}),4326)`,
        );
      }
      let row: any;
      if (id) {
        values.push(id);
        [[row]] = await m.query(
          `UPDATE ${table(resource)} SET ${names
            .map((n, i) => n + "=" + expressions[i])
            .concat("version=version+1")
            .join(",")} WHERE id=$${values.length} RETURNING id`,
          values,
        );
      } else
        [row] = await m.query(
          `INSERT INTO ${table(resource)} (${names.join(",")}) VALUES(${expressions.join(",")}) RETURNING id`,
          values,
        );
      if (resource === "routes") {
        if (d.stops) {
          const old = new Set((current?.stops ?? []).map((s: any) => s.id));
          const assigned = d.stops.map((s: any) => {
            if (s.id && !old.has(s.id))
              fail(
                400,
                "VALIDATION_FAILED",
                "Stop does not belong to this route.",
              );
            return { ...s, id: s.id ?? randomUUID() };
          });
          await m.query(
            "DELETE FROM route_stops WHERE route_id=$1 AND NOT(id=ANY($2::uuid[]))",
            [row.id, assigned.map((s: any) => s.id)],
          );
          for (const s of assigned)
            await m.query(
              "INSERT INTO route_stops(id,route_id,station_id,sequence) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET station_id=$3,sequence=$4",
              [s.id, row.id, s.stationId, s.sequence],
            );
        }
        if (d.trackIds) {
          await m.query("DELETE FROM route_tracks WHERE route_id=$1", [row.id]);
          for (let i = 0; i < d.trackIds.length; i++)
            await m.query("INSERT INTO route_tracks VALUES($1,$2,$3)", [
              row.id,
              d.trackIds[i],
              i,
            ]);
        }
      }
      const saved = await this.get(resource, row.id, m);
      if (resource === "schedules") {
        if (id) await this.schedules.regenerate(saved, m);
        else await this.schedules.generateSchedule(saved, m);
      }
      await audit(m, actor, resource + (id ? ".update" : ".create"), row.id);
      return saved;
    });
    if (resource === "schedules") this.events.emit("schedule.updated", result);
    return result;
  }
  async remove(resource: string, id: string, version: number, actor: string) {
    await this.db.transaction(async (m) => {
      const [r] = await m.query(
        `SELECT version FROM ${table(resource)} WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!r) fail(404, "RESOURCE_NOT_FOUND", "Record not found.");
      if (r.version !== version)
        fail(409, "VERSION_CONFLICT", "Reload the record before deleting.");
      if (resource === "trips") {
        const [started] = await m.query(
          "SELECT EXISTS(SELECT 1 FROM trip_stops WHERE trip_id=$1 AND scheduled_departure<=now()) AS yes",
          [id],
        );
        if (started.yes)
          fail(409, "RESOURCE_IN_USE", "Historical trips cannot be deleted.");
      }
      await m.query(`DELETE FROM ${table(resource)} WHERE id=$1`, [id]);
      await audit(m, actor, resource + ".delete", id);
    });
  }
  async assignments(
    q: any,
    workerId?: string,
    m: EntityManager = this.db.manager,
    id?: string,
  ) {
    const rows = await m.query(
      `SELECT a.*,u.display_name AS worker_name,tr.train_number,COALESCE(a.company_id,tr.company_id) AS company_id,c.name AS company_name FROM worker_assignments a JOIN users u ON u.id=a.worker_id LEFT JOIN trains tr ON tr.id=a.train_id LEFT JOIN companies c ON c.id=COALESCE(a.company_id,tr.company_id) WHERE ($1::uuid IS NULL OR a.worker_id=$1) AND ($2::uuid IS NULL OR COALESCE(a.company_id,tr.company_id)=$2) AND ($3::uuid IS NULL OR a.train_id=$3) AND ($4::uuid IS NULL OR a.id=$4) ORDER BY a.id`,
      [
        workerId ?? q.workerId ?? null,
        q.companyId ?? null,
        q.trainId ?? null,
        id ?? null,
      ],
    );
    return paginate(rows.map(camel), q);
  }
  async createUser(d: any, actor: string) {
    const hash = await argon2.hash(d.temporaryPassword);
    const id = await this.db.transaction(async (m) => {
      const [r] = await m.query(
        "INSERT INTO users(email,password_hash,display_name,role,must_change_password) VALUES($1,$2,$3,$4,true) RETURNING id",
        [d.email.toLowerCase(), hash, d.displayName, d.role],
      );
      await audit(m, actor, "users.create", r.id);
      return r.id;
    });
    return this.get("users", id);
  }
  async patchUser(id: string, d: any, actor: string) {
    await this.db.transaction(async (m) => {
      await m.query("SELECT pg_advisory_xact_lock(7319002)");
      const [r] = await m.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (!r) fail(404, "RESOURCE_NOT_FOUND", "User not found.");
      if (r.version !== d.version)
        fail(409, "VERSION_CONFLICT", "User was changed.");
      if (
        id === actor &&
        ((d.role && d.role !== "ADMIN") || d.status === "LOCKED")
      )
        fail(
          409,
          "USER_SELF_MODIFICATION",
          "You cannot remove your own administrator access.",
        );
      if (
        r.role === "ADMIN" &&
        ((d.role && d.role !== "ADMIN") || d.status === "LOCKED")
      ) {
        const [count] = await m.query(
          "SELECT count(*)::int AS n FROM users WHERE role='ADMIN' AND status='ACTIVE'",
        );
        if (count.n <= 1)
          fail(
            409,
            "LAST_ADMIN_REQUIRED",
            "At least one active administrator is required.",
          );
      }
      await m.query(
        "UPDATE users SET role=COALESCE($2,role),status=COALESCE($3,status),display_name=COALESCE($4,display_name),version=version+1 WHERE id=$1",
        [id, d.role ?? null, d.status ?? null, d.displayName ?? null],
      );
      if (d.role || d.status)
        await m.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [
          id,
        ]);
      await audit(m, actor, "users.update", id);
    });
    return this.get("users", id);
  }
}
