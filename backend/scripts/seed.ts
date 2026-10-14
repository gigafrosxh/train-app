import { connect, source, Database } from "../src/database/database";
import { RailService } from "../src/rail/rail.service";
import { SchedulesService } from "../src/rail/schedules.service";
import { localToday, addDays } from "../src/rail/time";
import * as argon2 from "argon2";
import { createHash } from "node:crypto";
export function seedId(name: string) {
  const h = createHash("sha256")
    .update("train-app-demo:" + name)
    .digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-4" +
    h.slice(13, 16) +
    "-8" +
    h.slice(17, 20) +
    "-" +
    h.slice(20, 32)
  );
}
export async function seed() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeding is disabled in production");
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12)
    throw new Error("Set DEMO_PASSWORD (at least 12 characters)");
  await connect();
  const hash = await argon2.hash(password);
  await source.transaction(async (m) => {
    for (const role of ["USER", "WORKER", "ADMIN"])
      await m.query(
        "INSERT INTO users(id,email,password_hash,display_name,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          seedId(role),
          role.toLowerCase() + "@rail-demo.local",
          hash,
          "Demo " + role,
          role,
        ],
      );
    await m.query(
      "INSERT INTO companies(id,name,code,country) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [seedId("company"), "Alpenbahn (Demo)", "DEMO", "AT"],
    );
    const stations = [
      ["vie", "Wien Hauptbahnhof", "WIE", 16.378, 48.185],
      ["stp", "St. Pölten Hauptbahnhof", "STP", 15.6245, 48.2087],
      ["lnz", "Linz Hauptbahnhof", "LNZ", 14.2913, 48.29],
      ["szg", "Salzburg Hauptbahnhof", "SZG", 13.0458, 47.813],
    ];
    for (const [key, name, code, lng, lat] of stations)
      await m.query(
        "INSERT INTO stations(id,name,code,country,coordinates,time_zone) VALUES($1,$2,$3,'AT',ST_SetSRID(ST_MakePoint($4,$5),4326),'Europe/Vienna') ON CONFLICT DO NOTHING",
        [seedId(String(key)), name, code, lng, lat],
      );
    const trackIds = [];
    for (let i = 0; i < stations.length - 1; i++) {
      const id = seedId("track" + i);
      trackIds.push(id);
      const coords = [
        [stations[i][3], stations[i][4]],
        [stations[i + 1][3], stations[i + 1][4]],
      ];
      await m.query(
        "INSERT INTO tracks(id,country,name,usage,electrified,geometry,source,attribution) VALUES($1,'AT',$2,'main',true,ST_SetSRID(ST_GeomFromGeoJSON($3),4326),'DEMO_SYNTHETIC','Synthetic demo geometry — not an actual track alignment') ON CONFLICT DO NOTHING",
        [
          id,
          "Demo segment " + i,
          JSON.stringify({ type: "LineString", coordinates: coords }),
        ],
      );
    }
    for (let direction = 0; direction < 2; direction++) {
      const tr = seedId("train" + direction),
        line = seedId("line" + direction),
        route = seedId("route" + direction);
      await m.query(
        "INSERT INTO trains(id,company_id,train_number,name,type) VALUES($1,$2,$3,$4,'INTERCITY') ON CONFLICT DO NOTHING",
        [tr, seedId("company"), "RJ " + (60 + direction), "Demo Railjet"],
      );
      await m.query(
        "INSERT INTO lines(id,company_id,name,code,color) VALUES($1,$2,$3,$4,'#2563eb') ON CONFLICT DO NOTHING",
        [line, seedId("company"), "Westbahn Demo", "WEST" + direction],
      );
      await m.query(
        "INSERT INTO routes(id,line_id,name,direction) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [
          route,
          line,
          direction ? "Salzburg → Wien" : "Wien → Salzburg",
          String(direction),
        ],
      );
      const order = direction ? [...stations].reverse() : stations;
      for (let i = 0; i < order.length; i++)
        await m.query(
          "INSERT INTO route_stops(id,route_id,station_id,sequence) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
          [
            seedId("stop" + direction + i),
            route,
            seedId(String(order[i][0])),
            i,
          ],
        );
      for (let i = 0; i < trackIds.length; i++)
        await m.query(
          "INSERT INTO route_tracks VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [route, trackIds[direction ? trackIds.length - 1 - i : i], i],
        );
      for (let hour = 0; hour < 24; hour += 2) {
        const offsets = [0, 1800, 5400, 9000];
        const stops = order.map((_, i) => ({
          routeStopId: seedId("stop" + direction + i),
          arrivalOffsetSeconds: i === 0 ? null : hour * 3600 + offsets[i],
          departureOffsetSeconds:
            i === order.length - 1
              ? null
              : hour * 3600 + offsets[i] + (i === 0 ? 0 : 180),
        }));
        await m.query(
          "INSERT INTO schedules(id,route_id,train_id,time_zone,valid_from,valid_until,weekdays,stops,dst_disambiguation) VALUES($1,$2,$3,'Europe/Vienna',$4,$5,ARRAY[1,2,3,4,5,6,7],$6,'EARLIER') ON CONFLICT DO NOTHING",
          [
            seedId("schedule" + direction + hour),
            route,
            tr,
            localToday(),
            addDays(localToday(), 13),
            JSON.stringify(stops),
          ],
        );
      }
    }
    await m.query(
      "INSERT INTO worker_assignments(id,worker_id,scope,train_id) VALUES($1,$2,'TRAIN',$3) ON CONFLICT DO NOTHING",
      [seedId("assignment"), seedId("WORKER"), seedId("train0")],
    );
  });
  const db = new Database(),
    rail = new RailService(db);
  await new SchedulesService(db, rail).generate();
  const rows = await source.query(
    `SELECT t.id FROM trips t JOIN trip_stops s ON s.trip_id=t.id WHERE s.sequence=0 AND s.scheduled_departure>now() ORDER BY s.scheduled_departure LIMIT 1`,
  );
  if (rows[0]) {
    const t = await rail.trip(rows[0].id),
      a = t.stops[0],
      b = t.stops.at(-1)!;
    await source.query(
      "INSERT INTO tickets(id,user_id,reference,product_name,company_id,trip_id,boarding_stop_id,alighting_stop_id,origin_station_id,destination_station_id,valid_from,valid_until,travel_class,verified,qr_payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,2,false,$13) ON CONFLICT DO NOTHING",
      [
        seedId("ticket"),
        seedId("USER"),
        "DEMO-2026-001",
        "Demo Einzelfahrt",
        seedId("company"),
        t.id,
        a.id,
        b.id,
        a.station.id,
        b.station.id,
        new Date(Date.parse(a.scheduledDeparture!) - 3600000).toISOString(),
        new Date(Date.parse(b.scheduledArrival!) + 3600000).toISOString(),
        "DEMO ONLY – NOT VALID FOR TRAVEL",
      ],
    );
    await source.query(
      "INSERT INTO recent_trips(user_id,trip_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [seedId("USER"), t.id],
    );
  }
  console.log(
    "Demo data seeded. Accounts and password location are documented in README.md.",
  );
}
if (require.main === module)
  seed()
    .then(() => source.destroy())
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
