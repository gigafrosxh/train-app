import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccountApi } from '../api/api';
import { AuthService } from '../auth/auth.service';
import { I18n } from '../i18n/i18n.service';
import { FontScale, Language, Preferences, ThemeMode } from '../models/api.models';
import { readStorage, writeStorage } from '../util/storage';

const KEY = 'gleis.prefs';

function stored(): Partial<Preferences> {
  try {
    return JSON.parse(readStorage(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Darstellung: Sprache, Hell/Dunkel, Schriftgröße. Lokal sofort, am Konto gespeichert. */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly i18n = inject(I18n);
  private readonly auth = inject(AuthService);
  private readonly api = inject(AccountApi);

  readonly theme = signal<ThemeMode>(stored().theme ?? 'system');
  readonly fontScale = signal<FontScale>(stored().fontScale ?? 'md');
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const root = document.documentElement;
      const theme = this.theme();
      if (theme === 'system') delete root.dataset['theme'];
      else root.dataset['theme'] = theme;
      root.dataset['font'] = this.fontScale();
      writeStorage(
        KEY,
        JSON.stringify({ theme, fontScale: this.fontScale(), language: this.i18n.lang() }),
      );
    });

    // Nach dem Login gelten die gespeicherten Präferenzen des Kontos.
    effect(() => {
      const prefs = this.auth.user()?.preferences;
      if (!prefs) return;
      untracked(() => {
        this.theme.set(prefs.theme);
        this.fontScale.set(prefs.fontScale);
        this.i18n.setLanguage(prefs.language);
      });
    });
  }

  setTheme(theme: ThemeMode) {
    this.theme.set(theme);
    this.persist({ theme });
  }

  setFontScale(fontScale: FontScale) {
    this.fontScale.set(fontScale);
    this.persist({ fontScale });
  }

  setLanguage(language: Language) {
    this.i18n.setLanguage(language);
    this.persist({ language });
  }

  private pending: Partial<Preferences> = {};

  private persist(change: Partial<Preferences>) {
    if (!this.auth.user()) return;
    this.pending = { ...this.pending, ...change };
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const preferences = this.pending;
      this.pending = {};
      this.api.update({ preferences }).subscribe({
        next: (user) => this.auth.updateUser(user),
        error: () => {
          // Lokal bleibt die Wahl erhalten; beim nächsten Mal erneut versuchen.
        },
      });
    }, 500);
  }
}
