#!/usr/bin/env node
// Eine Versionsnummer für das ganze Projekt (Datei VERSION, SemVer).
//   node scripts/version.mjs                → aktuelle Version anzeigen
//   node scripts/version.mjs set 0.2.0      → VERSION + frontend/backend package.json setzen
//   node scripts/version.mjs check v0.2.0-rc.1 → prüft, ob ein Tag zur Version passt
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const TAG = /^v(\d+\.\d+\.\d+)(-(alpha|beta|rc)\.\d+)?$/;
const read = () => readFileSync(join(root, 'VERSION'), 'utf8').trim();

function setPackage(dir, version) {
  for (const file of ['package.json', 'package-lock.json']) {
    const p = join(root, dir, file);
    if (!existsSync(p)) continue;
    const json = JSON.parse(readFileSync(p, 'utf8'));
    json.version = version;
    if (json.packages?.['']) json.packages[''].version = version;
    writeFileSync(p, JSON.stringify(json, null, 2) + '\n');
  }
}

const [cmd, arg] = process.argv.slice(2);
if (!cmd) {
  console.log(read());
} else if (cmd === 'set') {
  if (!SEMVER.test(arg ?? '')) {
    console.error('Bitte eine Version wie 1.2.3 angeben.');
    process.exit(1);
  }
  writeFileSync(join(root, 'VERSION'), arg + '\n');
  setPackage('frontend', arg);
  setPackage('backend', arg);
  console.log(`Version gesetzt: ${arg}`);
} else if (cmd === 'check') {
  const m = TAG.exec(arg ?? '');
  if (!m) {
    console.error(`Tag "${arg}" passt nicht zum Schema vX.Y.Z oder vX.Y.Z-rc.N`);
    process.exit(1);
  }
  const version = read();
  const pkgs = ['frontend', 'backend'].map((d) => JSON.parse(readFileSync(join(root, d, 'package.json'), 'utf8')).version);
  if (m[1] !== version || pkgs.some((v) => v !== version)) {
    console.error(`Tag ${arg} passt nicht zu VERSION ${version} (frontend ${pkgs[0]}, backend ${pkgs[1]})`);
    process.exit(1);
  }
  console.log(`OK: ${arg} ${m[2] ? '(Vorabversion)' : '(Release)'}`);
} else {
  console.error('Unbekannter Befehl. Erlaubt: set, check');
  process.exit(1);
}
