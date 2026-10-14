import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { SettingsApi } from '../api/api';
import { AuthService } from '../auth/auth.service';
import { COUNTRY_TIME_ZONES, DEFAULT_TIME_ZONE, Format } from '../i18n/format.service';
import { Country, Settings } from '../models/api.models';

/** Aktives Land, Suchfenster und Länderliste – nach dem Login geladen. */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly api = inject(SettingsApi);
  private readonly auth = inject(AuthService);
  private readonly format = inject(Format);

  readonly settings = signal<Settings | null>(null);
  readonly countries = signal<Country[]>([]);
  readonly activeCountry = computed(() => this.settings()?.activeCountry ?? 'AT');
  readonly zone = computed(() => COUNTRY_TIME_ZONES[this.activeCountry()] ?? DEFAULT_TIME_ZONE);
  readonly country = computed(() => this.countries().find((c) => c.code === this.activeCountry()) ?? null);

  private readonly userId = computed(() => this.auth.user()?.id ?? null);

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => (id ? this.reload() : this.settings.set(null)));
    });
    effect(() => this.format.zone.set(this.zone()));
  }

  reload() {
    this.api.settings().subscribe({ next: (s) => this.settings.set(s), error: () => {} });
    this.api.countries().subscribe({ next: (p) => this.countries.set(p.items), error: () => {} });
  }

  set(s: Settings) {
    this.settings.set(s);
  }
}
