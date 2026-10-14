import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { Database, camel } from "../database/database";
import { fail } from "../common/errors";
import { coordinates } from "../common/validation";
import { geometry, usage } from "../rail/rail.schemas";
const feature = z.object({
  type: z.literal("Feature"),
  geometry: z.union([
    geometry,
    z.object({ type: z.literal("Point"), coordinates }),
  ]),
  properties: z.record(z.string(), z.unknown()),
});
@Injectable()
export class ImportsService implements OnModuleInit {
  constructor(@Inject(Database) private db: Database) {}
  async onModuleInit() {
    await this.db.query(
      "UPDATE import_jobs SET status='FAILED',finished_at=now(),error_code='IMPORT_INTERRUPTED',error_message='Server restarted. Start the import again.' WHERE status IN ('QUEUED','RUNNING')",
    );
  }
  async get(id: string) {
    const r = await this.db.one("SELECT * FROM import_jobs WHERE id=$1", [id]);
    if (!r) fail(404, "IMPORT_NOT_FOUND", "Import job not found.");
    return camel(r);
  }
  async start(d: any) {
    const file =
      process.env[
        (d.kind === "RAILWAYS" ? "RAILWAY" : "STATION") +
          "_GEOJSON_" +
          d.country
      ];
    if (
      !file &&
      !(
        process.env.ENABLE_OVERPASS_IMPORT === "true" &&
        process.env.NODE_ENV !== "production" &&
        /^[A-Z]{2}$/.test(d.country)
      )
    )
      fail(
        422,
        "IMPORT_SOURCE_UNCONFIGURED",
        "Configure a local GeoJSON source for this country.",
      );
    const existing = await this.db.one(
      "SELECT id FROM import_jobs WHERE country=$1 AND kind=$2 AND status IN ('QUEUED','RUNNING')",
      [d.country, d.kind],
    );
    if (existing)
      fail(409, "IMPORT_ALREADY_RUNNING", "An import is already running.", {
        details: { jobId: existing.id },
      });
    let row;
    try {
      row = await this.db.one(
        "INSERT INTO import_jobs(country,kind) VALUES($1,$2) RETURNING *",
        [d.country, d.kind],
      );
    } catch (e: any) {
      if (e.code === "23505") {
        const job = await this.db.one(
          "SELECT id FROM import_jobs WHERE country=$1 AND kind=$2 AND status IN ('QUEUED','RUNNING')",
          [d.country, d.kind],
        );
        fail(409, "IMPORT_ALREADY_RUNNING", "An import is already running.", {
          details: { jobId: job?.id },
        });
      }
      throw e;
    }
    setImmediate(() => this.run(row.id, d, file));
    return camel(row);
  }
  private async data(d: any, file?: string) {
    if (file) {
      if ((await stat(file)).size > 100 * 1024 * 1024)
        throw new Error("SOURCE_TOO_LARGE");
      const raw = JSON.parse(await readFile(file, "utf8"));
      return z
        .object({
          type: z.literal("FeatureCollection"),
          features: z.array(feature).max(100000),
        })
        .parse(raw).features;
    }
    // Development import only. Production uses offline country extracts or a dedicated provider.
    const filter =
      d.kind === "RAILWAYS"
        ? // Abstell-, Rangier- und Werksgleise (service=*) gehören nicht ins Streckennetz
          "way[railway=rail][!service](area.a);"
        : "nwr[railway=station][station!=subway][station!=light_rail](area.a);";
    const query =
      '[out:json][timeout:180];area["ISO3166-1"="' +
      d.country +
      '"][admin_level=2]->.a;(' +
      filter +
      ");out geom;";
    // Ganze Länder sind für Overpass zu groß: Landesgrenze holen, dann in Kacheln abfragen.
    const elements: any[] = [];
    const seen = new Set<string>();
    const area = '["ISO3166-1"="' + d.country + '"][admin_level=2]';
    const bounds = (
      await this.overpassJson("[out:json][timeout:60];rel" + area + ";out bb;")
    ).elements?.[0]?.bounds;
    if (!bounds) throw new Error("SOURCE_INCOMPLETE");
    const n = d.kind === "RAILWAYS" ? 2 : 1;
    const dLat = (bounds.maxlat - bounds.minlat) / n;
    const dLon = (bounds.maxlon - bounds.minlon) / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const bbox = [
          bounds.minlat + i * dLat,
          bounds.minlon + j * dLon,
          bounds.minlat + (i + 1) * dLat,
          bounds.minlon + (j + 1) * dLon,
        ]
          .map((v) => v.toFixed(5))
          .join(",");
        const q = query.replace("(area.a)", "(" + bbox + ")(area.a)");
        const raw = await this.overpassJson(q);
        if (raw.remark || !Array.isArray(raw.elements))
          throw new Error("SOURCE_INCOMPLETE");
        for (const el of raw.elements) {
          const key = el.type + ":" + el.id;
          if (!seen.has(key)) {
            seen.add(key);
            elements.push(el);
          }
        }
      }
    }
    const raw = { elements };
    return raw.elements.flatMap((v: any) => {
      const points = (v.geometry ?? []).map((p: any) => [p.lon, p.lat]);
      if (d.kind === "RAILWAYS")
        return points.length >= 2
          ? [
              {
                type: "Feature",
                geometry: { type: "LineString", coordinates: points },
                properties: {
                  ...v.tags,
                  sourceId: "osm:" + v.type + ":" + v.id,
                },
              },
            ]
          : [];
      const point =
        v.lon !== undefined ? [v.lon, v.lat] : points.length ? points[0] : null;
      return point
        ? [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: point },
              properties: { ...v.tags, sourceId: "osm:" + v.type + ":" + v.id },
            },
          ]
        : [];
    });
  }
  /** Feste Endpunkte; ohne User-Agent antwortet Overpass mit 406. Bei Überlastung neu versuchen. */
  private async overpass(query: string): Promise<Response> {
    // lz4/z sind weitere Instanzen von overpass-api.de und oft weniger ausgelastet.
    const endpoints = [
      "https://lz4.overpass-api.de/api/interpreter",
      "https://overpass-api.de/api/interpreter",
      "https://z.overpass-api.de/api/interpreter",
    ];
    let last = "SOURCE_UNAVAILABLE";
    for (let attempt = 0; attempt < 6; attempt++) {
      const url = endpoints[attempt % endpoints.length];
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "train-app-backend/1.0 (development import)",
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(200000),
        });
        if (response.ok) return response;
        last = "SOURCE_UNAVAILABLE_" + response.status;
        await response.body?.cancel();
        if (![429, 502, 503, 504].includes(response.status)) break;
      } catch {
        last = "SOURCE_UNAVAILABLE";
      }
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
    throw new Error(last);
  }

  private async overpassJson(query: string): Promise<any> {
    const response = await this.overpass(query);
    const reader = response.body!.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 100 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("SOURCE_TOO_LARGE");
      }
      chunks.push(r.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }

  private async run(id: string, d: any, file?: string) {
    try {
      await this.db.query(
        "UPDATE import_jobs SET status='RUNNING',started_at=now() WHERE id=$1",
        [id],
      );
      const features = await this.data(d, file);
      await this.db.transaction(async (m) => {
        const [c] = await m.query(
          "SELECT timezone FROM countries WHERE code=$1",
          [d.country],
        );
        if (!c) throw new Error("COUNTRY_NOT_FOUND");
        let n = 0;
        for (const raw of features) {
          const f = feature.parse(raw),
            props = f.properties;
          const sourceId = String(props.sourceId ?? props.id ?? "");
          if (!sourceId) throw new Error("SOURCE_ID_REQUIRED");
          if (d.kind === "RAILWAYS") {
            if (f.geometry.type !== "LineString")
              throw new Error("SOURCE_GEOMETRY_INVALID");
            const u = usage.safeParse(props.usage);
            const e =
              typeof props.electrified === "boolean"
                ? props.electrified
                : props.electrified === "no"
                  ? false
                  : props.electrified
                    ? true
                    : null;
            await m.query(
              `INSERT INTO tracks(country,name,usage,electrified,geometry,source_id,source,attribution) VALUES($1,$2,$3,$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326),$6,$7,$8) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name,usage=EXCLUDED.usage,electrified=EXCLUDED.electrified,geometry=EXCLUDED.geometry,updated_at=now(),version=tracks.version+1`,
              [
                d.country,
                props.name ?? null,
                u.success ? u.data : "unknown",
                e,
                JSON.stringify(f.geometry),
                d.country + ":" + sourceId,
                file ? "CONFIGURED_GEOJSON" : "OSM",
                "© OpenStreetMap contributors — ODbL",
              ],
            );
          } else {
            if (f.geometry.type !== "Point")
              throw new Error("SOURCE_GEOMETRY_INVALID");
            const values = [
              props.name ?? "Unnamed station",
              props.ref ?? null,
              d.country,
              JSON.stringify(f.geometry),
              c.timezone,
              d.country + ":" + sourceId,
            ];
            // Bestehende manuelle Station (gleicher Name, < 300 m) übernehmen statt doppelt anlegen.
            const adopted = await m.query(
              `UPDATE stations SET source_id=$6, coordinates=ST_SetSRID(ST_GeomFromGeoJSON($4),4326), code=COALESCE(code,$2), version=version+1
               WHERE id = (SELECT id FROM stations WHERE source_id IS NULL AND country=$3 AND name=$1
                 AND ST_DWithin(coordinates::geography, ST_SetSRID(ST_GeomFromGeoJSON($4),4326)::geography, 300) LIMIT 1)
               AND NOT EXISTS (SELECT 1 FROM stations WHERE source_id=$6) RETURNING id`,
              [...values.slice(0, 4), values[4], values[5]],
            );
            if (
              !(Array.isArray(adopted?.[0])
                ? adopted[0].length
                : adopted?.length)
            )
              await m.query(
                `INSERT INTO stations(name,code,country,coordinates,time_zone,source_id) VALUES($1,$2,$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326),$5,$6) ON CONFLICT(source_id) DO UPDATE SET name=EXCLUDED.name,coordinates=EXCLUDED.coordinates,version=stations.version+1`,
                values,
              );
          }
          n++;
        }
        await m.query(
          "UPDATE countries SET data_status='READY' WHERE code=$1",
          [d.country],
        );
        await m.query(
          "UPDATE import_jobs SET status='DONE',progress=100,finished_at=now() WHERE id=$1",
          [id],
        );
      });
    } catch (e: any) {
      await this.db.query(
        "UPDATE import_jobs SET status='FAILED',finished_at=now(),error_code=$2,error_message=$3 WHERE id=$1",
        [
          id,
          "IMPORT_FAILED",
          "Could not import the configured source. Validate its format and availability.",
        ],
      );
      console.error("Import failed", id, e.message);
    }
  }
}
