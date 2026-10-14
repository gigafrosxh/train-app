import { MigrationInterface, QueryRunner } from "typeorm";
export class Initial1791936000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
 CREATE EXTENSION IF NOT EXISTS postgis;
 CREATE TABLE countries (code text PRIMARY KEY CHECK(code ~ '^[A-Z]{2}$'), names jsonb NOT NULL, timezone text NOT NULL, enabled boolean NOT NULL DEFAULT false, data_status text NOT NULL DEFAULT 'NOT_IMPORTED');
 INSERT INTO countries VALUES ('AT','{"de":"Österreich","en":"Austria"}','Europe/Vienna',true,'NOT_IMPORTED');
 CREATE TABLE settings (id int PRIMARY KEY CHECK(id=1), active_country text NOT NULL REFERENCES countries(code));
 INSERT INTO settings VALUES(1,'AT');
 CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL, display_name text NOT NULL, role text NOT NULL CHECK(role IN ('USER','WORKER','ADMIN')), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','LOCKED')), preferences jsonb NOT NULL DEFAULT '{"language":"de","theme":"system","fontScale":"md"}', must_change_password boolean NOT NULL DEFAULT false, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz);
 CREATE TABLE sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, expires_at timestamptz NOT NULL, revoked_at timestamptz);
 CREATE TABLE refresh_tokens (hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions ON DELETE CASCADE, used_at timestamptz);
 CREATE TABLE companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, code text NOT NULL UNIQUE, country text NOT NULL REFERENCES countries, version int NOT NULL DEFAULT 1);
 CREATE TABLE trains (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies, train_number text NOT NULL, name text, type text NOT NULL CHECK(type IN ('REGIONAL','INTERCITY','HIGH_SPEED','NIGHT','OTHER')), active boolean NOT NULL DEFAULT true, version int NOT NULL DEFAULT 1, UNIQUE(company_id,train_number));
 CREATE TABLE stations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, code text, country text NOT NULL REFERENCES countries, coordinates geometry(Point,4326) NOT NULL, time_zone text NOT NULL, source_id text UNIQUE, version int NOT NULL DEFAULT 1);
 CREATE INDEX stations_geo ON stations USING gist(coordinates);
 CREATE TABLE tracks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), country text NOT NULL REFERENCES countries, name text, usage text NOT NULL DEFAULT 'unknown', electrified boolean, geometry geometry(LineString,4326) NOT NULL, source_id text UNIQUE, source text NOT NULL DEFAULT 'MANUAL', attribution text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1);
 CREATE INDEX tracks_geo ON tracks USING gist(geometry);
 CREATE TABLE lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies, name text NOT NULL, code text NOT NULL, color text, version int NOT NULL DEFAULT 1, UNIQUE(company_id,code));
 CREATE TABLE routes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), line_id uuid NOT NULL REFERENCES lines, name text NOT NULL, direction text NOT NULL, version int NOT NULL DEFAULT 1);
 CREATE TABLE route_stops (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), route_id uuid NOT NULL REFERENCES routes ON DELETE CASCADE, station_id uuid NOT NULL REFERENCES stations, sequence int NOT NULL CHECK(sequence>=0), UNIQUE(route_id,sequence) DEFERRABLE INITIALLY DEFERRED);
 CREATE TABLE route_tracks (route_id uuid REFERENCES routes ON DELETE CASCADE, track_id uuid REFERENCES tracks, sequence int NOT NULL, PRIMARY KEY(route_id,sequence));
 CREATE TABLE schedules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), route_id uuid NOT NULL REFERENCES routes, train_id uuid NOT NULL REFERENCES trains, time_zone text NOT NULL, valid_from date NOT NULL, valid_until date NOT NULL, weekdays int[] NOT NULL, stops jsonb NOT NULL, exceptions jsonb NOT NULL DEFAULT '[]', dst_disambiguation text NOT NULL DEFAULT 'REJECT', version int NOT NULL DEFAULT 1, CHECK(valid_until>=valid_from));
 CREATE TABLE trips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), route_id uuid NOT NULL REFERENCES routes, train_id uuid NOT NULL REFERENCES trains, schedule_id uuid REFERENCES schedules, service_date date NOT NULL, cancelled boolean NOT NULL DEFAULT false, delay_seconds int NOT NULL DEFAULT 0, reason_code text, reason_text text, version int NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(schedule_id,service_date));
 CREATE TABLE trip_stops (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trip_id uuid NOT NULL REFERENCES trips ON DELETE CASCADE, route_stop_id uuid, station_id uuid NOT NULL REFERENCES stations, sequence int NOT NULL, scheduled_arrival timestamptz, scheduled_departure timestamptz, expected_arrival timestamptz, expected_departure timestamptz, actual_arrival timestamptz, actual_departure timestamptz, arrival_override boolean NOT NULL DEFAULT false, departure_override boolean NOT NULL DEFAULT false, scheduled_platform text, expected_platform text, cancelled boolean NOT NULL DEFAULT false, reason_code text, reason_text text, version int NOT NULL DEFAULT 1, UNIQUE(trip_id,sequence));
 CREATE INDEX departures ON trip_stops(scheduled_departure);
 CREATE INDEX arrivals ON trip_stops(scheduled_arrival);
 CREATE TABLE worker_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), worker_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, scope text NOT NULL CHECK(scope IN ('TRAIN','COMPANY')), train_id uuid REFERENCES trains, company_id uuid REFERENCES companies, valid_from timestamptz, valid_until timestamptz, version int NOT NULL DEFAULT 1, CHECK((scope='TRAIN' AND train_id IS NOT NULL AND company_id IS NULL) OR (scope='COMPANY' AND company_id IS NOT NULL AND train_id IS NULL)), CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until>valid_from));
 CREATE TABLE tickets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, reference text NOT NULL, product_name text, company_id uuid REFERENCES companies, trip_id uuid REFERENCES trips, boarding_stop_id uuid REFERENCES trip_stops, alighting_stop_id uuid REFERENCES trip_stops, origin_station_id uuid REFERENCES stations, destination_station_id uuid REFERENCES stations, valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL, travel_class int CHECK(travel_class IN(1,2)), qr_payload text, verified boolean NOT NULL DEFAULT false, cancelled boolean NOT NULL DEFAULT false, CHECK(valid_until>valid_from));
 CREATE INDEX tickets_owner ON tickets(user_id,valid_until);
 CREATE TABLE recent_trips (user_id uuid REFERENCES users ON DELETE CASCADE, trip_id uuid REFERENCES trips ON DELETE CASCADE, viewed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,trip_id));
 CREATE TABLE positions (trip_id uuid PRIMARY KEY REFERENCES trips ON DELETE CASCADE, coordinates geometry(Point,4326) NOT NULL, observed_at timestamptz NOT NULL, bearing double precision, source text NOT NULL, version int NOT NULL DEFAULT 1);
 CREATE TABLE ingestion_clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, token_hash text NOT NULL UNIQUE, train_id uuid NOT NULL REFERENCES trains, active boolean NOT NULL DEFAULT true);
 CREATE TABLE import_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), country text NOT NULL REFERENCES countries, kind text NOT NULL, status text NOT NULL DEFAULT 'QUEUED', progress int, started_at timestamptz, finished_at timestamptz, error_code text, error_message text);
 CREATE UNIQUE INDEX active_import ON import_jobs(country,kind) WHERE status IN ('QUEUED','RUNNING');
 CREATE TABLE audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, action text NOT NULL, entity_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
 `);
  }
  async down(q: QueryRunner) {
    await q.query(
      "DROP TABLE audit_log,import_jobs,ingestion_clients,positions,recent_trips,tickets,worker_assignments,trip_stops,trips,schedules,route_tracks,route_stops,routes,lines,tracks,stations,trains,companies,refresh_tokens,sessions,users,settings,countries CASCADE",
    );
  }
}
