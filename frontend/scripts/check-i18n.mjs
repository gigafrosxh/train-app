// Prüft: alle im Code verwendeten Schlüssel existieren in de und en.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2] ?? process.cwd();
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(ts|html)$/.test(f) && !/i18n\/(de|en)\.ts$|map\.i18n\.ts$/.test(p) && files.push(p); });
walk(join(root, 'src/app'));
const ts = await import(join(root, 'node_modules/typescript/lib/typescript.js')).then((m) => m.default);
function load(p) {
  const src = readFileSync(p, 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  const req = (x) => x.includes('map.i18n') ? load(join(root, 'src/app/features/map/map.i18n.ts')) : {};
  new Function('module', 'exports', 'require', out)(mod, mod.exports, req);
  return mod.exports;
}
const de = load(join(root, 'src/app/core/i18n/de.ts')).de;
const en = load(join(root, 'src/app/core/i18n/en.ts')).en;
const has = (d, k) => k.split('.').reduce((n, p) => (n && typeof n === 'object' ? n[p] : undefined), d) !== undefined;
const prefixes = ['common','nav','shell','roles','time','status','reasons','alerts','login','password','home','tickets','rail','trip','account','plan','dst','setup','trainTypes','usage','userStatus','scope','dataStatus','importStatus','importKind','weekdays','errors','fieldErrors','map','severity','disruptions'];
const re = /'([a-zA-Z]+(?:\.[A-Za-z0-9_]+)+)'/g;
const missing = new Set();
const EVENTS = ['map.subscribe', 'map.unsubscribe', 'map.train.removed', 'trip.updated', 'trip.position.updated', 'trips.subscribe', 'trips.unsubscribe', 'schedule.updated'];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(re)) {
    const k = m[1];
    if (!prefixes.includes(k.split('.')[0])) continue;
    if (k.endsWith('.') || EVENTS.includes(k)) continue;
    for (const [name, d] of [['de', de], ['en', en]]) if (!has(d, k)) missing.add(`${name}: ${k}  (${f.split('/src/app/')[1]})`);
  }
}
console.log(missing.size ? [...missing].sort().join('\n') : 'OK – alle Schlüssel vorhanden');
process.exit(missing.size ? 1 : 0);
