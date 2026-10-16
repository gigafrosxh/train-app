# Änderungen

Alle Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).
Vor jeder Version gibt es mindestens eine Vorabversion (`vX.Y.Z-rc.N`) zum Testen.

## [Unveröffentlicht]

### Neu
- Lieblingsbahnhöfe: Stern auf der Abfahrtstafel, Favoriten und zuletzt gewählte Bahnhöfe direkt im Bahnhofsfeld
- Home: „Deine Bahnhöfe“ öffnet die Abfahrtstafel mit einem Tipp
- Hinweis bei fehlender Internetverbindung

### Verbessert
- Bahnhofssuche zeigt bei leerem Feld kein „Kein Bahnhof gefunden“ mehr
- Abhängigkeiten aktualisiert: Angular 22.2.3, MapLibre GL 6 (behebt kritische XSS-Lücke), socket.io-client 4.8.4, vitest 5.0.5

### Sicherheit
- `npm audit` in Frontend und Backend ohne Befund (Backend: js-yaml ≥ 5.5 für `@nestjs/swagger`)

## [0.3.0] – 2026-10-14

### Neu
- Demo-Netz Österreich auf echten OSM-Daten (`npm run seed:network`): 13 Linien, ~330 Fahrpläne, Züge fahren auf der Karte entlang der echten Strecken
- Unit-Tests für die Frontend-Kernlogik, CI-Workflow für jeden Push auf `main`

### Verbessert
- Bahnhofssuche: „Hbf“ und „Hauptbahnhof“ gleichwertig (Frontend und Backend)
- Admin-Listen alphabetisch sortiert
- Positionsberechnung zwischengespeichert (Streckenverlauf, Bahnhofskoordinaten)
- Keine doppelten Anfragen mehr beim Start (Home, Karte)

### Behoben
- Doppelte Bahnhöfe aus Demo-Daten und OSM-Import zusammengeführt; Import und Seed legen keine Duplikate mehr an
- Karte: kein Fehler mehr beim Verlassen während des Ladens

## [0.2.0] – 2026-10-14

### Neu
- Echte Bahndaten aus OpenStreetMap: Import für jedes Land (Strecken und Bahnhöfe), Österreich importiert
- Nachbarländer (DE, CH, CZ, HU, SI, SK, IT, LI) im Setup auswählbar
- Server-Version am Seitenrand (07d958d), `/health/live` liefert `version`

### Verbessert
- Karte: Schienennetz in der Übersicht zusammengefasst, Details beim Hineinzoomen; erhöhtes Land mit weichen Kanten
- Beschriftungen überlappen nicht mehr; Züge sitzen korrekt auf der Strecke

### Behoben
- Ungewollte Abmeldung beim Neuladen (Rate-Limit auf Refresh, mehrere Tabs)

## [0.1.0] – 2026-10-14

Erste Version von **Gleis** – Züge und Fahrpläne für ein ganzes Land.

### Neu
- Anmeldung mit drei Rollen (Fahrgast, Mitarbeiter, Admin), JWT, Refresh-Cookie und CSRF-Schutz.
- **Home:** nächste Fahrt mit Countdown, Hinweise zu Verspätungen, Fahrkarten, zuletzt angesehene Fahrten.
- **Fahrkarten:** Tickets mit QR-Code, eigene Tickets speichern.
- **Fahrplan:** Abfahrten und Ankünfte live, Verbindungssuche mit Umstiegen, Linien, Fahrtverlauf.
- **Karte:** 3D-Karte ohne Straßen. Das gewählte Land ist angehoben, Züge fahren live auf ihren Strecken.
- **Konto:** Deutsch/Englisch, Hell/Dunkel, Schriftgröße, Passwort ändern.
- **Plan (Mitarbeiter):** Verspätungen, Ausfälle und Änderungen an Halten mit Konfliktschutz.
- **Setup (Admin):** Land und Datenimport aus OpenStreetMap, Bahnhöfe, Strecken, Linien, Routen, Fahrpläne, Sonderfahrten, Benutzer, Zuweisungen.
- Backend mit NestJS, PostgreSQL/PostGIS, Socket.IO und OpenAPI.
- Versionsnummer am unteren Seitenrand, mit Link zum Release.
