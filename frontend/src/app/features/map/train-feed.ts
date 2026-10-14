import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import { MapApi } from '../../core/api/api';
import { MapTrain } from '../../core/models/api.models';
import { MapEvent, RealtimeService } from '../../core/realtime/realtime.service';
import { errorCode } from '../../core/ui/notify.service';
import { Bbox } from './country-geo';

export interface FeedListener {
  /** Kompletter neuer Stand (nach Snapshot). */
  reset(trains: MapTrain[]): void;
  update(train: MapTrain): void;
  remove(tripId: string): void;
  status(s: { live: boolean; loading: boolean; error: unknown | null }): void;
}

const PAGE_SIZE = 500;
const POLL_MS = 15000;

/**
 * Konsistente Zugpositionen nach docs/api-contract.md:
 * abonnieren → Ack → Ereignisse puffern → alle Snapshot-Seiten laden →
 * nur mapRevision > snapshotRevision und pro Fahrt höhere Versionen anwenden.
 */
export class TrainFeed {
  private gen = 0;
  private ready = false;
  private buffer: MapEvent[] = [];
  private snapshotRevision = -Infinity;
  /** Höchste bekannte Version je Fahrt (Position oder Entfernung = Löschmarke). */
  private known = new Map<string, number>();
  private events: Subscription;
  private poll: ReturnType<typeof setInterval> | null = null;
  private last: { country: string; bbox: Bbox } | null = null;

  constructor(
    private readonly api: MapApi,
    private readonly realtime: RealtimeService,
    private readonly listener: FeedListener,
  ) {
    this.events = this.realtime.mapEvents().subscribe((e) => (this.ready ? this.apply(e) : this.buffer.push(e)));
  }

  async start(country: string, bbox: Bbox): Promise<void> {
    const gen = ++this.gen;
    this.last = { country, bbox };
    this.ready = false;
    this.buffer = [];
    this.listener.status({ live: false, loading: true, error: null });

    const ack = await this.realtime.subscribeMap(country, bbox);
    if (gen !== this.gen) return;

    let items: MapTrain[] = [];
    let revision = -Infinity;
    try {
      ({ items, revision } = await this.loadSnapshot(country, bbox, gen));
    } catch (err) {
      if (gen === this.gen) this.listener.status({ live: ack.ok, loading: false, error: err });
      return;
    }
    if (gen !== this.gen) return;

    this.known = new Map(items.map((t) => [t.tripId, t.positionVersion]));
    this.snapshotRevision = revision;
    this.listener.reset(items.filter((t) => t.coordinates));
    this.ready = true;
    const buffered = this.buffer;
    this.buffer = [];
    buffered.forEach((e) => this.apply(e));
    this.listener.status({ live: ack.ok, loading: false, error: null });

    // Ohne Socket: regelmäßig neuen Snapshot laden
    if (this.poll) clearInterval(this.poll);
    this.poll = ack.ok ? null : setInterval(() => this.last && this.start(this.last.country, this.last.bbox), POLL_MS);
  }

  private async loadSnapshot(country: string, bbox: Bbox, gen: number, attempt = 0): Promise<{ items: MapTrain[]; revision: number }> {
    const base = { country, bbox: bbox.map((v) => v.toFixed(4)).join(','), pageSize: PAGE_SIZE };
    try {
      const first = await firstValueFrom(this.api.trains({ ...base, page: 1 }));
      const items = [...first.items];
      let page = 1;
      while (items.length < first.total && gen === this.gen) {
        page += 1;
        const next = await firstValueFrom(this.api.trains({ ...base, page, snapshotToken: first.snapshotToken }));
        if (!next.items.length) break;
        items.push(...next.items);
      }
      return { items, revision: first.snapshotRevision };
    } catch (err) {
      const code = errorCode(err);
      const retry =
        (err instanceof HttpErrorResponse && (code === 'MAP_SNAPSHOT_EXPIRED' || code === 'MAP_SNAPSHOT_MISMATCH')) && attempt < 2;
      if (retry && gen === this.gen) return this.loadSnapshot(country, bbox, gen, attempt + 1);
      throw err;
    }
  }

  private apply(e: MapEvent) {
    const ev = e.event;
    if (ev.mapRevision !== undefined && ev.mapRevision <= this.snapshotRevision) return;
    const known = this.known.get(ev.entityId);
    if (known !== undefined && ev.version <= known) return;
    this.known.set(ev.entityId, ev.version);
    if (e.type === 'position') {
      if (e.event.data.coordinates) this.listener.update(e.event.data);
      else this.listener.remove(ev.entityId);
    } else {
      this.listener.remove(ev.entityId);
    }
  }

  stop() {
    this.gen++;
    this.events.unsubscribe();
    if (this.poll) clearInterval(this.poll);
    this.realtime.unsubscribeMap();
  }
}
