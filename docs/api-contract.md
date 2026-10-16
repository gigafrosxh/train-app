# API-Vertrag – Planungsstand

Stand: 2026-10-14. Dieser Vertrag beschreibt vereinbarte Schnittstellen; noch keine implementierte API. Ergänzungen werden mit dem Frontend abgestimmt.

Leseregel: Spätere ausdrücklich präzisierende Abschnitte haben Vorrang vor historischen Vorschlagsabschnitten. Die dritte Runde ist von Claude bestätigt; die abschließende Backend-Festlegung unten löst die verbleibenden technischen Punkte.

Der DTO-Anhang wurde von Claude grundsätzlich bestätigt. Die abschließenden Präzisierungen unter „Antwort auf Claudes Ergänzungen“ konkretisieren und ersetzen abweichende frühere Vorschläge.

## Allgemein

- Backend `http://localhost:3000`, Angular `http://localhost:4200`.
- REST-Basis `/api/v1`; Browser verwendet relative URLs über Angular-Proxy.
- Socket.IO-Pfad `/socket.io`; Proxy unterstützt WebSocket-Upgrade.
- UUIDs, camelCase, ISO-8601-UTC-Zeitpunkte, Verspätungen in Sekunden.
- Rollen: `USER | WORKER | ADMIN`.
- Paginierte Listen: `{ items, total, page, pageSize }`, Seitenzählung ab 1; Standard 20, maximal 100.
- GeoJSON-Endpunkte sind ausdrücklich von der Listenhülle ausgenommen.
- Fehler: `{ statusCode, code, message, fieldErrors?, requestId }`; `fieldErrors` ist bei Vorhandensein eine Liste `{ field, code, message }`.
- Frontend übersetzt stabile Codes; `message` dient als Fallback. Freitext wird nicht automatisch übersetzt.
- Beispiele für Codes: `VALIDATION_FAILED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_SESSION_EXPIRED`, `AUTH_FORBIDDEN`, `TRIP_VERSION_CONFLICT`.

## Anmeldung und Konto

`POST /auth/register`: `{ email, password, displayName }`, erzeugt ausschließlich USER. Antwort 201 mit Benutzerobjekt; danach regulärer Login.

`POST /auth/login`: `{ email, password }`.

`POST /auth/refresh`: Refresh-Cookie; kein Refresh-Token im JSON.

Login/Refresh, jeweils 200:

```ts
type Preferences = {
  language: 'de' | 'en';
  theme: 'light' | 'dark' | 'system';
  fontScale: 'sm' | 'md' | 'lg';
};
type User = {
  id: string;
  email: string;
  displayName: string;
  role: 'USER' | 'WORKER' | 'ADMIN';
  mustChangePassword: boolean;
  preferences: Preferences;
};
type AuthResponse = { accessToken: string; expiresIn: number; user: User };
```

`expiresIn` ist in Sekunden. JWT enthält mindestens `sub`, `role`, `exp`. Frontend darf Rolle für Darstellung nutzen; Backend prüft Berechtigungen selbst. Access-Token wird als `Authorization: Bearer ...` gesendet, vorzugsweise nur im Frontend-Speicher gehalten.

`GET /auth/csrf` liefert 204 und setzt `XSRF-TOKEN` mit Path `/`, für JavaScript lesbar. Angular sendet `X-XSRF-TOKEN` bei mutierenden Anfragen. Das Backend prüft einen signierten bzw. serverseitig gebundenen Token und Origin. Vor Login/Registrierung sowie nach einem vollständigen Neustart ohne CSRF-Cookie zuerst Bootstrap aufrufen. Refresh-Cookie: HttpOnly, Path `/api/v1/auth`, SameSite=Lax, Secure in Produktion. Deployment bevorzugt dieselbe Origin wie das Frontend.

`POST /auth/logout`: 204, widerruft Sitzung und löscht Refresh-Cookie.

`GET /me`: User. `PATCH /me`: partielles `{ displayName?, preferences? }`; einzelne Preferences werden zusammengeführt. Rollen und Passwort sind hier nicht änderbar. Standardpräferenzen: de/system/md.

`PATCH /me/password`: `{ currentPassword, newPassword }`, 204, widerruft bestehende Sitzungen; anschließender Login nötig.

## Länder und Einstellungen

`GET /countries`: Listenhülle mit `{ code, names: { de, en }, enabled, dataStatus }`; `dataStatus: NOT_IMPORTED | IMPORTING | READY | FAILED`. `enabled` bedeutet als aktives Land auswählbar; Datenvollständigkeit wird nicht behauptet.

`GET /settings`: `{ activeCountry: 'AT' }` initial.

`PATCH /admin/settings`: `{ activeCountry: string }`; nur ADMIN, nur aktivierbare Länder; Antwort ist aktuelles Settings-Objekt. Explizite `country`-Filter werden verwendet, sonst das aktive Land. Ein Wechsel löscht keine Daten anderer Länder.

## Karte

`GET /map/railways?country=AT&bbox=minLng,minLat,maxLng,maxLat&zoom=N`: GeoJSON FeatureCollection von LineString-/MultiLineString-Features, geometrisch nach Zoom vereinfacht. Properties: `{ id, usage, electrified?, name? }`; `usage` ist `main | branch | industrial | military | tourism | test | unknown`, `electrified` boolean, bei unbekanntem Wert weggelassen. FeatureCollection enthält zusätzlich `metadata: { country, source, attribution, updatedAt, dataStatus }`. Große Ausschnitte werden vereinfacht oder mit verständlichem Fehler abgelehnt, niemals unbemerkt abgeschnitten.

`GET /map/trains?country=AT&bbox=...&page=1&pageSize=100`: Listenhülle; Frontend lädt bei Bedarf weitere Seiten. Ein Eintrag:

```ts
type MapTrain = {
  tripId: string;
  positionVersion: number;
  lineName: string;
  trainNumber: string;
  coordinates: [number, number] | null; // longitude, latitude
  bearing: number | null; // Grad, 0 = Nord
  delaySeconds: number;
  nextStopName: string | null;
  positionType: 'REALTIME' | 'ESTIMATED' | 'UNAVAILABLE';
  isStale: boolean;
  observedAt: string | null; // Zeitpunkt der zugrunde liegenden Messung
  calculatedAt: string | null; // Zeitpunkt einer Schätzung
  source: string | null;
  estimationMethod: 'SCHEDULE' | 'SCHEDULE_WITH_UPDATES' | null;
};
```

Bei UNAVAILABLE sind Koordinaten null. Ohne Messung ist observedAt null; Schätzungen erhalten calculatedAt. Mit bbox werden nur lokalisierbare Züge im Ausschnitt geliefert. `GET /trips/:id/position` kann auch UNAVAILABLE zurückgeben. Veraltete letzte Messungen bleiben als solche gekennzeichnet.

`GET /trips/:id/shape`: GeoJSON Feature mit LineString-Geometrie; 404 mit `TRIP_SHAPE_UNAVAILABLE`, falls kein verlässlicher Fahrtverlauf verfügbar ist.

## Home und Fahrkarten

`GET /me/dashboard`: `{ nextTrip: TripSummary | null, recentTrips: TripSummary[], activeTickets: TicketSummary[], alerts: TripAlert[] }`. Listen sind bewusst begrenzte Dashboard-Auszüge; Detail-DTOs werden vor Implementierung ergänzt.

Fahrkartenstatus: `ACTIVE | EXPIRED | CANCELLED`. `qrPayload: string | null`, `verified: boolean`. Extern vom User gespeicherte Fahrkarten werden nicht automatisch verifiziert. QR-Inhalte enthalten keine Zugangstokens. Das Entfernen einer gespeicherten Fahrkarte ist keine Stornierung beim Verkehrsunternehmen.

## Worker und Änderungen

`GET /operations/trips` liefert nur autorisierte Fahrten (ADMIN: alle im gewählten Filter). Jede Fahrt und jeder bearbeitbare Halt besitzt eine numerische `version`.

`PATCH /operations/trips/:id` und `/operations/trips/:id/stops/:stopId` verlangen `version` als erwarteten aktuellen Stand. Erfolgreiche Änderung erhöht Version; veralteter Stand liefert 409 `TRIP_VERSION_CONFLICT`. Frontend lädt Ressource neu und lässt die Änderung erneut prüfen.

Verspätungsgründe: `TECHNICAL | WEATHER | STAFF | CONSTRUCTION | OTHER`, ergänzt um optionalen Freitext `reasonText`. Geplante, erwartete und tatsächliche Zeiten bleiben getrennt; geplante Zeiten werden durch reine Verspätungsmeldungen nicht überschrieben.

## Socket.IO

Handshake: `auth: { accessToken }`. Backend prüft Token, Ablauf und Abonnements. Token-Erneuerung erfordert aktualisierte Socket-Authentifizierung bzw. Reconnect.

Ereignisse: `trip.updated`, `trip.position.updated`, `schedule.updated`.

Gemeinsame Hülle: `{ eventId, occurredAt, entityId, version, data }`. Positionsversionen steigen unabhängig von der fachlichen Fahrtversion. Genaue Subscription- und Payload-Schemas werden in der Implementierungsphase vor der Frontend-Anbindung ergänzt.

Ereignisse werden nach erfolgreichem Datenbank-Commit gesendet. Frontend verwirft ältere Versionen, lädt nach Reconnect REST-Snapshots und verwendet REST als maßgebliche Zustandsquelle.

## OpenAPI und Demo-Daten

Swagger unter `/api/docs`. `backend/openapi.json` wird nach Implementierungsbeginn aus dem Backend generiert und bei Vertragsänderungen aktualisiert; kein handgeschriebenes Schema als angeblich implementierter Stand. Frontend erzeugt daraus Typen mit openapi-typescript.

Entwicklungs-Seed mit USER, WORKER und ADMIN sowie österreichischen Beispieldaten. Zugangsdaten ausschließlich in lokaler Entwicklungsdokumentation bzw. Seed-Konfiguration. Produktivbetrieb erhält keine automatischen Demo-Konten.

## DTO-Vorschlag zur zweiten Abstimmung

Status: Von Claude am 2026-10-14 grundsätzlich bestätigt; keine Implementierung. Die unten dokumentierte Antwort auf seine Ergänzungen hat bei Abweichungen Vorrang. Fehlende Werte in Responses werden explizit als null geliefert; optionale PATCH-Felder bedeuten unverändert, null bedeutet nur bei nullable Feldern löschen.

### Leseobjekte

```ts
type StationRef = { id: string; name: string; code: string | null };
type Station = StationRef & {
  country: string;
  coordinates: [number, number];
  timeZone: string;
  version: number;
};
type Company = { id: string; name: string; code: string; country: string; version: number };
type Line = {
  id: string; companyId: string; name: string; code: string;
  color: string | null; version: number;
};
type Route = {
  id: string; lineId: string; name: string; direction: string;
  stops: { id: string; sequence: number; station: StationRef }[];
  version: number;
};
type TripStatus = 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';
type DelayReason = 'TECHNICAL' | 'WEATHER' | 'STAFF' | 'CONSTRUCTION' | 'OTHER';
type TripSummary = {
  id: string; trainId: string; trainNumber: string;
  lineId: string; lineName: string; routeId: string; companyId: string;
  lineColor: string | null; companyName: string;
  serviceDate: string; // YYYY-MM-DD im Betriebskalender
  origin: StationRef; destination: StationRef;
  scheduledDeparture: string; scheduledArrival: string;
  expectedDeparture: string | null; expectedArrival: string | null;
  delaySeconds: number; status: TripStatus; version: number;
};
type TripStop = {
  id: string; sequence: number; station: StationRef;
  scheduledArrival: string | null; scheduledDeparture: string | null;
  expectedArrival: string | null; expectedDeparture: string | null;
  actualArrival: string | null; actualDeparture: string | null;
  scheduledPlatform: string | null; expectedPlatform: string | null;
  arrivalDelaySeconds: number | null; departureDelaySeconds: number | null;
  cancelled: boolean; reasonCode: DelayReason | null;
  reasonText: string | null; version: number;
};
type TripDetail = TripSummary & { stops: TripStop[] };
type BoardEntry = {
  tripId: string; stopId: string; station: StationRef;
  lineName: string; trainNumber: string;
  lineColor: string | null; companyName: string; reasonCode: DelayReason | null;
  origin: StationRef; destination: StationRef;
  scheduledTime: string; expectedTime: string | null; actualTime: string | null;
  delaySeconds: number | null;
  scheduledPlatform: string | null; expectedPlatform: string | null;
  cancelled: boolean;
};
type TicketSummary = {
  id: string; reference: string; companyId: string | null;
  tripId: string | null; origin: StationRef | null; destination: StationRef | null;
  validFrom: string; validUntil: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  verified: boolean; qrPayload: string | null;
  productName: string | null; travelClass: 1 | 2 | null; companyName: string | null;
  boardingStopId: string | null; alightingStopId: string | null;
};
type TripAlert = {
  id: string; tripId: string;
  code: 'TRIP_DELAYED' | 'TRIP_CANCELLED' | 'PLATFORM_CHANGED' | 'SCHEDULE_CHANGED';
  severity: 'INFO' | 'WARNING';
  delaySeconds: number | null; reasonCode: DelayReason | null;
  reasonText: string | null; createdAt: string;
};
```

`delaySeconds` in TripSummary ist die Abweichung am nächsten bedienten Halt (Abfahrt, sofern vorhanden, sonst Ankunft); nach Fahrtende am Ziel. Positive Werte bedeuten später, negative früher. Die geplanten Gesamtzeiten bleiben unverändert. Stop-IDs identifizieren einen konkreten Halt, nicht den Bahnhof; mehrfache Besuche desselben Bahnhofs bleiben unterscheidbar.

### Filter und Home-Regeln

- `/stations`: `country`, `q`, `page`, `pageSize`; Sortierung Name, dann ID.
- `/lines`: `country`, `companyId`, `q`, Pagination; Sortierung Name, dann ID.
- `/trips` und `/operations/trips`: `country`, `from`, `to`, `lineId`, `trainId`, `status`, Pagination. `from` inklusive, `to` exklusive beziehen sich auf geplante Abfahrt; Standard jetzt bis +24 Stunden, maximal 7 Tage; Sortierung geplante Abfahrt, dann ID.
- `/stations/:id/departures` bzw. `/arrivals`: `from`, `to`, Pagination; gleicher Zeitfensterstandard, Sortierung jeweilige geplante Zeit, dann stopId. Antwortitems: BoardEntry; Zeitfelder beziehen sich auf Abfahrt bzw. Ankunft.
- `/me/recent-trips`: explizite Aktivität `{ tripId, kind: 'VIEWED' | 'USED' }` per POST; wiederholte Aktivität aktualisiert den Zeitpunkt. Dashboard enthält maximal 10 verschiedene Fahrten, jüngste Aktivität zuerst. Ein Aufruf markiert keine Fahrt automatisch als tatsächlich benutzt.
- `nextTrip`: zeitlich nächste, nicht ausgefallene zukünftige Fahrt mit zugeordneter, nicht stornierter eigener Fahrkarte; sonst null. Maßgeblich ist erwartete, ersatzweise geplante Abfahrt am Einstieg des Users. Detailmodell für Einstieg/Ausstieg der Fahrkarte muss noch konkretisiert werden.
- `activeTickets`: maximal 10 nicht stornierte, noch nicht abgelaufene Tickets, nach validFrom und ID. ACTIVE umfasst auch zukünftige Gültigkeit; UI prüft validFrom.
- `alerts`: maximal 20 aktuelle Hinweise zu eigenen ticketgebundenen Fahrten ab jetzt bis +7 Tage, neueste zuerst. Zuletzt nur angesehene Fahrten erzeugen keine persönlichen Warnungen.

### Worker-Schreibdaten

Fahrt-PATCH: `{ version, delaySeconds?, reasonCode?, reasonText?, cancelled? }`; mindestens ein Änderungsfeld. `cancelled` ist eine Aktion auf den Fahrtstatus, keine frei wählbare Statusfolge. Rückgabe TripDetail.

Halt-PATCH: `{ version, expectedArrival?, expectedDeparture?, expectedPlatform?, cancelled?, reasonCode?, reasonText? }`; Rückgabe TripStop. Ist-Zeiten kommen aus separaten Meldungen und werden nicht mit erwarteten Zeiten verwechselt.

Eine globale Verspätungsänderung betrifft noch nicht bediente Halte. Konkrete Halt-Overrides haben Vorrang und müssen explizit zurückgesetzt werden (nullable erwartete Zeiten). Zeitänderungen müssen chronologisch plausibel sein. Änderungen an Halten erhöhen auch die Fahrtversion; Änderungen am Fahrtstatus prüfen die Fahrtversion. Die genaue Transaktionsregel wird vor Implementierung getestet.

### Administrator-CRUD

Für jede Ressource: GET Liste, GET `/:id`, POST (201), PATCH `/:id` (200) und DELETE `/:id` (204). PATCH verlangt version; DELETE verwendet `?version=N`. Referenzierte Daten liefern 409 `RESOURCE_IN_USE`, statt historische Daten zu entfernen. Veraltete `version` bei PATCH/DELETE liefert 409 `VERSION_CONFLICT` (Fahrten: `TRIP_VERSION_CONFLICT`). Admin-Listen sind nach Name (bzw. Zugnummer/Anzeigename), dann ID sortiert. Die Bahnhofssuche behandelt „Hbf“ und „Hauptbahnhof“ gleich.

Erste Schreibformen (IDs und Versionsfelder entstehen serverseitig):

| Ressource unter /admin | POST-Felder |
| --- | --- |
| companies | name, code, country |
| stations | name, code (nullable), country, coordinates, timeZone |
| trains | companyId, trainNumber, name (nullable), type, active |
| lines | companyId, name, code, color (nullable) |
| routes | lineId, name, direction, stops: [{ stationId, sequence }], trackIds: string[] |
| tracks | country, name (nullable), usage, electrified (nullable), geometry (GeoJSON LineString) |
| schedules | routeId, trainId, timeZone, validFrom/validUntil (YYYY-MM-DD), weekdays (1=Mo bis 7=So), stops: [{ routeStopId, arrivalOffsetSeconds: number|null, departureOffsetSeconds: number|null }], exceptions: [{ date, runs }] |
| trips | scheduleId, serviceDate, trainId (optionaler Ersatz) |

Fahrplanoffsets sind lokale Betriebssekunden ab 00:00, dürfen 86400 überschreiten. DST-Auflösung, Validierungsgrenzen und DTOs für Benutzer-/Worker-Zuweisungen müssen vor deren Umsetzung ergänzt werden. Routenstopps besitzen stabile IDs; verwendete Routen werden versioniert, statt laufende Fahrten durch Listenänderungen umzuschreiben.

### Socket-Abonnements

Vorschlag: Client sendet `trips.subscribe` / `trips.unsubscribe` mit `{ tripIds: string[] }` (maximal 100) sowie `map.subscribe` mit `{ country, bbox }` und `map.unsubscribe` mit `{}`. Ein neues Kartenabonnement ersetzt das alte. Acknowledgement: `{ ok: true }` oder `{ ok: false, error: { code, message } }`.

- `trip.updated`: entityId=tripId, version=Fahrtversion, data=TripDetail.
- `trip.position.updated`: entityId=tripId, version=Positionsversion, data=MapTrain.
- `schedule.updated`: entityId=scheduleId, version=Fahrplanversion, data={ scheduleId, country, affectedTripIds, requiresRefetch: true }; affectedTripIds höchstens 100, bei größerer Änderung leer und vollständiges Neuladen der sichtbaren Fahrten erforderlich.

Karten-Abo liefert Positionsereignisse für im Ausschnitt befindliche Züge; für das Entfernen herausfahrender Marker wird zusätzlich `map.train.removed` mit `{ tripId }` in der gemeinsamen Ereignishülle vorgeschlagen. Dies ist ein neues Event und benötigt Claudes Bestätigung. Nach Reconnect zuerst abonnieren und eingehende Ereignisse puffern, dann REST-Snapshot laden und neuere Versionen anwenden. Alle Antworten von /map/trains benötigen hierfür zusätzlich `positionVersion: number`; auch diese Ergänzung ist noch ein Vorschlag.

## Antwort auf Claudes Ergänzungen – 2026-10-14

Die ergänzten Anzeigeattribute oben sowie `GET /trips/:id` → TripDetail sind angenommen. Alle folgenden Festlegungen sind die Backend-Antwort auf Claudes zweite Runde; seine Bestätigung eventueller Abweichungen steht noch aus.

### Zugriff

Die fachliche App einschließlich Rail Service, Karte, countries und settings benötigt Login. Öffentlich sind Registrierung, Login, CSRF-Bootstrap und die ausschließlich sitzungsbasierten Refresh-/Logout-Flows; Health-Endpunkte enthalten keine fachlichen Daten. Swagger/OpenAPI sind lokal verfügbar, im Produktivbetrieb geschützt oder deaktiviert. Admin- und Worker-Rechte gelten zusätzlich zur Anmeldung.

### Fahrterzeugung

Angenommen: automatische, idempotente Erzeugung für 14 lokale Betriebstage (heute bis heute+13), beim Start, regelmäßig und nach Fahrplanänderungen. Eindeutigkeit je scheduleId/serviceDate; konkurrierende Jobs erzeugen keine Duplikate. Kalender, Ausnahmen und Zeitzone werden berücksichtigt. Historische und begonnene Fahrten bleiben erhalten. Änderungen an zukünftigen Fahrten erhalten IDs und referenzierte Halt-IDs soweit fachlich möglich; konfliktbehaftete Änderungen mit Fahrkarten oder Betriebs-Overrides liefern 409 `SCHEDULE_CHANGE_CONFLICT`, statt Daten still zu überschreiben. Ausfall ersetzt Löschung bereits referenzierter Fahrten.

`POST /admin/trips` ist für Sonderfahrten: `{ routeId, trainId, serviceDate, stops: [{ routeStopId, scheduledArrival: string|null, scheduledDeparture: string|null }] }` → 201 TripDetail. Konkrete Zeiten sind UTC; alle Routenhalte müssen in Routenreihenfolge enthalten sein. Dies ersetzt den früheren POST-Vorschlag mit scheduleId. Reguläre Fahrten entstehen über schedules; Sonderfahrten werden vom Generator nicht verändert.

Suchanfragen außerhalb des erzeugten Horizonts liefern `400 SEARCH_DATE_OUT_OF_RANGE` mit Feldfehler für den Datumparameter, keine irreführende leere Liste. Das genaue Suchfenster lässt sich über zusätzliche Settings-Felder `tripGenerationDays: 14` und `searchWindow: { from, to }` (UTC, to exklusiv, für das aktive Land) anzeigen.

### Fahrkarten und Home

`POST /me/tickets`: `{ reference, productName?, companyId?, tripId?, boardingStopId?, alightingStopId?, originStationId?, destinationStationId?, validFrom, validUntil, travelClass?, qrPayload? }`. Optionale Werte dürfen null sein. Antwort 201 TicketSummary, immer verified=false. Owner, Status und Verifizierung sind nicht beschreibbar.

Bei tripId müssen Halte zu dieser Fahrt gehören, Einstieg vor Ausstieg. Fehlende Halt-IDs werden auf ersten/letzten Halt aufgelöst und so zurückgegeben. Stationsangaben müssen damit übereinstimmen. Ohne tripId müssen Halt-IDs null/fehlend sein; Stationsangaben sind optional. Zeitgültigkeit muss zum gewählten Fahrtabschnitt passen; validUntil liegt nach validFrom. origin/destination im Ticket sind der Fahrtabschnitt, nicht zwingend die Endbahnhöfe des Zuges.

Dashboard nextTrip: `(TripSummary & { ticketId: string; boardingStop: TripStop | null; alightingStop: TripStop | null }) | null`. Zugehörige Haltzeiten bestimmen die Auswahl; die TripSummary-Gesamtzeiten bleiben die der vollständigen Fahrt. Limits 10/10/20 bestätigt.

Das Frontend sendet nur `{ tripId, kind: 'VIEWED' }` an POST /me/recent-trips. USED wird vorerst nicht verwendet: Eine vorhandene oder abgelaufene Fahrkarte beweist keine tatsächliche Mitfahrt. Keine automatische Behauptung einer Nutzung. Dies ersetzt die frühere VIEWED|USED-Schreibform.

### Verbindungssuche

`GET /connections?fromStationId&toStationId&departAfter&maxTransfers=2&page=1&pageSize=20`, maxTransfers 0..2, Abfahrtssuche bis departAfter+24h innerhalb des erzeugten Horizonts, maximal 48h Reisedauer. Listenhülle, Sortierung Abfahrt, Ankunft, ID; berücksichtigt Ausfälle und erwartete Zeiten. Nur Umstiege am selben Bahnhof; keine impliziten Fußwege. Mindestumsteigezeit zunächst 300 Sekunden. Fahrplanänderungen können Ergebnisse zwischen Requests verändern; Frontend setzt Pagination nach Live-Änderungen zurück.

`Connection = { id: string, departure: string, arrival: string, durationSeconds: number, transfers: number, legs: ConnectionLeg[] }`.

`ConnectionLeg = { tripId: string, lineName: string, lineColor: string|null, trainNumber: string, from: BoardEntry, to: BoardEntry }`. from enthält Abfahrts-, to Ankunftszeiten. Connection-Zeiten verwenden expectedTime ?? scheduledTime. ID ist eine stabile opake Kennung der geordneten Fahrt-/Haltkombination, kein persistierter UUID-Datensatz; diese Ausnahme von der UUID-Konvention ausdrücklich beachten.

### Administratoren und Zuweisungen

- trains.type: `REGIONAL | INTERCITY | HIGH_SPEED | NIGHT | OTHER` angenommen; fachliche Service-Kategorie für diese App.
- Routen-PATCH: `{ version, ..., stops?: [{ id?, stationId, sequence }] }`. Angegebene IDs müssen zu dieser Route gehören; ausgelassene bestehende Halte gelten als entfernt, neue erhalten serverseitige UUIDs. Referenzierte Fahrten behalten ihren Halt-Snapshot; inkompatible Fahrplanreferenzen liefern 409 `ROUTE_CHANGE_CONFLICT`.
- AdminUser: User plus `{ status: 'ACTIVE'|'LOCKED', createdAt: string, lastLoginAt: string|null, version: number }`.
- GET /admin/users: q, role, status, page, pageSize; Listenhülle.
- POST /admin/users: `{ email, displayName, role, temporaryPassword }` → 201 AdminUser; mustChangePassword=true. Temporäres Passwort wird nicht zurückgegeben oder geloggt.
- PATCH /admin/users/:id: `{ version, role?, status?, displayName? }` → AdminUser. Eigene Herabstufung/Sperre: 409 `USER_SELF_MODIFICATION`; Entzug des letzten aktiven Admins: 409 `LAST_ADMIN_REQUIRED`. Rollen-/Statusänderung widerruft Sitzungen und wird auch bei bestehenden Zugriffen serverseitig berücksichtigt.
- mustChangePassword ist in allen User-Antworten enthalten. Bis zur Änderung sind nur /me lesen, Passwortänderung, Refresh und Logout zulässig; andere Fachendpunkte liefern 403 `AUTH_PASSWORD_CHANGE_REQUIRED`. Erfolgreiche Passwortänderung setzt Flag zurück und widerruft Sitzungen; danach neu anmelden.
- WorkerAssignment exakt nach Claudes Vorschlag: id, workerId, workerName, scope TRAIN|COMPANY, trainId/trainNumber/companyId/companyName nullable, validFrom/validUntil nullable, version. Genau eine Zielreferenz entsprechend scope; bei TRAIN sind companyId/companyName in der Response die aufgelöste Gesellschaft. workerId muss einem Worker gehören.
- /admin/worker-assignments GET mit workerId/companyId/trainId und Pagination; POST mit workerId/scope/passender Referenz/Gültigkeit; PATCH nur Gültigkeit plus version; DELETE mit version. POST 201, PATCH 200, DELETE 204.
- GET /operations/assignments: eigene Zuweisungen als Listenhülle. Gültigkeit umfasst [validFrom, validUntil), null bedeutet unbeschränkt. COMPANY erlaubt explizit alle Züge dieser Gesellschaft. Rechte werden pro Schreibzugriff neu geprüft, auch nach Zuweisungsänderungen.

### Importe und Live-Daten

ImportJob nach Claude angenommen: `{ id, country, kind: 'RAILWAYS'|'STATIONS', status: 'QUEUED'|'RUNNING'|'DONE'|'FAILED', progress: number|null, startedAt: string|null, finishedAt: string|null, errorCode: string|null, errorMessage: string|null }`. progress 0..100, null bei unbekanntem Fortschritt; DONE=100. Fehler enthalten keine Zugangsdaten oder internen Stacktraces.

POST /admin/imports `{ country, kind }` → **202** ImportJob (asynchron). GET /admin/imports/:id → 200 ImportJob. Polling alle 3 Sekunden angenommen; bei DONE/FAILED stoppen. Nur serverseitig konfigurierte Quellen; keine beliebigen Benutzer-URLs. Gleichzeitiger gleicher Import: 409 `IMPORT_ALREADY_RUNNING`.

Alle Socket-Abonnements und neuen Events aus der zweiten Runde sind von Claude bestätigt, einschließlich map.train.removed und positionVersion. Die früheren Vorschlagsmarkierungen hierfür sind erledigt. 400-ms-Entprellung und Neuverbindung nach Tokenwechsel sind angenommen. Beim Wechsel des Kartenausschnitts wird ein neuer Snapshot geladen; Events des vorherigen Ausschnitts dürfen keine entfernten Marker wiederherstellen. Eine Implementierungsprüfung muss außerdem zeigen, dass Snapshot-Pagination bei bewegten Zügen konsistent bleibt; hierfür wird vor Umsetzung ein Snapshot-Token bzw. eine gleichwertige konsistente Abfrage spezifiziert.

## Abschließende Backend-Festlegung: Snapshots, DST und Importkonflikte

### Konsistente Kartenansicht

- Nur `/map/trains` erlaubt pageSize bis 500 (Standard 100). Dass eine Seite für ein ganzes Land reicht, wird nicht vorausgesetzt.
- Seite 1 erstellt stets einen unveränderlichen Snapshot mit stabiler Sortierung nach tripId. Antwort: `{ items, total, page, pageSize, snapshotToken, snapshotAt, snapshotExpiresAt, snapshotRevision }`. Token ist opak, an Benutzer, normalisierte Filter und pageSize gebunden, Gültigkeit 120 Sekunden; keine offene Datenbanktransaktion über HTTP-Anfragen hinweg.
- Folgeseiten senden denselben snapshotToken sowie unveränderte Filter/pageSize. Der Token referenziert gespeicherte Antwortdaten einschließlich ihrer Positionsversionen. Ablauf: 410 `MAP_SNAPSHOT_EXPIRED`; Filterabweichung: 400 `MAP_SNAPSHOT_MISMATCH`. Das Frontend beginnt dann bei Seite 1 neu.
- `snapshotRevision` ist eine numerische, global monotone Revision des veröffentlichten Kartenstands. Snapshot und Ereignisse müssen aus demselben konsistenten Stand entstehen. `positionVersion` gilt hingegen nur pro tripId; sie ist weder mit snapshotAt noch mit der globalen Revision vergleichbar.
- `map.subscribe` erweitert sich um eine vom Client erzeugte `subscriptionId` (UUID): `{ subscriptionId, country, bbox }`. Acknowledgement `{ ok: true, subscriptionId }`. Kartenereignisse tragen zusätzlich `subscriptionId` und `mapRevision` in der Hülle. Ereignisse aus expliziten Fahrtabos benötigen diese Kartenfelder nicht.
- Ablauf: abonnieren, Ack abwarten, Kartenereignisse puffern, alle Snapshot-Seiten laden, dann Ereignisse mit mapRevision > snapshotRevision anwenden. Zusätzlich pro tripId nur höhere positionVersion/Entfernungsversion anwenden. Auch `map.train.removed` trägt version und mapRevision. Für ein im Snapshot fehlendes Fahrzeug entscheidet zunächst mapRevision, nicht ein angenommener Versionswert null/0.
- Neue Ausschnitte erhalten neue subscriptionIds; alte HTTP-Antworten und Ereignisse werden verworfen. Removal-Versionen bleiben während des Abonnements als Löschmarkierung erhalten, damit ältere Positionsmeldungen keinen Marker wieder einsetzen. Reconnect beginnt mit neuem Abo und Snapshot.

### Zeitzonen und Zeitumstellungen

- Anzeige konkreter Zeiten erfolgt in Station.timeZone. Fahrplan-Offsets beziehen sich ausschließlich auf schedule.timeZone; das muss bei späteren grenzüberschreitenden Routen vom Anzeigeort unterschieden werden.
- Fahrpläne erhalten `dstDisambiguation: 'REJECT' | 'EARLIER' | 'LATER'` (Standard REJECT). Das Backend bildet serviceDate plus lokale Kalender-Tagesoffsets und lokale Uhrzeit auf UTC ab; es addiert nicht pauschal Sekunden zu einem UTC-Mitternachtswert.
- Nicht existente Ortszeit: 400 `SCHEDULE_TIME_NONEXISTENT`. Keine automatische Verschiebung; Administrator korrigiert die Zeit oder nimmt das betroffene Datum per Kalenderausnahme aus.
- Doppelte Ortszeit: bei REJECT 400 `SCHEDULE_TIME_AMBIGUOUS`; EARLIER wählt den ersten, LATER den zweiten UTC-Zeitpunkt. Die Entscheidung wird im Fahrplan gespeichert. Nach Auflösung wird die gesamte Haltreihenfolge erneut validiert; unplausible Reihenfolge: 400 `SCHEDULE_TIME_ORDER_INVALID`.
- Prüfung erfolgt beim Anlegen/Ändern über die gültigen Verkehrstage der Fahrplanperiode und erneut bei Generierung. Feldfehler nennen Halt, Datum und Zeitzone in der Fallback-Meldung. Ein später auftretender Generierungsfehler wird sichtbar protokolliert und verhindert die fehlerhafte Fahrt, statt still andere Zeiten zu erzeugen.
- Sonderfahrten und Worker-Änderungen senden bereits eindeutige UTC-Zeitpunkte. Daraus kann das Backend die ursprünglich eingetippte Ortszeit nicht rekonstruieren. Deshalb muss das Frontend lokale Eingaben vor UTC-Konvertierung prüfen: Lücke ablehnen, bei Überlappung erste/zweite Instanz auswählen lassen. Keine stille Normalisierung durch native Date-Konstruktoren. Die oben genannten Codes können dafür auch als lokale Übersetzungsschlüssel dienen. Angezeigte Zeitzone nicht dauerhaft auf Europe/Vienna fest verdrahten.

### Laufenden Import auffinden

Damit die vereinbarte UI bei IMPORT_ALREADY_RUNNING den laufenden Job tatsächlich öffnen kann, erhält diese 409-Antwort zusätzlich `details: { jobId: string }`. Das allgemeine Fehlerformat erlaubt ein optionales dokumentiertes details-Objekt; dessen Schema wird je Fehlercode definiert. Anschließend GET /admin/imports/:jobId verwenden. Es werden nur Jobs aus dem für diesen Administrator zulässigen Kontext referenziert.

## Nachträge Backend (Claude, nach Übernahme von Codex) – 2026-10-14

- Admin-Versionskonflikte (PATCH/DELETE unter `/admin`) liefern 409 `VERSION_CONFLICT`; Fahrten weiterhin `TRIP_VERSION_CONFLICT`.
- `GET /health/live` (öffentlich): `{ status: 'ok', version }` – Version aus `VERSION` im Projektstamm.
- Refresh: Wiederverwendung desselben Refresh-Tokens innerhalb von 20 s (mehrere Tabs) gibt ein neues Token derselben Sitzung aus; spätere Wiederverwendung sperrt die Sitzung wie bisher. Konfigurierbar über `REFRESH_REUSE_GRACE_MS`.
- Rate-Limit: streng (40/min) nur für `/auth/login`, `/auth/register`, `/me/password`; CSRF-Bootstrap und Refresh zählen zum allgemeinen Kontingent.
- `/countries` enthält zusätzlich DE, CH, CZ, HU, SI, SK, IT, LI (aktivierbar, Daten per Import).
- Import (nur Entwicklung, `ENABLE_OVERPASS_IMPORT=true`): beliebiges Land per ISO-Code, Abfrage in Kacheln, ohne Abstell-/Rangiergleise (`service=*`).

## Bedienbarkeit (Claude, Umsetzung von `backend.md`) – 2026-10-16

Alles additiv, Migration `Usability1793000000000` (Extensions `unaccent`, `pg_trgm`).

- **StationRef** hat jetzt immer `timeZone` (Halte, Tafel, Verbindungen, Fahrkarten, Favoriten). `Station` zusätzlich `aliases: string[]` (Admin kann sie setzen).
- **Bahnhofssuche** `GET /stations?q=`: normalisiert über `station_key()` (Groß/klein, ü → ue, Akzente, ß, `Hbf`/`Bf`/`St.`, Satzzeichen). Reihenfolge: Namensanfang, Wortanfang/Kürzel, Teiltreffer/Zweitname, ab 4 Zeichen Tippfehler (`word_similarity ≥ 0.4`). Ohne `q` alphabetisch.
- `GET /stations/:id` → `Station & { lines: { id, name, color }[] }`.
- `GET /stations/nearby?lng&lat&pageSize=5(≤20)&country?` → Listenhülle von `Station & { distanceMeters }`, nächster zuerst. Der Standort wird nicht gespeichert.
- **BoardEntry** (auch in `Connection.legs[].from/to`): `platformChanged: boolean`, `via: StationRef[]` (max. 3 wichtige Halte danach bzw. davor, nach Anzahl Linien, ohne Start/Ziel).
- **Connection.legs[]**: `transferSeconds: number | null` (Echtzeit, null beim ersten Abschnitt), `transferAtRisk: boolean` (< 5 Min. oder < 10 Min. mit verspätetem Zubringer).
- **TripSummary/TripDetail**: `lastObservedAt: string | null` (letzte echte Positionsmeldung).
- **Favoriten**: `GET /me/favorite-stations` → `StationRef[]`; `PUT /me/favorite-stations { stationIds: uuid[] (≤ 12) }` → `StationRef[]`. Duplikate → 400 `VALIDATION_FAILED`, unbekannter Bahnhof → 400 `STATION_NOT_FOUND`. Gelöschte Bahnhöfe verschwinden per `ON DELETE CASCADE`.
- **Störungen**: `GET /disruptions?country&stationId&lineId&activeAt&page&pageSize` (aktive, SEVERE zuerst; mit Bahnhof/Linie nur betroffene plus netzweite) → `Disruption = { id, country, severity: INFO|WARNING|SEVERE, reasonCode, title, text, validFrom, validUntil|null, stationIds, lineIds, createdAt, version }`. Admin-CRUD `/admin/disruptions` im üblichen Versionsmuster. Socket-Event `disruption.updated` an alle angemeldeten Clients (gelöscht: `data.deleted = true`).
- **Weitergabe** `PATCH /operations/trips/:id/stops/:stopId` mit `propagate: true` (nur zusammen mit `expectedArrival`/`expectedDeparture`): Abweichung dieses Halts gilt für alle folgenden, nicht ausgefallenen Halte ohne Ist-Zeit und ohne Handwert. Antwort unverändert (`TripStop`).
- **Änderungsprotokoll** `GET /admin/audit?entityId&actorId&action(Präfix)&from&to&page&pageSize` → `{ id, at, actorId, actorName, action, entityId, details }`, neueste zuerst.
- **Status** `GET /health/status` (öffentlich) → `{ status, realtime: LIVE|STALE|SCHEDULE_ONLY, lastPositionAt }`. LIVE = echte Position < 5 Min., STALE = Positionsgeber aktiv, aber still, SCHEDULE_ONLY = keine aktiven Positionsgeber.
- **Caching**: `Cache-Control: private` für `/countries`, `/lines` (5 Min.) und `/map/railways` (10 Min.); ETag/304 über Express.
