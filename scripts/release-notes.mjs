#!/usr/bin/env node
// Gibt die Release-Notizen für einen Tag aus (Abschnitt aus CHANGELOG.md).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] ?? '';
const m = /^v(\d+\.\d+\.\d+)(?:-(.+))?$/.exec(tag);
if (!m) {
  console.error(`Ungültiger Tag: ${tag}`);
  process.exit(1);
}
const [, version, pre] = m;
const log = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const start = log.indexOf(`## [${version}]`);
let body = 'Keine Einträge im CHANGELOG.';
if (start >= 0) {
  const rest = log.slice(start).split('\n').slice(1);
  const end = rest.findIndex((l) => l.startsWith('## ['));
  body = (end >= 0 ? rest.slice(0, end) : rest).join('\n').trim();
}
const head = pre
  ? `> **Vorabversion** (${pre}) von ${version} zum Testen. Noch nicht für den Betrieb gedacht.\n\n`
  : '';
console.log(`${head}${body}\n\nDetails zum Start: README.md im Repository.`);
