# Änderungen

Alle Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).
Vor jeder Version gibt es mindestens eine Vorabversion (`vX.Y.Z-rc.N`) zum Testen.

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
