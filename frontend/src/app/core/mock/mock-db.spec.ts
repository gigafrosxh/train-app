import { MockDb, MockError, stationKey } from './mock-db';

describe('MockDb (Demo-Backend)', () => {
  beforeEach(() => localStorage.clear());

  it('erzeugt Fahrten für heute', () => {
    const db = new MockDb();
    const trips = db.trips({});
    expect(trips.length).toBeGreaterThan(10);
  });

  it('meldet einen Versionskonflikt bei veraltetem Stand', () => {
    const db = new MockDb();
    const admin = db.findUserByEmail('admin@demo.at')!;
    const trip = db.trips({})[0];
    db.patchTrip(admin as never, trip.id, { version: 1, delaySeconds: 300 });
    let error: unknown;
    try {
      db.patchTrip(admin as never, trip.id, { version: 1, delaySeconds: 600 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MockError);
    expect((error as MockError).code).toBe('TRIP_VERSION_CONFLICT');
  });

  it('Worker dürfen nur zugewiesene Züge ändern', () => {
    const db = new MockDb();
    const worker = db.findUserByEmail('worker@demo.at')!;
    const allowed = db.allowedTrainIds(worker as never)!;
    const foreign = db.trips({}).find((t) => !allowed.has(t.trainId))!;
    expect(() => db.patchTrip(worker as never, foreign.id, { version: 1, cancelled: true })).toThrowError();
  });

  it('normalisiert Bahnhofsnamen wie das Backend', () => {
    expect(stationKey('Wien Westbf')).toBe('wien westbahnhof');
    expect(stationKey('Mürzzuschlag')).toBe('muerzzuschlag');
    expect(stationKey('St. Pölten Hbf')).toBe('sankt poelten hauptbahnhof');
    expect(stationKey('Straßwalchen')).toBe('strasswalchen');
    expect(stationKey('St', false)).toBe('st');
  });

  it('findet Bahnhöfe trotz Abkürzung und Tippfehler', () => {
    const db = new MockDb();
    const first = (q: string) => db.searchStations(q, 'AT')[0]?.name;
    expect(first('salzbrug')).toMatch(/^Salzburg/);
    expect(first('Linz Hauptbahnhof')).toMatch(/^Linz/);
    expect(db.searchStations('St', 'AT').length).toBeGreaterThan(1);
  });

  it('gibt Verspätung an folgende Halte weiter', () => {
    const db = new MockDb();
    const admin = db.findUserByEmail('admin@demo.at')!;
    const trip = db.trips({}).find((t) => t.status === 'SCHEDULED')!;
    const detail = db.trip(trip.id);
    const first = detail.stops[0];
    const expected = new Date(Date.parse(first.scheduledDeparture!) + 600000).toISOString();
    db.patchStop(admin as never, trip.id, first.id, { version: 1, expectedDeparture: expected, propagate: true });
    const after = db.trip(trip.id);
    for (const s of after.stops.slice(1)) {
      if (s.scheduledArrival) expect(s.arrivalDelaySeconds).toBe(600);
    }
  });

  it('Favoriten: Reihenfolge, keine Duplikate, unbekannte Bahnhöfe abgelehnt', () => {
    const db = new MockDb();
    const user = db.findUserByEmail('user@demo.at')!;
    const ids = db.searchStations('', 'AT').slice(0, 2).map((x) => x.id);
    expect(db.setFavorites(user.id, ids).map((x) => x.id)).toEqual(ids);
    expect(() => db.setFavorites(user.id, [ids[0], ids[0]])).toThrow(MockError);
    expect(() => db.setFavorites(user.id, ['nope'])).toThrow(MockError);
  });
});
