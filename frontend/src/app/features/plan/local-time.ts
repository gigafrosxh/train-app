import { inject, Injectable } from '@angular/core';
import { I18n } from '../../core/i18n/i18n.service';
import { localDate, resolveLocal } from '../../core/i18n/format.service';
import { Confirm } from '../../shared/confirm.dialog';

/**
 * Wandelt eine lokale Eingabe (HH:MM) in UTC um und fragt bei Zeitumstellung nach.
 * Ergebnis null = abgebrochen oder ungültig (Fehler wurde gemeldet).
 */
@Injectable({ providedIn: 'root' })
export class LocalTimeInput {
  private readonly i18n = inject(I18n);
  private readonly confirm = inject(Confirm);

  async toUtc(date: string, hhmm: string, zone: string): Promise<{ utc: string } | { error: string } | null> {
    const r = resolveLocal(date, hhmm, zone);
    if (r.kind === 'ok') return { utc: r.utc };
    if (r.kind === 'nonexistent') return { error: this.i18n.t('errors.SCHEDULE_TIME_NONEXISTENT') };
    const choice = await this.confirm.choose({
      title: this.i18n.t('dst.title'),
      text: this.i18n.t('dst.text', { time: hhmm }),
      confirm: this.i18n.t('dst.earlier'),
      cancel: this.i18n.t('dst.later'),
    });
    if (choice === undefined) return null;
    return { utc: choice ? r.earlier : r.later };
  }

  /** Lokales Datum, an dem eine Zeit liegt – Basis für Eingaben in derselben Nacht. */
  dateOf(iso: string, zone: string) {
    return localDate(iso, zone);
  }
}
