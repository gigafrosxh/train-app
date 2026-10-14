import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { ApiTags, ApiHeader } from "@nestjs/swagger";
import { Public } from "../auth/security";
import { digest } from "../auth/auth.service";
import { Database } from "../database/database";
import { BodyDoc, Validate } from "../common/validation";
import { positionInput } from "./map.schemas";
import { fail } from "../common/errors";
import { MapService } from "./map.service";
import { distance } from "./geometry";
@ApiTags("Train telemetry")
@Public()
@Controller("ingestion")
export class IngestionController {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(MapService) private map: MapService,
  ) {}
  @Post("positions")
  @HttpCode(204)
  @BodyDoc(positionInput)
  @ApiHeader({
    name: "Authorization",
    description: "Bearer device token, restricted to one train",
  })
  async position(@Req() r: any, @Body(new Validate(positionInput)) d: any) {
    const token = (r.headers.authorization ?? "").replace(/^Bearer /, "");
    const client = await this.db.one(
      "SELECT * FROM ingestion_clients WHERE token_hash=$1 AND active=true",
      [digest(token)],
    );
    if (!client) fail(401, "DEVICE_UNAUTHORIZED", "Invalid device token.");
    const time = Date.parse(d.observedAt);
    if (time > Date.now() + 30000 || time < Date.now() - 300000)
      fail(400, "POSITION_TIMESTAMP_INVALID", "Position must be recent.");
    await this.db.transaction(async (m) => {
      const [trip] = await m.query(
        "SELECT train_id FROM trips WHERE id=$1 FOR UPDATE",
        [d.tripId],
      );
      if (!trip || trip.train_id !== client.train_id)
        fail(
          403,
          "TRAIN_NOT_ASSIGNED",
          "Device is not assigned to this train.",
        );
      const [old] = await m.query(
        "SELECT observed_at,ST_X(coordinates) AS lng,ST_Y(coordinates) AS lat FROM positions WHERE trip_id=$1",
        [d.tripId],
      );
      if (old) {
        const dt = (time - new Date(old.observed_at).getTime()) / 1000;
        if (dt <= 0)
          fail(
            409,
            "POSITION_OUT_OF_ORDER",
            "A newer position already exists.",
          );
        if (distance([old.lng, old.lat], d.coordinates) / dt > 120)
          fail(
            400,
            "POSITION_IMPLAUSIBLE",
            "Position implies an implausible speed.",
          );
      }
      await m.query(
        `INSERT INTO positions(trip_id,coordinates,observed_at,bearing,source) VALUES($1,ST_SetSRID(ST_MakePoint($2,$3),4326),$4,$5,$6) ON CONFLICT(trip_id) DO UPDATE SET coordinates=EXCLUDED.coordinates,observed_at=EXCLUDED.observed_at,bearing=EXCLUDED.bearing,source=EXCLUDED.source,version=positions.version+1`,
        [
          d.tripId,
          ...d.coordinates,
          d.observedAt,
          d.bearing ?? null,
          "DEVICE:" + client.id,
        ],
      );
    });
    await this.map.refresh();
  }
}
