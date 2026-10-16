import { MigrationInterface, QueryRunner } from "typeorm";
/**
 * Bedienbarkeit (docs/backend.md): fehlertolerante Bahnhofssuche, Favoriten am Konto, Störungen.
 * station_key() normalisiert Namen und Eingaben gleich: Umlaute (ü → ue), Akzente, ß, Groß/klein,
 * Abkürzungen (Hbf, Bf, St.) und Satzzeichen. Damit finden „Wien Westbf“, „Muerzzuschlag“ und
 * „St. Pölten“ dieselben Bahnhöfe wie die ausgeschriebenen Namen.
 */
export class Usability1793000000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(String.raw`
 CREATE EXTENSION IF NOT EXISTS unaccent;
 CREATE EXTENSION IF NOT EXISTS pg_trgm;
 CREATE OR REPLACE FUNCTION station_key(t text) RETURNS text
 LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
   SELECT trim(regexp_replace(
     regexp_replace(
       regexp_replace(
         regexp_replace(
           lower(public.unaccent('public.unaccent'::regdictionary,
             replace(replace(replace(replace(replace(replace(t,'ä','ae'),'ö','oe'),'ü','ue'),'Ä','Ae'),'Ö','Oe'),'Ü','Ue')
           )),
         'hbf\M', 'hauptbahnhof', 'g'),
       'bf\M', 'bahnhof', 'g'),
     '\mst\.?(\s|$)', 'sankt\1', 'g'),
   '[^a-z0-9]+', ' ', 'g'))
 $$;
 ALTER TABLE stations ADD COLUMN aliases text[] NOT NULL DEFAULT '{}';
 CREATE INDEX stations_key_trgm ON stations USING gin (station_key(name) gin_trgm_ops);
 CREATE TABLE favorite_stations (
   user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
   station_id uuid NOT NULL REFERENCES stations ON DELETE CASCADE,
   position int NOT NULL,
   PRIMARY KEY (user_id, station_id)
 );
 CREATE TABLE disruptions (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   country text NOT NULL REFERENCES countries,
   severity text NOT NULL CHECK (severity IN ('INFO','WARNING','SEVERE')),
   reason_code text,
   title text NOT NULL,
   text text NOT NULL DEFAULT '',
   valid_from timestamptz NOT NULL,
   valid_until timestamptz,
   station_ids uuid[] NOT NULL DEFAULT '{}',
   line_ids uuid[] NOT NULL DEFAULT '{}',
   version int NOT NULL DEFAULT 1,
   created_at timestamptz NOT NULL DEFAULT now(),
   CHECK (valid_until IS NULL OR valid_until > valid_from)
 );
 CREATE INDEX disruptions_active ON disruptions (country, valid_from, valid_until);
 CREATE INDEX audit_log_entity ON audit_log (entity_id, created_at DESC);`);
  }
  async down(q: QueryRunner) {
    await q.query(`
 DROP INDEX IF EXISTS audit_log_entity;
 DROP TABLE IF EXISTS disruptions, favorite_stations;
 DROP INDEX IF EXISTS stations_key_trgm;
 ALTER TABLE stations DROP COLUMN IF EXISTS aliases;
 DROP FUNCTION IF EXISTS station_key(text);`);
  }
}
