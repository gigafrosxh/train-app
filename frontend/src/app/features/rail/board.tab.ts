import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { environment } from '../../../environments/environment';
import { RailApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { Format, localDate, resolveLocal } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { BoardEntry, StationRef } from '../../core/models/api.models';
import { StationMemory } from '../../core/prefs/station-memory';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { errorCode, Notify } from '../../core/ui/notify.service';
import { readStorage, writeStorage } from '../../core/util/storage';
import { LineBadge } from '../../shared/line-badge';
import { StationChips } from '../../shared/station-chips';
import { StationPicker } from '../../shared/station-picker';
import { DelayView, PlatformView, TimeView } from '../../shared/times';

// Getrennt je Modus, da Demo- und Server-IDs verschieden sind
const LAST_STATION = environment.useMocks ? 'gleis.board.station.demo' : 'gleis.board.station';

@Component({
  selector: 'app-board-tab',
  imports: [
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    StationPicker,
    StationChips,
    LineBadge,
    TimeView,
    DelayView,
    PlatformView,
    ...FORMAT_PIPES,
  ],
  templateUrl: './board.tab.html',
  styleUrl: './board.tab.scss',
})
export class BoardTab {
  private readonly api = inject(RailApi);
  private readonly notify = inject(Notify);
  private readonly realtime = inject(RealtimeService);
  private readonly i18n = inject(I18n);
  private readonly route = inject(ActivatedRoute);
  protected readonly memory = inject(StationMemory);
  protected readonly f = inject(Format);

  protected readonly station = signal<StationRef | null>(this.linkedStation() ?? this.lastStation());
  protected readonly kind = signal<'dep' | 'arr'>('dep');
  protected readonly later = signal(false);
  protected readonly date = signal(localDate(new Date().toISOString(), this.f.zone()));
  protected readonly time = signal('08:00');
  protected readonly entries = signal<BoardEntry[] | null>(null);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const s = this.station();
      this.kind();
      this.later();
      this.date();
      this.time();
      untracked(() => {
        writeStorage(LAST_STATION, s ? JSON.stringify(s) : null);
        this.load(1);
      });
    });
    interval(30000)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => !this.later() && this.load(1, true));
    this.realtime.resync$.pipe(takeUntilDestroyed()).subscribe(() => this.load(1, true));
  }

  /** Bahnhof aus dem Link (z. B. Favorit auf Home): ?station=<id>&name=<Name> */
  private linkedStation(): StationRef | null {
    const q = this.route.snapshot.queryParamMap;
    const id = q.get('station');
    return id ? { id, name: q.get('name') ?? '', code: null } : null;
  }

  protected toggleFavorite() {
    const s = this.station();
    if (!s) return;
    const adding = !this.memory.isFavorite(s.id);
    this.memory.toggleFavorite(s);
    this.notify.info(adding ? 'rail.favoriteAdded' : 'rail.favoriteRemoved', { station: s.name });
  }

  private lastStation(): StationRef | null {
    try {
      return JSON.parse(readStorage(LAST_STATION) ?? 'null');
    } catch {
      return null;
    }
  }

  protected load(page: number, quiet = false) {
    const s = this.station();
    if (!s) {
      this.entries.set(null);
      return;
    }
    let from: string | undefined;
    if (this.later()) {
      const r = resolveLocal(this.date(), this.time(), this.f.zone());
      if (r.kind === 'nonexistent') {
        this.error.set(this.i18n.t('errors.SCHEDULE_TIME_NONEXISTENT'));
        return;
      }
      from = r.kind === 'ok' ? r.utc : r.earlier;
    }
    if (!quiet) {
      this.loading.set(true);
      this.error.set(null);
    }
    const req = this.kind() === 'dep' ? this.api.departures(s.id, { from, page, pageSize: 20 }) : this.api.arrivals(s.id, { from, page, pageSize: 20 });
    req.subscribe({
      next: (p) => {
        this.entries.set(page === 1 ? p.items : [...(this.entries() ?? []), ...p.items]);
        this.total.set(p.total);
        this.page.set(page);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        // Gemerkter Bahnhof existiert nicht (mehr), z. B. nach Wechsel Demo → echtes Backend
        const code = errorCode(err);
        if (code === 'STATION_NOT_FOUND' || code === 'VALIDATION_FAILED' || code === 'NOT_FOUND') {
          this.memory.forget(s.id);
          this.station.set(null);
          this.entries.set(null);
          return;
        }
        if (!quiet) {
          this.entries.set([]);
          this.error.set(this.notify.messageFor(err));
        }
      },
    });
  }

  protected more() {
    this.load(this.page() + 1);
  }
}
