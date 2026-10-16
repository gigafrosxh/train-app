import { Inject, Injectable } from "@nestjs/common";
import { Database, camel } from "../database/database";
import { RailService, ref, ms, effective } from "../rail/rail.service";
import { fail } from "../common/errors";
import { publicUser } from "../auth/auth.service";
@Injectable()
export class AccountService {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(RailService) private rail: RailService,
  ) {}
  async profile(id: string, d: any) {
    const r = await this.db.one(
      "UPDATE users SET display_name=COALESCE($2,display_name),preferences=preferences||$3::jsonb,version=version+1 WHERE id=$1 RETURNING *",
      [id, d.displayName ?? null, JSON.stringify(d.preferences ?? {})],
    );
    return publicUser(r);
  }
  async tickets(userId: string) {
    const rows = await this.db.query(
      `SELECT t.*,c.name AS company_name,CASE WHEN os.id IS NULL THEN NULL ELSE json_build_object('id',os.id,'name',os.name,'code',os.code,'timeZone',os.time_zone) END AS origin,CASE WHEN ds.id IS NULL THEN NULL ELSE json_build_object('id',ds.id,'name',ds.name,'code',ds.code,'timeZone',ds.time_zone) END AS destination FROM tickets t LEFT JOIN companies c ON c.id=t.company_id LEFT JOIN stations os ON os.id=t.origin_station_id LEFT JOIN stations ds ON ds.id=t.destination_station_id WHERE t.user_id=$1 ORDER BY t.valid_from,t.id`,
      [userId],
    );
    return rows.map((raw) => {
      const { userId, originStationId, destinationStationId, cancelled, ...r } =
        camel(raw);
      return {
        ...r,
        status: cancelled
          ? "CANCELLED"
          : ms(r.validUntil) < Date.now()
            ? "EXPIRED"
            : "ACTIVE",
      };
    });
  }
  async ticket(userId: string, id: string) {
    const r = (await this.tickets(userId)).find((t) => t.id === id);
    if (!r) fail(404, "TICKET_NOT_FOUND", "Ticket not found.");
    return r;
  }
  async create(userId: string, d: any) {
    if (ms(d.validUntil) <= ms(d.validFrom))
      fail(400, "VALIDATION_FAILED", "Ticket end must follow its start.");
    const result = await this.db.transaction(async (m) => {
      const v = { ...d };
      if (v.tripId) {
        await m.query("SELECT id FROM trips WHERE id=$1 FOR SHARE", [v.tripId]);
        const t = await this.rail.trip(v.tripId, m);
        const a = t.stops.find(
            (s) => s.id === (v.boardingStopId ?? t.stops[0].id),
          ),
          b = t.stops.find(
            (s) => s.id === (v.alightingStopId ?? t.stops.at(-1)!.id),
          );
        if (
          !a ||
          !b ||
          a.sequence >= b.sequence ||
          !a.scheduledDeparture ||
          !b.scheduledArrival
        )
          fail(
            400,
            "VALIDATION_FAILED",
            "Choose valid boarding and alighting stops.",
          );
        if (
          (v.companyId && v.companyId !== t.companyId) ||
          (v.originStationId && v.originStationId !== a.station.id) ||
          (v.destinationStationId && v.destinationStationId !== b.station.id)
        )
          fail(
            400,
            "VALIDATION_FAILED",
            "Ticket does not match the chosen trip.",
          );
        if (
          ms(v.validFrom) > ms(a.scheduledDeparture) ||
          ms(v.validUntil) < ms(b.scheduledArrival)
        )
          fail(
            400,
            "VALIDATION_FAILED",
            "Ticket validity must cover the chosen trip section.",
          );
        Object.assign(v, {
          companyId: t.companyId,
          boardingStopId: a.id,
          alightingStopId: b.id,
          originStationId: a.station.id,
          destinationStationId: b.station.id,
        });
      } else if (v.boardingStopId || v.alightingStopId)
        fail(400, "VALIDATION_FAILED", "Stop IDs require a trip.");
      const keys = [
        "reference",
        "productName",
        "companyId",
        "tripId",
        "boardingStopId",
        "alightingStopId",
        "originStationId",
        "destinationStationId",
        "validFrom",
        "validUntil",
        "travelClass",
        "qrPayload",
      ];
      const [r] = await m.query(
        "INSERT INTO tickets(user_id," +
          keys
            .map((k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()))
            .join(",") +
          ") VALUES(" +
          Array.from({ length: keys.length + 1 }, (_, i) => "$" + (i + 1)).join(
            ",",
          ) +
          ") RETURNING id",
        [userId, ...keys.map((k) => v[k] ?? null)],
      );
      return r.id;
    });
    return this.ticket(userId, result);
  }
  async remove(userId: string, id: string) {
    const r = await this.db.query(
      "DELETE FROM tickets WHERE id=$1 AND user_id=$2 RETURNING id",
      [id, userId],
    );
    if (!r.length) fail(404, "TICKET_NOT_FOUND", "Ticket not found.");
  }
  async recent(id: string) {
    const r = await this.db.query(
      "SELECT trip_id FROM recent_trips WHERE user_id=$1 ORDER BY viewed_at DESC",
      [id],
    );
    const trips = await this.rail.details(r.map((x) => x.trip_id));
    return r
      .map((v) => trips.find((t) => t.id === v.trip_id))
      .filter(Boolean)
      .map(({ stops, ...t }: any) => t);
  }
  async viewed(id: string, d: any) {
    await this.rail.trip(d.tripId);
    await this.db.query(
      "INSERT INTO recent_trips(user_id,trip_id) VALUES($1,$2) ON CONFLICT(user_id,trip_id) DO UPDATE SET viewed_at=now()",
      [id, d.tripId],
    );
  }
  async dashboard(id: string) {
    const tickets = await this.tickets(id),
      active = tickets.filter((t) => t.status === "ACTIVE");
    const trips = await this.rail.details([
      ...new Set(active.map((t) => t.tripId).filter(Boolean)),
    ] as string[]);
    const candidates = active
      .flatMap((ticket) => {
        const t = trips.find((t) => t.id === ticket.tripId);
        if (!t || t.status === "CANCELLED") return [];
        const a = t.stops.find((s) => s.id === ticket.boardingStopId),
          b = t.stops.find((s) => s.id === ticket.alightingStopId);
        if (
          !a ||
          a.cancelled ||
          !b ||
          b.cancelled ||
          ms(effective(a, "Departure")) < Date.now()
        )
          return [];
        const { stops, ...summary } = t;
        return [
          {
            ...summary,
            ticketId: ticket.id,
            boardingStop: a,
            alightingStop: b,
          },
        ];
      })
      .sort(
        (a, b) =>
          ms(effective(a.boardingStop, "Departure")) -
          ms(effective(b.boardingStop, "Departure")),
      );
    const alerts: any[] = [];
    for (const t of trips) {
      if (
        ms(t.scheduledDeparture) > Date.now() + 7 * 86400000 ||
        ms(t.scheduledArrival) < Date.now()
      )
        continue;
      const updates = await this.db.one(
        "SELECT updated_at FROM trips WHERE id=$1",
        [t.id],
      );
      const reason = t.stops.find((s) => s.reasonCode);
      if (t.status === "CANCELLED" || t.delaySeconds > 0)
        alerts.push({
          id: t.id + ":" + t.version,
          tripId: t.id,
          code: t.status === "CANCELLED" ? "TRIP_CANCELLED" : "TRIP_DELAYED",
          severity: "WARNING",
          delaySeconds: t.delaySeconds,
          reasonCode: reason?.reasonCode ?? null,
          reasonText: reason?.reasonText ?? null,
          createdAt: new Date(updates.updated_at).toISOString(),
        });
      for (const s of t.stops)
        if (s.expectedPlatform && s.expectedPlatform !== s.scheduledPlatform)
          alerts.push({
            id: s.id + ":" + s.version,
            tripId: t.id,
            code: "PLATFORM_CHANGED",
            severity: "INFO",
            delaySeconds: null,
            reasonCode: null,
            reasonText: null,
            createdAt: new Date(updates.updated_at).toISOString(),
          });
    }
    return {
      nextTrip: candidates[0] ?? null,
      recentTrips: (await this.recent(id)).slice(0, 10),
      activeTickets: active.slice(0, 10),
      alerts: alerts
        .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
        .slice(0, 20),
    };
  }
  async deleteAccount(id: string) {
    await this.db.transaction(async (m) => {
      await m.query("SELECT pg_advisory_xact_lock(7319002)");
      const [u] = await m.query("SELECT role FROM users WHERE id=$1", [id]);
      if (u.role === "ADMIN") {
        const [n] = await m.query(
          "SELECT count(*)::int AS n FROM users WHERE role='ADMIN' AND status='ACTIVE'",
        );
        if (n.n <= 1)
          fail(
            409,
            "LAST_ADMIN_REQUIRED",
            "At least one administrator must remain.",
          );
      }
      await m.query("DELETE FROM users WHERE id=$1", [id]);
    });
  }
  /** Lieblingsbahnhöfe in Anzeigereihenfolge. */
  async favorites(userId: string) {
    const rows = await this.db.query(
      "SELECT s.id,s.name,s.code,s.time_zone FROM favorite_stations f JOIN stations s ON s.id=f.station_id WHERE f.user_id=$1 ORDER BY f.position,s.name",
      [userId],
    );
    return rows.map(ref);
  }
  async setFavorites(userId: string, stationIds: string[]) {
    if (new Set(stationIds).size !== stationIds.length)
      fail(400, "VALIDATION_FAILED", "Each station may appear only once.");
    await this.db.transaction(async (m) => {
      const known = await m.query("SELECT id FROM stations WHERE id=ANY($1)", [
        stationIds,
      ]);
      if (known.length !== stationIds.length)
        fail(400, "STATION_NOT_FOUND", "Station not found.", {
          fieldErrors: [
            {
              field: "stationIds",
              code: "STATION_NOT_FOUND",
              message: "Unknown station.",
            },
          ],
        });
      await m.query("DELETE FROM favorite_stations WHERE user_id=$1", [userId]);
      for (let i = 0; i < stationIds.length; i++)
        await m.query(
          "INSERT INTO favorite_stations(user_id,station_id,position) VALUES($1,$2,$3)",
          [userId, stationIds[i], i],
        );
    });
    return this.favorites(userId);
  }
}
