import { MigrationInterface, QueryRunner } from "typeorm";
/**
 * Doppelte Bahnhöfe zusammenführen: Manuell/Seed angelegte Station (ohne source_id) und
 * OSM-Station mit gleichem Namen im Umkreis von 300 m. Die OSM-Station bleibt (source_id
 * sichert spätere Re-Importe), sie übernimmt das Kürzel und alle Verweise.
 */
export class MergeStations1792000000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
 CREATE TEMP TABLE station_merge ON COMMIT DROP AS
 SELECT DISTINCT ON (m.id) m.id AS old_id, o.id AS new_id, m.code
 FROM stations m
 JOIN stations o ON o.source_id IS NOT NULL AND o.name = m.name AND o.country = m.country
   AND ST_DWithin(o.coordinates::geography, m.coordinates::geography, 300)
 WHERE m.source_id IS NULL
 ORDER BY m.id, ST_Distance(o.coordinates::geography, m.coordinates::geography);
 UPDATE route_stops r SET station_id = s.new_id FROM station_merge s WHERE r.station_id = s.old_id;
 UPDATE trip_stops t SET station_id = s.new_id FROM station_merge s WHERE t.station_id = s.old_id;
 UPDATE tickets t SET origin_station_id = s.new_id FROM station_merge s WHERE t.origin_station_id = s.old_id;
 UPDATE tickets t SET destination_station_id = s.new_id FROM station_merge s WHERE t.destination_station_id = s.old_id;
 UPDATE stations o SET code = COALESCE(o.code, s.code), version = o.version + 1 FROM station_merge s WHERE o.id = s.new_id;
 DELETE FROM stations WHERE id IN (SELECT old_id FROM station_merge);
 CREATE INDEX IF NOT EXISTS stations_name ON stations (country, lower(name));`);
  }
  async down(q: QueryRunner) {
    // Zusammenführung ist nicht umkehrbar; nur den Index entfernen.
    await q.query(`DROP INDEX IF EXISTS stations_name`);
  }
}
