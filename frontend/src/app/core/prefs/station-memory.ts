import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AccountApi } from '../api/api';
import { AuthService } from '../auth/auth.service';
import { StationRef } from '../models/api.models';
import { readStorage, writeStorage } from '../util/storage';

// Getrennt je Modus, da Demo- und Server-IDs verschieden sind
const SUFFIX = environment.useMocks ? '.demo' : '';
const FAV_KEY = `gleis.stations.favorites${SUFFIX}`;
const RECENT_KEY = `gleis.stations.recent${SUFFIX}`;
/** Konto, dem der lokale Favoritenstand gehört (leer = Stand aus der Zeit vor dem Kontoabgleich) */
const OWNER_KEY = `gleis.stations.owner${SUFFIX}`;
const MAX_RECENT = 6;
const MAX_FAV = 12;

/**
 * Gemerkte Bahnhöfe: Favoriten liegen am Konto (GET/PUT /me/favorite-stations) und zusätzlich lokal
 * als Zwischenstand für den schnellen Start. Zuletzt gewählte bleiben nur auf diesem Gerät.
 */
@Injectable({ providedIn: 'root' })
export class StationMemory {
  private readonly api = inject(AccountApi);
  readonly favorites = signal<StationRef[]>(load(FAV_KEY));
  readonly recent = signal<StationRef[]>(load(RECENT_KEY));

  constructor() {
    const auth = inject(AuthService);
    let previous: string | null = null;
    effect(() => {
      const id = auth.user()?.id ?? null;
      untracked(() => {
        if (id) this.sync(id);
        // Abgemeldet: Favoriten gehören zum Konto, nicht auf ein geteiltes Gerät
        else if (previous) this.setFavorites([]);
        previous = id;
      });
    });
  }

  /**
   * Nach dem Login: Kontostand übernehmen. Ist das Konto leer, lokale Favoriten einmalig hochladen, aber nur
   * den Stand aus der Zeit vor dem Kontoabgleich (nie den eines anderen Kontos, nie auf anderen Geräten Gelöschtes).
   */
  private sync(userId: string) {
    this.api.favoriteStations().subscribe({
      next: (server) => {
        const local = this.favorites();
        const owner = readStorage(OWNER_KEY);
        if (!server.length && local.length && !owner) this.push(local);
        else this.setFavorites(server);
        writeStorage(OWNER_KEY, userId);
      },
      error: () => {
        // Offline oder älteres Backend: lokaler Stand bleibt
      },
    });
  }

  private push(list: StationRef[]) {
    this.api.setFavoriteStations(list.map((s) => s.id)).subscribe({
      next: (saved) => this.setFavorites(saved),
      error: () => {},
    });
  }

  private setFavorites(list: StationRef[]) {
    this.favorites.set(list.map(slim));
    writeStorage(FAV_KEY, JSON.stringify(this.favorites()));
  }

  isFavorite(id: string | null | undefined) {
    return !!id && this.favorites().some((s) => s.id === id);
  }

  toggleFavorite(s: StationRef) {
    const list = this.isFavorite(s.id)
      ? this.favorites().filter((f) => f.id !== s.id)
      : [...this.favorites(), slim(s)].slice(-MAX_FAV);
    this.setFavorites(list);
    this.push(list);
  }

  remember(s: StationRef) {
    const list = [slim(s), ...this.recent().filter((r) => r.id !== s.id)].slice(0, MAX_RECENT);
    this.recent.set(list);
    writeStorage(RECENT_KEY, JSON.stringify(list));
  }

  /** Bahnhof existiert nicht mehr (z. B. nach Wechsel Demo → Server): überall vergessen. */
  forget(id: string) {
    const wasFavorite = this.isFavorite(id);
    this.setFavorites(this.favorites().filter((s) => s.id !== id));
    this.recent.update((l) => l.filter((s) => s.id !== id));
    writeStorage(RECENT_KEY, JSON.stringify(this.recent()));
    if (wasFavorite) this.push(this.favorites());
  }
}

function slim(s: StationRef): StationRef {
  return { id: s.id, name: s.name, code: s.code, ...(s.timeZone ? { timeZone: s.timeZone } : {}) };
}

function load(key: string): StationRef[] {
  try {
    const v = JSON.parse(readStorage(key) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string') : [];
  } catch {
    return [];
  }
}
