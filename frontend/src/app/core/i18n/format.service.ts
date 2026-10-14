import { inject, Injectable, signal } from '@angular/core';
import { I18n } from './i18n.service';

/** Nur Fallback. Die Anzeige nutzt die Zeitzone des aktiven Landes (Format.zone). */
export const DEFAULT_TIME_ZONE = 'Europe/Vienna';

export const COUNTRY_TIME_ZONES: Record<string, string> = {
  AT: 'Europe/Vienna',
  DE: 'Europe/Berlin',
  CH: 'Europe/Zurich',
  CZ: 'Europe/Prague',
  HU: 'Europe/Budapest',
  IT: 'Europe/Rome',
  SI: 'Europe/Ljubljana',
  SK: 'Europe/Bratislava',
  LI: 'Europe/Vaduz',
};

@Injectable({ providedIn: 'root' })
export class Format {
  private readonly i18n = inject(I18n);
  private readonly cache = new Map<string, Intl.DateTimeFormat>();
  /** Anzeige-Zeitzone (aktives Land). */
  readonly zone = signal(DEFAULT_TIME_ZONE);

  private fmt(options: Intl.DateTimeFormatOptions, timeZone = this.zone()) {
    const locale = this.i18n.locale();
    const key = locale + timeZone + JSON.stringify(options);
    let f = this.cache.get(key);
    if (!f) {
      f = new Intl.DateTimeFormat(locale, { ...options, timeZone });
      this.cache.set(key, f);
    }
    return f;
  }

  /** 08:42 */
  time(iso: string | null | undefined, timeZone?: string): string {
    if (!iso) return '–';
    return this.fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, timeZone).format(
      new Date(iso),
    );
  }

  /** Heute / Morgen / Fr., 16. Okt. */
  day(iso: string | null | undefined, timeZone?: string): string {
    if (!iso) return '–';
    const target = localDate(iso, timeZone ?? this.zone());
    const today = localDate(new Date().toISOString(), timeZone ?? this.zone());
    const diff = daysBetween(today, target);
    if (diff === 0) return this.i18n.t('time.today');
    if (diff === 1) return this.i18n.t('time.tomorrow');
    if (diff === -1) return this.i18n.t('time.yesterday');
    return this.fmt({ weekday: 'short', day: 'numeric', month: 'short' }, timeZone).format(
      new Date(iso),
    );
  }

  /** 16. Okt. 2026, 08:42 */
  dateTime(iso: string | null | undefined, timeZone?: string): string {
    if (!iso) return '–';
    return this.fmt(
      { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
      timeZone,
    ).format(new Date(iso));
  }

  /** 16.10.2026 */
  date(iso: string | null | undefined, timeZone?: string): string {
    if (!iso) return '–';
    return this.fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }, timeZone).format(
      new Date(iso),
    );
  }

  /** 2 Std. 5 Min. */
  duration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) return '–';
    const total = Math.max(0, Math.round(seconds / 60));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return this.i18n.t('time.minutes', { n: m });
    if (m === 0) return this.i18n.t('time.hours', { n: h });
    return this.i18n.t('time.hoursMinutes', { h, m });
  }

  /** in 12 Min. / vor 3 Min. / jetzt */
  relative(iso: string | null | undefined, now = Date.now()): string {
    if (!iso) return '';
    const minutes = Math.round((new Date(iso).getTime() - now) / 60000);
    if (minutes === 0) return this.i18n.t('time.now');
    if (Math.abs(minutes) >= 120) {
      const hours = Math.round(Math.abs(minutes) / 60);
      return this.i18n.t(minutes > 0 ? 'time.inHours' : 'time.agoHours', { n: hours });
    }
    return this.i18n.t(minutes > 0 ? 'time.inMinutes' : 'time.agoMinutes', { n: Math.abs(minutes) });
  }

  /** Verspätung in ganzen Minuten (gerundet). */
  delayMinutes(seconds: number | null | undefined): number {
    if (!seconds) return 0;
    return Math.round(seconds / 60);
  }
}

/** YYYY-MM-DD in einer Zeitzone. */
export function localDate(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** HH:MM in einer Zeitzone. */
export function localTime(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** Offset einer Zeitzone (ms) zu einem Zeitpunkt. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/** Lokale Betriebszeit (Datum + Sekunden ab 00:00) → UTC-ISO. */
export function zonedToUtc(date: string, secondsFromMidnight: number, timeZone = DEFAULT_TIME_ZONE): string {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d) + secondsFromMidnight * 1000;
  let utc = naive - zoneOffset(naive, timeZone);
  utc = naive - zoneOffset(utc, timeZone);
  return new Date(utc).toISOString();
}

/** "HH:MM" an einem lokalen Datum → UTC-ISO. */
export function localDateTimeToUtc(date: string, hhmm: string, timeZone = DEFAULT_TIME_ZONE): string {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedToUtc(date, h * 3600 + m * 60, timeZone);
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(date + 'T00:00:00Z') + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export type LocalResolution =
  | { kind: 'ok'; utc: string }
  | { kind: 'nonexistent' }
  | { kind: 'ambiguous'; earlier: string; later: string };

/**
 * Lokale Eingabe (Datum + HH:MM) sicher nach UTC: erkennt Zeitumstellungen,
 * statt still zu normalisieren. Lücke → nonexistent, Überlappung → ambiguous.
 */
export function resolveLocal(date: string, hhmm: string, timeZone: string): LocalResolution {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, m);
  const offsets = new Set([zoneOffset(naive - 43200000, timeZone), zoneOffset(naive + 43200000, timeZone)]);
  const hits = [...offsets]
    .map((o) => naive - o)
    .filter((utc) => utc + zoneOffset(utc, timeZone) === naive)
    .sort((a, b) => a - b);
  const unique = [...new Set(hits)];
  if (!unique.length) return { kind: 'nonexistent' };
  if (unique.length === 1) return { kind: 'ok', utc: new Date(unique[0]).toISOString() };
  return {
    kind: 'ambiguous',
    earlier: new Date(unique[0]).toISOString(),
    later: new Date(unique[unique.length - 1]).toISOString(),
  };
}
