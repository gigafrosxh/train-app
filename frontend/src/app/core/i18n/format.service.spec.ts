import { addDays, localDate, localTime, resolveLocal, zonedToUtc } from './format.service';

const VIENNA = 'Europe/Vienna';

describe('resolveLocal (Zeitumstellung)', () => {
  it('rechnet eine normale Ortszeit eindeutig um', () => {
    // 14.10.2026: Sommerzeit, UTC+2
    expect(resolveLocal('2026-10-14', '08:30', VIENNA)).toEqual({ kind: 'ok', utc: '2026-10-14T06:30:00.000Z' });
    // 14.01.2026: Winterzeit, UTC+1
    expect(resolveLocal('2026-01-14', '08:30', VIENNA)).toEqual({ kind: 'ok', utc: '2026-01-14T07:30:00.000Z' });
  });

  it('erkennt die Lücke beim Umstellen auf Sommerzeit', () => {
    // 29.03.2026: 02:00 → 03:00, 02:30 gibt es nicht
    expect(resolveLocal('2026-03-29', '02:30', VIENNA)).toEqual({ kind: 'nonexistent' });
  });

  it('erkennt die doppelte Stunde beim Umstellen auf Winterzeit', () => {
    // 25.10.2026: 03:00 → 02:00, 02:30 gibt es zweimal
    const r = resolveLocal('2026-10-25', '02:30', VIENNA);
    expect(r).toEqual({ kind: 'ambiguous', earlier: '2026-10-25T00:30:00.000Z', later: '2026-10-25T01:30:00.000Z' });
  });
});

describe('Datumshilfen', () => {
  it('addDays überschreitet Monats- und Jahresgrenzen', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('zonedToUtc rechnet Betriebssekunden über Mitternacht', () => {
    // 25:10 Uhr am 14.10. = 01:10 am 15.10. (Ortszeit, UTC+2)
    expect(zonedToUtc('2026-10-14', 25 * 3600 + 600, VIENNA)).toBe('2026-10-14T23:10:00.000Z');
  });

  it('localDate/localTime zeigen Ortszeit, nicht UTC', () => {
    expect(localDate('2026-10-14T22:30:00.000Z', VIENNA)).toBe('2026-10-15');
    expect(localTime('2026-10-14T22:30:00.000Z', VIENNA)).toBe('00:30');
  });
});
