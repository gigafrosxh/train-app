import { effect, inject, Injectable, InjectionToken, untracked } from '@angular/core';
import { filter, Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { MapTrain, SocketEvent, TripDetail } from '../models/api.models';

export interface Ack {
  ok: boolean;
  subscriptionId?: string;
  error?: { code: string; message: string };
}

/** Transportschicht: echter Socket.IO-Client oder Mock. */
export interface RealtimeTransport {
  connect(token: string): void;
  disconnect(): void;
  emit(event: string, payload: unknown): Promise<Ack>;
  readonly events$: Observable<{ name: string; payload: unknown }>;
  readonly connected$: Observable<void>;
}

export const REALTIME_TRANSPORT = new InjectionToken<RealtimeTransport>('REALTIME_TRANSPORT');

export class SocketIoTransport implements RealtimeTransport {
  private socket: Socket | null = null;
  readonly events$ = new Subject<{ name: string; payload: unknown }>();
  readonly connected$ = new Subject<void>();

  connect(token: string) {
    this.disconnect();
    this.socket = io({ path: environment.socketPath, auth: { accessToken: token } });
    this.socket.on('connect', () => this.connected$.next());
    this.socket.onAny((name: string, payload: unknown) => this.events$.next({ name, payload }));
  }

  disconnect() {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }

  emit(event: string, payload: unknown): Promise<Ack> {
    const socket = this.socket;
    if (!socket) return Promise.resolve({ ok: false });
    return new Promise((resolve) => {
      socket.timeout(5000).emit(event, payload, (err: unknown, ack: Ack) => {
        resolve(err ? { ok: false } : ack);
      });
    });
  }
}

export interface MapSubscription {
  subscriptionId: string;
  country: string;
  bbox: [number, number, number, number];
}

export type MapEvent =
  | { type: 'position'; event: SocketEvent<MapTrain> }
  | { type: 'removed'; event: SocketEvent<{ tripId: string }> };

/**
 * Live-Updates. REST bleibt maßgeblich: Nach jedem (Re-)Connect werden alle Abos
 * erneut gesendet und `resync$` meldet, dass Snapshots neu geladen werden sollen.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly transport = inject(REALTIME_TRANSPORT);

  private readonly tripRefs = new Map<string, number>();
  private mapSub: MapSubscription | null = null;
  private readonly resync = new Subject<void>();
  /** Nur bei echtem Reconnect – nicht bei der ersten Verbindung nach dem Login. */
  readonly resync$ = this.resync.asObservable();
  private connectedOnce = false;

  constructor() {
    effect(() => {
      this.auth.tokenVersion();
      const loggedIn = this.auth.isLoggedIn();
      untracked(() => {
        const token = this.auth.token;
        if (loggedIn && token) this.transport.connect(token);
        else {
          this.transport.disconnect();
          this.connectedOnce = false;
        }
      });
    });

    this.transport.connected$.subscribe(() => {
      // Abos sind an die Verbindung gebunden – immer erneut senden (idempotent).
      const ids = [...this.tripRefs.keys()];
      if (ids.length) void this.transport.emit('trips.subscribe', { tripIds: ids.slice(0, 100) });
      if (!this.connectedOnce) {
        // Erste Verbindung: Seiten haben ihren REST-Stand gerade erst geladen.
        this.connectedOnce = true;
        if (this.mapSub) void this.transport.emit('map.subscribe', this.mapSub);
        return;
      }
      // Reconnect: Karte beginnt mit neuem Abo und Snapshot, alle Seiten laden neu (über resync$).
      this.mapSub = null;
      this.resync.next();
    });
  }

  /** Live-Updates für einzelne Fahrten (max. 100 gleichzeitig). */
  tripUpdates(tripIds: string[]): Observable<SocketEvent<TripDetail>> {
    return new Observable<SocketEvent<TripDetail>>((observer) => {
      const added: string[] = [];
      for (const id of tripIds) {
        const n = this.tripRefs.get(id) ?? 0;
        this.tripRefs.set(id, n + 1);
        if (n === 0) added.push(id);
      }
      if (added.length) void this.transport.emit('trips.subscribe', { tripIds: added.slice(0, 100) });

      const sub = this.transport.events$
        .pipe(filter((e) => e.name === 'trip.updated'))
        .subscribe((e) => {
          const ev = e.payload as SocketEvent<TripDetail>;
          if (tripIds.includes(ev.entityId)) observer.next(ev);
        });

      return () => {
        sub.unsubscribe();
        const removed: string[] = [];
        for (const id of tripIds) {
          const n = (this.tripRefs.get(id) ?? 1) - 1;
          if (n <= 0) {
            this.tripRefs.delete(id);
            removed.push(id);
          } else this.tripRefs.set(id, n);
        }
        if (removed.length) void this.transport.emit('trips.unsubscribe', { tripIds: removed });
      };
    });
  }

  /** Ein neues Karten-Abo ersetzt das alte. Jeder Ausschnitt bekommt eine neue subscriptionId. */
  subscribeMap(country: string, bbox: MapSubscription['bbox']): Promise<Ack & { subscriptionId: string }> {
    const sub: MapSubscription = { subscriptionId: crypto.randomUUID(), country, bbox };
    this.mapSub = sub;
    return this.transport.emit('map.subscribe', sub).then((ack) => ({ ...ack, subscriptionId: sub.subscriptionId }));
  }

  get mapSubscriptionId(): string | null {
    return this.mapSub?.subscriptionId ?? null;
  }

  unsubscribeMap(): void {
    if (!this.mapSub) return;
    this.mapSub = null;
    void this.transport.emit('map.unsubscribe', {});
  }

  /** Nur Ereignisse des aktuellen Karten-Abos. */
  mapEvents(): Observable<MapEvent> {
    return new Observable<MapEvent>((observer) =>
      this.transport.events$.subscribe((e) => {
        const sid = (e.payload as { subscriptionId?: string })?.subscriptionId;
        if (!sid || sid !== this.mapSub?.subscriptionId) return;
        if (e.name === 'trip.position.updated')
          observer.next({ type: 'position', event: e.payload as SocketEvent<MapTrain> });
        if (e.name === 'map.train.removed')
          observer.next({ type: 'removed', event: e.payload as SocketEvent<{ tripId: string }> });
      }),
    );
  }

  scheduleUpdates(): Observable<SocketEvent<{ affectedTripIds: string[]; requiresRefetch: boolean }>> {
    return new Observable((observer) =>
      this.transport.events$.subscribe((e) => {
        if (e.name === 'schedule.updated') observer.next(e.payload as never);
      }),
    );
  }

  /** Störung angelegt, geändert oder gelöscht (betrifft alle Clients). */
  disruptionUpdates(): Observable<SocketEvent<{ id: string }>> {
    return new Observable((observer) =>
      this.transport.events$.subscribe((e) => {
        if (e.name === 'disruption.updated') observer.next(e.payload as never);
      }),
    );
  }
}
