# Gleis – Frontend

Angular 22 (Standalone Components, Signals, zoneless), Angular Material 3 mit eigenem Blau-Theme, MapLibre GL für die 3D-Karte.

## Starten

```bash
npm install
npm start            # Demo-Modus: Beispieldaten im Browser, kein Backend nötig
npm run start:live   # echtes NestJS-Backend über Proxy (Port 3000), siehe ../backend/README.md
```

Die App läuft auf http://localhost:4200. Das Backend erlaubt nur diesen Origin (CSRF/Origin-Prüfung).
Weitere Befehle: `npm run build` (Produktion), `npm run i18n:check` (prüft, dass jeder Text auf Deutsch und Englisch existiert).

## Anmelden

- **Demo-Modus:** Auf der Login-Seite gibt es Schnellknöpfe für Fahrgast, Mitarbeiter und Admin.
  Die Zugangsdaten stehen in `src/app/core/mock/mock-db.ts` (`DEMO_ACCOUNTS`, `DEMO_PASSWORD`). Sie gelten nur für den Demo-Modus.
- **Mit Backend:** Die Konten stehen in `../backend/README.md`, das Passwort steht lokal in `../backend/.env` (`DEMO_PASSWORD`).

## Aufbau

```
src/app/
  core/       API-Services, Auth (JWT, Refresh-Cookie, CSRF), Guards, i18n, Einstellungen, Socket.IO, Mock-Backend
  shared/     Bausteine: Liniensymbol, Zeiten/Verspätung, Bahnhofssuche, Bestätigungsdialog
  layout/     App-Rahmen: Seitenleiste (Desktop), untere Leiste (Handy)
  features/
    auth/     Login, Registrierung, Pflicht-Passwortwechsel
    home/     Übersicht: nächste Fahrt, Hinweise, Fahrkarten, zuletzt angesehen
    tickets/  Fahrkarten mit QR-Code, eigene Tickets speichern
    rail/     Abfahrten, Verbindungssuche, Linien, Fahrtverlauf
    map/      3D-Karte (gewähltes Land angehoben, nur Bahnstrecken)
    account/  Profil, Sprache, Hell/Dunkel, Schriftgröße, Passwort
    plan/     Worker: Verspätungen, Ausfälle, Halte anpassen
    setup/    Admin: Land & Import, Netz, Fahrpläne, Benutzer, Zuweisungen
```

## Wichtige Regeln (aus `docs/api-contract.md`)

- Access-Token nur im Speicher; Refresh über HttpOnly-Cookie. Vor Login/Registrierung wird `GET /auth/csrf` aufgerufen.
- Texte kommen nie vom Server: Fehler werden über ihren `code` übersetzt (`src/app/core/i18n/de.ts`, `en.ts`).
- Zeiten werden in der Zeitzone des aktiven Landes angezeigt. Lokale Eingaben (Worker, Sonderfahrten) werden vor der
  UTC-Umrechnung auf Zeitumstellung geprüft (`resolveLocal`): Eine Lücke wird abgelehnt, bei einer Überlappung fragt die App nach.
- Änderungen senden immer die `version`. Bei 409 bietet die App „Neu laden“ an.
- Live-Daten per Socket.IO. REST bleibt maßgeblich: Nach einem Reconnect lädt die App den aktuellen Stand neu.

## Barrierefreiheit & Darstellung

- Schriftgröße (Klein/Normal/Groß) und Hell/Dunkel stellst du im Konto ein. Die Einstellung wird am Konto gespeichert.
- Alle Größen sind in `rem` angegeben, Texte umbrechen statt abgeschnitten zu werden.
- Animationen sind kurz (150–250 ms) und werden bei `prefers-reduced-motion` abgeschaltet.
