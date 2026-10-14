# Gleis – Train App

Web-App zur Verwaltung von Zügen und Zuglinien eines Landes (Start: Österreich).

| Ordner | Inhalt |
| --- | --- |
| [`frontend/`](frontend/README.md) | Angular 22, Angular Material 3, MapLibre (3D-Karte) |
| [`backend/`](backend/README.md) | NestJS, PostgreSQL/PostGIS, Socket.IO |
| [`docs/`](docs/) | API-Vertrag und Abstimmung zwischen Frontend und Backend |

## Schnellstart

```bash
# Nur Frontend mit Beispieldaten
cd frontend && npm install && npm start
```

Mit Backend: siehe [backend/README.md](backend/README.md), danach `cd frontend && npm run start:live`.
Die App läuft auf http://localhost:4200.

## Versionen & Releases

- Die Version steht in [`VERSION`](VERSION) und gilt für Frontend und Backend gemeinsam. Sie wird unten auf jeder Seite angezeigt.
- Neue Version: `node scripts/version.mjs set 0.2.0`, dann Einträge in [`CHANGELOG.md`](CHANGELOG.md) ergänzen und committen.
- **Vorabversion:** Tag `v0.2.0-rc.1` pushen → GitHub Actions baut alles und legt ein *Pre-release* an.
- **Release:** nach dem Test Tag `v0.2.0` pushen → normales *Release*.

```bash
git tag v0.2.0-rc.1 && git push origin v0.2.0-rc.1
git tag v0.2.0 && git push origin v0.2.0
```

Jedes Release enthält das gebaute Frontend (`gleis-frontend-*.zip`) und Backend (`gleis-backend-*.tar.gz`).
