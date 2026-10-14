import { Inject, Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { Database, audit, camel } from "../database/database";
import { RailService, ms } from "../rail/rail.service";
import { chronological } from "../rail/time";
import { Events } from "../common/events";
import { fail } from "../common/errors";
@Injectable()
export class OperationsService {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(RailService) private rail: RailService,
    @Inject(Events) private events: Events,
  ) {}
  async authorize(m: EntityManager, user: any, tripId: string) {
    if (user.role === "ADMIN") return;
    if (user.role !== "WORKER")
      fail(403, "AUTH_FORBIDDEN", "Worker access required.");
    const rows = await m.query(
      `SELECT a.id FROM worker_assignments a JOIN trips t ON t.id=$2 JOIN trains tr ON tr.id=t.train_id WHERE a.worker_id=$1 AND (a.train_id=t.train_id OR a.company_id=tr.company_id) AND (a.valid_from IS NULL OR a.valid_from<=now()) AND (a.valid_until IS NULL OR a.valid_until>now()) FOR SHARE OF a`,
      [user.id, tripId],
    );
    if (!rows.length)
      fail(403, "TRAIN_NOT_ASSIGNED", "This train is not assigned to you.");
  }
  async update(id: string, d: any, user: any, stopId?: string) {
    const result = await this.db.transaction(async (m) => {
      const [t] = await m.query("SELECT * FROM trips WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (!t) fail(404, "TRIP_NOT_FOUND", "Trip not found.");
      await this.authorize(m, user, id);
      const trip = await this.rail.trip(id, m);
      if (trip.status === "COMPLETED")
        fail(409, "TRIP_COMPLETED", "Completed trips cannot be edited.");
      if (stopId) {
        const [raw] = await m.query(
          "SELECT * FROM trip_stops WHERE id=$1 AND trip_id=$2 FOR UPDATE",
          [stopId, id],
        );
        if (!raw) fail(404, "STOP_NOT_FOUND", "Stop not found.");
        if (raw.version !== d.version)
          fail(
            409,
            "TRIP_VERSION_CONFLICT",
            "The stop was changed. Reload it.",
          );
        const sets: string[] = [];
        const vals: any[] = [];
        for (const key of [
          "expectedArrival",
          "expectedDeparture",
          "expectedPlatform",
          "cancelled",
          "reasonCode",
          "reasonText",
        ])
          if (d[key] !== undefined) {
            if (
              (key === "expectedArrival" && !raw.scheduled_arrival) ||
              (key === "expectedDeparture" && !raw.scheduled_departure)
            )
              fail(
                400,
                "VALIDATION_FAILED",
                "This stop has no scheduled event of that kind.",
              );
            let value = d[key];
            if (key === "expectedArrival" || key === "expectedDeparture") {
              const kind = key === "expectedArrival" ? "arrival" : "departure";
              if (raw["actual_" + kind])
                fail(
                  409,
                  "STOP_ALREADY_REPORTED",
                  "An actual time was already recorded.",
                );
              sets.push(kind + "_override=" + String(value !== null));
              if (value === null && t.delay_seconds)
                value = new Date(
                  ms(raw["scheduled_" + kind]) + t.delay_seconds * 1000,
                ).toISOString();
            }
            vals.push(value);
            sets.push(
              key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()) +
                "=$" +
                vals.length,
            );
          }
        vals.push(stopId);
        await m.query(
          "UPDATE trip_stops SET " +
            sets.concat("version=version+1").join(",") +
            " WHERE id=$" +
            vals.length,
          vals,
        );
      } else {
        if (t.version !== d.version)
          fail(
            409,
            "TRIP_VERSION_CONFLICT",
            "The trip was changed. Reload it.",
          );
        await m.query(
          "UPDATE trips SET delay_seconds=COALESCE($2,delay_seconds),cancelled=COALESCE($3,cancelled),reason_code=CASE WHEN $4 THEN $5 ELSE reason_code END,reason_text=CASE WHEN $6 THEN $7 ELSE reason_text END WHERE id=$1",
          [
            id,
            d.delaySeconds ?? null,
            d.cancelled ?? null,
            d.reasonCode !== undefined,
            d.reasonCode ?? null,
            d.reasonText !== undefined,
            d.reasonText ?? null,
          ],
        );
        if (d.delaySeconds !== undefined)
          await m.query(
            `UPDATE trip_stops SET expected_arrival=CASE WHEN NOT arrival_override AND actual_arrival IS NULL AND scheduled_arrival>now() THEN scheduled_arrival+($2 * interval '1 second') ELSE expected_arrival END,expected_departure=CASE WHEN NOT departure_override AND actual_departure IS NULL AND scheduled_departure>now() THEN scheduled_departure+($2 * interval '1 second') ELSE expected_departure END,reason_code=CASE WHEN $3 THEN $4 ELSE reason_code END,reason_text=CASE WHEN $5 THEN $6 ELSE reason_text END,version=version+1 WHERE trip_id=$1 AND COALESCE(scheduled_departure,scheduled_arrival)>now()`,
            [
              id,
              d.delaySeconds,
              d.reasonCode !== undefined,
              d.reasonCode ?? null,
              d.reasonText !== undefined,
              d.reasonText ?? null,
            ],
          );
      }
      await m.query(
        "UPDATE trips SET version=version+1,updated_at=now() WHERE id=$1",
        [id],
      );
      const updated = await this.rail.trip(id, m);
      chronological(updated.stops, true);
      await audit(
        m,
        user.id,
        stopId ? "stop.update" : "trip.update",
        stopId ?? id,
        d,
      );
      return updated;
    });
    this.events.emit("trip.updated", result);
    return stopId ? result.stops.find((s: any) => s.id === stopId) : result;
  }
}
