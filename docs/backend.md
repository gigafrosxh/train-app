# Backend-Ideen vom Frontend (Claude → Codex)

Stand: 16.10.2026. Diese Datei gehört dem Frontend und sammelt **Vorschläge**. Das Backend entscheidet.
Antworten bitte in `coordination.md` (pro Punkt: angenommen / geändert / abgelehnt). Verbindliches bleibt in `api-contract.md`.
Alles hier ist **rein additiv** (neue Felder oder Endpunkte). Bestehende Formen sollen sich nicht ändern.

Reihenfolge = Nutzen für die Bedienbarkeit. P1 bitte zuerst.

---

## P1 – merkt man sofort

### 1. Favoriten-Bahnhöfe am Konto
Das Frontend speichert Favoriten und zuletzt gewählte Bahnhöfe jetzt **nur im Browser** (localStorage). Am Handy und am Laptop fehlen sie dann.
- `GET /me/favorite-stations` → `StationRef[]` (Reihenfolge = Anzeige)
- `PUT /me/favorite-stations { stationIds: string[] }` (max. 12, Duplikate → 400) → `StationRef[]`
- Gelöschte oder zusammengeführte Bahnhöfe bitte serverseitig entfernen bzw. auf die neue ID umbiegen (siehe Merge-Migration).
- Das Frontend übernimmt beim ersten Login vorhandene lokale Favoriten einmalig per `PUT`.

### 2. Fehlertolerante Bahnhofssuche
Heute `ILIKE` mit Sonderfall „Hbf ↔ Hauptbahnhof“ (das Frontend sucht bei 0 Treffern ein zweites Mal).
- Groß/klein, Umlaute und ß egal: `Wien Westbf`, `Westbahnhof`, `Muerzzuschlag` → Mürzzuschlag (`unaccent`).
- Tippfehler: `pg_trgm`-Ähnlichkeit als Fallback, sortiert nach Treffergüte statt alphabetisch (Präfix-Treffer zuerst).
- Abkürzungen serverseitig: `Hbf`, `Bf`, `St.` ↔ `Sankt`. Dann entfällt die Doppelanfrage im Frontend.
- Optional `Station.aliases: string[]` für bekannte Zweitnamen.

### 3. „Über“-Halte an Abfahrten
Auf der Tafel will man sehen, ob der Zug am eigenen Ziel hält, ohne die Fahrt zu öffnen.
- `BoardEntry.via: StationRef[]`: die nächsten 2–3 **wichtigen** Halte (Abfahrt) bzw. vorherigen (Ankunft). Die Auswahl macht das Backend, z. B. Halte mit vielen Linien.

### 4. Zeitzone pro Halt
Steht schon in `frontend-notes.md`, ist aber noch offen: `timeZone` an `StationRef` (oder `TripStop`/`BoardEntry`).
Sonst sind Zeiten bei grenzüberschreitenden Fahrten (Salzburg → München) falsch, sobald ein Land eine andere Zone hat.

### 5. Gleiswechsel und Anschluss in Gefahr
- `BoardEntry.platformChanged: boolean` (erwartet ≠ geplant). Das Frontend leitet es heute selbst ab, das Backend kennt den Grund besser.
- `Connection.legs[i].transferAtRisk: boolean` und `transferSeconds: number | null` nach Echtzeit: Umstieg kürzer als die Mindestumsteigezeit → Warnung in der Verbindung.
- Home-Hinweise: neuer `TripAlert.kind = 'TRANSFER_AT_RISK'` für eigene Fahrten.

## P2 – deutlich bequemer

### 6. Störungen und Baustellen im Netz
Heute gibt es Hinweise nur zu einzelnen Fahrten.
- `GET /disruptions?country&stationId?&lineId?&activeAt?` → `{ id, severity: 'INFO' | 'WARNING' | 'SEVERE', reasonCode, title, text, validFrom, validUntil, stationIds, lineIds }`
- Socket-Event `disruption.updated`.
- Admin-CRUD unter `/admin/disruptions` (gleiches Versionsmuster).
- Das Frontend zeigt sie als Banner auf Tafel, Linie, Home und als Symbol auf der Karte.

### 7. Bahnhöfe in der Nähe
- `GET /stations/nearby?lng&lat&limit=5` → `Station & { distanceMeters }`.
- Für „Abfahrten hier“ mit einem Tipp (Standort nur nach Zustimmung, wird nicht gespeichert).

### 8. Verbindungssuche: früher, später, Ankunft
- `arriveBy=true` mit `arriveBefore` (Ankunftszeit statt Abfahrtszeit).
- Blättern in beide Richtungen: `cursor` mit `prev`/`next` statt nur `page`. Dann gibt es „Frühere Verbindungen“ oben in der Liste.
- `Connection.walkingSeconds` als Vorbereitung für Umstiege zwischen Bahnhöfen (später).

### 9. Push-Benachrichtigungen (Web Push)
Für Verspätung, Ausfall oder Gleiswechsel der nächsten eigenen Fahrt, auch wenn die App zu ist.
- `POST /me/push-subscriptions { endpoint, keys: { p256dh, auth } }`, `DELETE /me/push-subscriptions/:id`
- `GET /push/vapid-public-key`
- Einstellungen am User: `preferences.notify: { delays: boolean, cancellations: boolean, platform: boolean, minDelayMinutes: number }`
- Auslöser: dieselbe Logik wie `TripAlert`, max. eine Nachricht pro Fahrt und Ereignistyp.

### 10. Server- und Datenstatus
Das Frontend zeigt jetzt einen Offline-Hinweis. Es weiß aber nicht, ob die **Echtzeitdaten** veraltet sind.
- `GET /status` (ohne Login, kurz gecacht) → `{ realtime: 'OK' | 'DEGRADED' | 'DOWN', lastPositionAt, message? }`
- oder als Socket-Event `server.status` bei jeder Änderung.

## P3 – Mitarbeitende und Admin

### 11. Verspätung automatisch weitergeben
Im Plan muss ein Mitarbeiter heute jeden folgenden Halt einzeln ändern.
- `PATCH /operations/trips/:id/stops/:stopId { …, propagate: true }`: Verspätung auf alle folgenden Halte übertragen. Pufferzeiten (längere Halte) dürfen sie verkleinern.
- Antwort wie bisher `TripDetail`, damit das Frontend alles auf einmal sieht.

### 12. Änderungsprotokoll
- `GET /admin/audit?entity&entityId&userId&from&to&page` → `{ at, userId, userName, action, entity, entityId, summary, diff? }`
- Hilft bei „Wer hat den Zug als ausgefallen markiert?“ und bei Versionskonflikten (letzte Änderung anzeigen).

### 13. Prüfen vor dem Speichern
- `POST /admin/schedules/validate` (gleicher Body wie POST/PATCH) → `{ ok, warnings[], tripsAffected }`.
  Das Formular kann dann vorher anzeigen: „Ändert 42 Fahrten in den nächsten 14 Tagen.“

### 14. Massenimport Fahrpläne
- `POST /admin/imports { kind: 'SCHEDULES_CSV' | 'GTFS' }` mit Datei-Upload. Gleicher `ImportJob`-Ablauf.
- Fehler pro Zeile in `ImportJob.errors: { row, field, code }[]`.

## Technik

### 15. Caching
- `ETag` / `Cache-Control` für `/map/railways`, `/lines`, `/countries`, `/stations/:id`. Diese Daten ändern sich selten, die Karte lädt dann schneller.
- Später Vector Tiles für das Schienennetz (`/map/tiles/{z}/{x}/{y}.mvt`). Steht schon als Wunsch in `frontend-notes.md`.

### 16. Kleinere Wünsche
- `Trip.lastObservedAt` an `TripDetail` (Hinweis „Position vor 3 Min.“).
- `GET /stations/:id` liefert bitte auch `lineIds` bzw. `lines: LineRef[]`. Dann kann die Tafel nach Linie filtern.
- Stabiler Fehlercode für „Bahnhof wurde zusammengeführt“: `STATION_MERGED` mit `details.newId`. Das Frontend biegt dann gespeicherte Favoriten um.

---

Bitte nach Umsetzung jeweils `backend/openapi.json` exportieren und in `api-contract.md` aufnehmen. Ich baue die Mocks im Frontend passend nach.
