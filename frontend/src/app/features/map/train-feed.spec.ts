import { of, Subject } from 'rxjs';
import { MapApi } from '../../core/api/api';
import { MapTrain, MapTrainsPage, SocketEvent } from '../../core/models/api.models';
import { MapEvent, RealtimeService } from '../../core/realtime/realtime.service';
import { FeedListener, TrainFeed } from './train-feed';

function train(id: string, positionVersion: number, lng = 13): MapTrain {
  return {
    tripId: id, positionVersion, lineName: 'RJ', trainNumber: id, coordinates: [lng, 47.5], bearing: 0,
    delaySeconds: 0, nextStopName: null, positionType: 'ESTIMATED', isStale: false, observedAt: null,
    calculatedAt: null, source: null, estimationMethod: 'SCHEDULE',
  };
}

function ev<T>(entityId: string, version: number, mapRevision: number, data: T): SocketEvent<T> {
  return { eventId: `${entityId}-${version}`, occurredAt: '', entityId, version, data, subscriptionId: 's', mapRevision };
}

function setup(snapshot: MapTrain[], revision: number) {
  const events = new Subject<MapEvent>();
  const page: MapTrainsPage = {
    items: snapshot, total: snapshot.length, page: 1, pageSize: 500,
    snapshotToken: 't', snapshotAt: '', snapshotExpiresAt: '', snapshotRevision: revision,
  };
  const api = { trains: () => of(page) } as unknown as MapApi;
  const realtime = {
    mapEvents: () => events.asObservable(),
    subscribeMap: () => Promise.resolve({ ok: true, subscriptionId: 's' }),
    unsubscribeMap: () => {},
  } as unknown as RealtimeService;
  const state = new Map<string, MapTrain>();
  const listener: FeedListener = {
    reset: (list) => {
      state.clear();
      list.forEach((t) => state.set(t.tripId, t));
    },
    update: (t) => state.set(t.tripId, t),
    remove: (id) => state.delete(id),
    status: () => {},
  };
  return { feed: new TrainFeed(api, realtime, listener), events, state };
}

describe('TrainFeed (konsistente Kartenansicht)', () => {
  it('übernimmt den Snapshot', async () => {
    const { feed, state } = setup([train('a', 1), train('b', 1)], 10);
    await feed.start('AT', [9, 46, 17, 49]);
    expect([...state.keys()].sort()).toEqual(['a', 'b']);
    feed.stop();
  });

  it('verwirft Ereignisse, die älter als der Snapshot sind', async () => {
    const { feed, events, state } = setup([train('a', 5)], 10);
    await feed.start('AT', [9, 46, 17, 49]);
    events.next({ type: 'position', event: ev('a', 6, 9, train('a', 6, 14)) }); // mapRevision 9 ≤ 10
    expect(state.get('a')!.coordinates![0]).toBe(13);
    events.next({ type: 'position', event: ev('a', 6, 11, train('a', 6, 14)) });
    expect(state.get('a')!.coordinates![0]).toBe(14);
    feed.stop();
  });

  it('wendet pro Fahrt nur höhere Versionen an', async () => {
    const { feed, events, state } = setup([train('a', 5)], 10);
    await feed.start('AT', [9, 46, 17, 49]);
    events.next({ type: 'position', event: ev('a', 5, 11, train('a', 5, 15)) }); // gleiche Version
    expect(state.get('a')!.coordinates![0]).toBe(13);
    feed.stop();
  });

  it('Löschmarke verhindert, dass eine ältere Position den Zug zurückholt', async () => {
    const { feed, events, state } = setup([train('a', 5)], 10);
    await feed.start('AT', [9, 46, 17, 49]);
    events.next({ type: 'removed', event: ev('a', 8, 12, { tripId: 'a' }) });
    expect(state.has('a')).toBe(false);
    events.next({ type: 'position', event: ev('a', 7, 13, train('a', 7)) });
    expect(state.has('a')).toBe(false);
    feed.stop();
  });

  it('puffert Ereignisse bis der Snapshot da ist', async () => {
    const { feed, events, state } = setup([train('a', 5)], 10);
    const started = feed.start('AT', [9, 46, 17, 49]);
    events.next({ type: 'position', event: ev('b', 1, 11, train('b', 1)) });
    await started;
    expect(state.has('b')).toBe(true);
    feed.stop();
  });
});
