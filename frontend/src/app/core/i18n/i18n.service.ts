import { computed, Injectable, signal } from '@angular/core';
import { Language } from '../models/api.models';
import { readStorage, writeStorage } from '../util/storage';
import { de } from './de';
import { en } from './en';

export type Dict = { [key: string]: string | Dict };
type Params = Record<string, string | number | null | undefined>;

const DICTS: Record<Language, Dict> = { de, en };
const STORAGE_KEY = 'gleis.lang';

function lookup(dict: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function initialLanguage(): Language {
  const stored = readStorage(STORAGE_KEY);
  if (stored === 'de' || stored === 'en') return stored;
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Language>(initialLanguage());
  readonly locale = computed(() => (this.lang() === 'de' ? 'de-AT' : 'en-GB'));

  constructor() {
    document.documentElement.lang = this.lang();
  }

  setLanguage(lang: Language): void {
    this.lang.set(lang);
    document.documentElement.lang = lang;
    writeStorage(STORAGE_KEY, lang);
  }

  /** Übersetzt einen Schlüssel. Platzhalter: {name}. */
  t(key: string, params?: Params): string {
    const text = lookup(DICTS[this.lang()], key) ?? lookup(DICTS.de, key) ?? key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
  }

  has(key: string): boolean {
    return lookup(DICTS[this.lang()], key) !== undefined;
  }
}
