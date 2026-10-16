import { Injectable, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { StationRef } from '../models/api.models';
import { readStorage, writeStorage } from '../util/storage';

// Getrennt je Modus, da Demo- und Server-IDs verschieden sind
const SUFFIX = environment.useMocks ? '.demo' : '';
const FAV_KEY = `gleis.stations.favorites${SUFFIX}`;
const RECENT_KEY = `gleis.stations.recent${SUFFIX}`;
const MAX_RECENT = 6;
const MAX_FAV = 12;

/** Gemerkte Bahnhöfe des Geräts: Favoriten und zuletzt gewählte. Nur lokal, nicht am Konto. */
@Injectable({ providedIn: 'root' })
export class StationMemory {
  readonly favorites = signal<StationRef[]>(load(FAV_KEY));
  readonly recent = signal<StationRef[]>(load(RECENT_KEY));

  isFavorite(id: string | null | undefined) {
    return !!id && this.favorites().some((s) => s.id === id);
  }

  toggleFavorite(s: StationRef) {
    const list = this.isFavorite(s.id)
      ? this.favorites().filter((f) => f.id !== s.id)
      : [...this.favorites(), slim(s)].slice(-MAX_FAV);
    this.favorites.set(list);
    writeStorage(FAV_KEY, JSON.stringify(list));
  }

  remember(s: StationRef) {
    const list = [slim(s), ...this.recent().filter((r) => r.id !== s.id)].slice(0, MAX_RECENT);
    this.recent.set(list);
    writeStorage(RECENT_KEY, JSON.stringify(list));
  }

  /** Bahnhof existiert nicht mehr (z. B. nach Wechsel Demo → Server): überall vergessen. */
  forget(id: string) {
    this.favorites.update((l) => l.filter((s) => s.id !== id));
    this.recent.update((l) => l.filter((s) => s.id !== id));
    writeStorage(FAV_KEY, JSON.stringify(this.favorites()));
    writeStorage(RECENT_KEY, JSON.stringify(this.recent()));
  }
}

function slim(s: StationRef): StationRef {
  return { id: s.id, name: s.name, code: s.code };
}

function load(key: string): StationRef[] {
  try {
    const v = JSON.parse(readStorage(key) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string') : [];
  } catch {
    return [];
  }
}
