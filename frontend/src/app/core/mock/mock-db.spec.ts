import { MockDb, MockError } from './mock-db';

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
});
