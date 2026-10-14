import { de } from './de';
import { en } from './en';

type Dict = { [k: string]: string | Dict };

function keys(d: Dict, prefix = ''): string[] {
  return Object.entries(d).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`)));
}

function placeholders(text: string) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

function lookup(d: Dict, key: string): string {
  return key.split('.').reduce<string | Dict>((n, p) => (n as Dict)[p], d) as string;
}

describe('Übersetzungen', () => {
  const deKeys = keys(de as Dict);

  it('Deutsch und Englisch haben dieselben Schlüssel', () => {
    expect(keys(en as Dict).sort()).toEqual([...deKeys].sort());
  });

  it('Platzhalter stimmen in beiden Sprachen überein', () => {
    const wrong = deKeys.filter(
      (k) => placeholders(lookup(de as Dict, k)).join() !== placeholders(lookup(en as Dict, k)).join(),
    );
    expect(wrong).toEqual([]);
  });

  // Bewusst leer: keine Rolle vor dem Login, kein Hinweis wenn Kartendaten bereit sind
  const INTENTIONALLY_EMPTY = ['roles.null', 'map.dataStatus.READY'];

  it('kein Text ist leer (außer bewusst leeren)', () => {
    const empty = deKeys.filter((k) => !INTENTIONALLY_EMPTY.includes(k) && (!lookup(de as Dict, k).trim() || !lookup(en as Dict, k).trim()));
    expect(empty).toEqual([]);
  });
});
