# Train App Backend

NestJS/TypeScript REST API with PostgreSQL/PostGIS, JWT sessions, scoped worker access, Swagger and Socket.IO. Frontend ownership remains with Claude under `../frontend`.

## Local start

Requires Node.js >=22, npm, Docker Compose. Tested locally with Node 25 and PostgreSQL 17/PostGIS 3.5. Commands below run from `backend/`.

1. Copy `.env.example` to `.env` if no local `.env` exists. Set unique random JWT_SECRET and CSRF_SECRET (32+ characters), DB_PASSWORD, matching DATABASE_URL, and a development-only DEMO_PASSWORD (12+ characters). This workspace already has a generated `.env` with restrictive permissions.
2. `docker compose up -d --wait`
3. `npm ci`
4. `npm run db:migrate`
5. `npm run seed`
6. `npm run build && npm start` (or `npm run start:dev`).

API: http://localhost:3000/api/v1 ; Swagger: http://localhost:3000/api/docs ; JSON: http://localhost:3000/api/openapi.json . Database binds only to 127.0.0.1:55439. The PostGIS image uses AMD64 emulation on Apple Silicon. No existing databases or ports are changed.

Angular runs on 4200 with proxy for `/api` and `/socket.io` to port 3000, including WebSocket upgrade. Disable frontend mocks for integration. `GET /auth/csrf` must precede mutations. Browser cookies remain same-origin through the proxy. Login accepts email/password; public registration always creates USER.

## Development accounts

| Role | Email | Password |
| --- | --- | --- |
| User | user@rail-demo.local | local `.env`: DEMO_PASSWORD |
| Worker | worker@rail-demo.local | local `.env`: DEMO_PASSWORD |
| Administrator | admin@rail-demo.local | local `.env`: DEMO_PASSWORD |

Do not commit `.env` or copy these accounts into production. Seed is rejected in production and does not overwrite existing account passwords. It supplies four Austrian stations, two directions, 14 days of timetables, one saved ticket, recent activity and a worker limited to RJ 60. RJ 61 deliberately tests forbidden access. All services and ticket references are fictional. Demo track geometry is synthetic and identified as such; it is not a surveyed railway alignment.

### Demo-Netz Österreich (optional, nach dem OSM-Import)

`npm run seed:network` legt auf den importierten OSM-Daten ein realistisches Netz an: 13 Linien (RJ Westbahn, Südbahn, Koralm, Tauern, Arlberg, Giselabahn, Unterinntal, Brenner, Ostbahn, S7, Murtal, Westexpress, Nightjet), 3 fiktive Gesellschaften, rund 330 Fahrpläne und Fahrten für 14 Tage.

- Voraussetzung: Im Setup „Strecken laden“ und „Bahnhöfe laden“ für AT ausgeführt.
- Streckenverlauf: kürzester Weg im OSM-Gleisnetz zwischen zwei Halten (A*, offene Gleisenden bis 300 m werden verbunden, Plausibilitätsprüfung max. 2,5× Luftlinie). Jeder Abschnitt wird als Strecke mit `source = 'DEMO_ROUTE'` gespeichert und über `route_tracks` verknüpft – damit schätzt das Backend Zugpositionen entlang der echten Strecke. `/map/railways` blendet diese Abschnitte aus (sie liegen deckungsgleich auf den OSM-Gleisen).
- Fahrzeiten aus Weglänge und Zuggattung, plus Haltezeit. Das Skript ist idempotent (feste IDs) und kann erneut laufen.

Doppelte Bahnhöfe: Die Migration `MergeStations` führt manuell angelegte Bahnhöfe mit gleichnamigen OSM-Bahnhöfen (< 300 m) zusammen. Import und Seed übernehmen bestehende Bahnhöfe künftig, statt sie doppelt anzulegen.

## Tests and API contract

- `npm test`: daylight-saving transitions, calendar rules, geometry and registration validation.
- `npm run test:integration`: creates a new randomly named test database, migrates and seeds it, tests real HTTP/Postgres/Socket.IO, then drops only that database. Database user needs CREATEDB for this test command.
- `npm run build`: strict TypeScript build.
- `npm run openapi`: regenerates `openapi.json` from controller routes and the same Zod schemas used at runtime. No database connection required; local secrets are still required for app configuration.
- `npm run format`: Prettier for maintained sources.

See `../docs/api-contract.md` for conventions and Socket.IO protocol. OpenAPI is the implemented REST reference. Controllers, domain services, validation schemas and SQL migrations are separated. TypeORM manages the connection, transactions and versioned migration; SQL is parameterized. `synchronize` is disabled.

## Railway data imports

`POST /admin/imports { country: "AT", kind: "RAILWAYS" | "STATIONS" }` starts an asynchronous import; GET its returned ID until DONE/FAILED. Import writes are atomic and repeatable by sourceId. A restart marks unfinished jobs failed, allowing an explicit retry. Existing records absent from a new source are retained; imports do not delete administrator data.

Production input: configure `RAILWAY_GEOJSON_AT` or `STATION_GEOJSON_AT` to a local GeoJSON FeatureCollection prepared from a licensed country extract (e.g. Geofabrik/OpenStreetMap). Tracks require LineString; stations Point. Each feature must have a stable `properties.sourceId` or `properties.id`; optional name, usage, electrified/ref. Maximum 100 MiB / 100,000 features. MultiLineStrings must be split into individually identified LineStrings before import. Coordinates use [longitude, latitude]. OSM attribution is included in responses; preserve source license obligations.

For a development-only automatic Austria download, set `ENABLE_OVERPASS_IMPORT=true` and request the import in Setup. The backend uses a fixed HTTPS Overpass endpoint and country filter, with bounded timeout and input size. The public service can be unavailable or reject country-wide queries; failures remain explicit jobs. Never use public Overpass as a per-user map backend. Production disables this path; serve imported local data or operate a dedicated provider. Additional countries can be added through a migration with their names/timezone and configured import source, then selected with PATCH /admin/settings.

Sources assessed: https://download.geofabrik.de/ ; https://dev.overpass-api.de/overpass-doc/en/preface/commons.html ; https://gtfs.org/documentation/schedule/reference/ ; https://gtfs.org/documentation/realtime/reference/ . GTFS/GTFS-RT are suitable future provider adapters; no nationwide live feed is configured or claimed by this implementation.

## Positions and live events

Fresh device reports take priority (120-second freshness). Otherwise positions are estimated along an explicitly linked continuous route geometry using expected or scheduled stop times. Stops must lie within 1 km of that geometry and in route order; insufficient geometry yields UNAVAILABLE, not a straight-line guess. API always exposes positionType, source and timestamps. Background railway lines are not automatically assigned to train routes: an administrator must link route tracks in order.

Devices submit `POST /ingestion/positions` with a separate bearer credential restricted to a train; user JWTs cannot act as device credentials. Provision with `TRAIN_ID=... DEVICE_NAME=... npm run device:create`; the one-time token is written to a local restricted file, never to logs. Timestamp, train scope, ordering and implausible speed are checked.

Socket.IO events: trip.updated, trip.position.updated, schedule.updated, map.train.removed. Authentication and active sessions are rechecked; token expiry disconnects. REST snapshots last 120 seconds, are user/filter-bound, and expose a global map revision. Read the contract for subscriptionId, mapRevision and positionVersion semantics.

## Operational limits

This release targets one backend process. Snapshot cache, position publication and Socket.IO membership are in memory; do not scale horizontally without a shared event/snapshot store. Restart invalidates snapshots, and clients must reconnect/reload. PostgreSQL remains authoritative for business data. Daily timetables are generated idempotently on startup and every minute for 14 local service dates; recurring schedule validity is capped at 730 days. UTC timestamps and explicit DST disambiguation avoid silent clock shifts.

Connection search supports at most two same-station transfers with a five-minute minimum and has an exploration cap. Large networks need a dedicated indexed routing engine. Map requests have bounded geometry volume; no unbounded nationwide polling. Health endpoints contain no private data. JWT/CSRF secrets and CORS origins must be set for the deployment. Use an HTTPS reverse proxy; Secure cookies are enabled and Swagger is disabled with NODE_ENV=production. The server binds to loopback by default (HOST can override for container deployments).

For initial production administrator creation set ADMIN_EMAIL and ADMIN_PASSWORD and run `npm run bootstrap:admin`. It creates a password-change-required account; the database must already be migrated. Temporary passwords are never returned by APIs or logged. Account deletion is blocked for the last active administrator. Ticket imports are a personal wallet only, not payment, issuance, or proof of travel validity.

## Echte Fahrplan- und Positionsdaten (geplant)

Derzeit sind Fahrpläne Demo-Daten; Strecken und Bahnhöfe kommen aus OpenStreetMap (Import in Setup). Für echte Daten sind kostenlose Quellen vorgesehen:

| Quelle | Kostenlos | Echtzeit | Abdeckung |
| --- | --- | --- | --- |
| ÖBB Transport REST API | ja, öffentlich | ja | Züge gebietsweise über „Radar“ |
| HAFAS / Scotty | technisch nutzbar | ja | gebietsweise |
| ÖBB Open Data | ja | je nach Datensatz | umfangreiche Fahrplandaten (GTFS) |

Geplant: Fahrpläne aus ÖBB Open Data (GTFS) importieren, Live-Positionen und Verspätungen über die Transport REST API (Radar) als Adapter in `POST /ingestion/positions` bzw. die Betriebsänderungen einspeisen. Positionen bleiben als `REALTIME` gekennzeichnet; ohne Daten wird weiter geschätzt.
