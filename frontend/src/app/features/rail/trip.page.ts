import { Location } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';
import { interval, Subscription } from 'rxjs';
import { AccountApi, RailApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TripDetail, TripStop } from '../../core/models/api.models';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { Notify } from '../../core/ui/notify.service';
import { LineBadge } from '../../shared/line-badge';
import { DelayView, PlatformView, TimeView } from '../../shared/times';

@Component({
  selector: 'app-trip',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
    LineBadge,
    TimeView,
    DelayView,
    PlatformView,
    ...FORMAT_PIPES,
  ],
  templateUrl: './trip.page.html',
  styleUrl: './trip.page.scss',
})
export class TripPage {
  private readonly api = inject(RailApi);
  private readonly account = inject(AccountApi);
  private readonly realtime = inject(RealtimeService);
  private readonly notify = inject(Notify);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  readonly id = input.required<string>();
  protected readonly trip = signal<TripDetail | null>(null);
  protected readonly missing = signal(false);
  protected readonly now = signal(Date.now());
  private live: Subscription | null = null;

  /** Index des letzten bereits erreichten Halts (für den Fortschritt). */
  protected readonly reached = computed(() => {
    const t = this.trip();
    if (!t) return -1;
    const now = this.now();
    let idx = -1;
    t.stops.forEach((s, i) => {
      const at = s.actualArrival ?? s.actualDeparture ?? (i === 0 ? s.actualDeparture : null);
      if (at && Date.parse(at) <= now) idx = i;
    });
    return idx;
  });

  /** Fährt gerade zwischen reached und reached+1. */
  protected readonly between = computed(() => {
    const t = this.trip();
    const i = this.reached();
    if (!t || i < 0 || i >= t.stops.length - 1) return false;
    const dep = t.stops[i].actualDeparture;
    return !!dep && Date.parse(dep) <= this.now();
  });

  protected readonly reason = computed(() => {
    const t = this.trip();
    return t?.stops.find((s) => s.reasonCode)?.reasonCode ?? null;
  });
  protected readonly reasonText = computed(() => this.trip()?.stops.find((s) => s.reasonText)?.reasonText ?? null);

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      const id = this.id();
      untracked(() => {
        this.load(id, true);
        this.live?.unsubscribe();
        this.live = this.realtime.tripUpdates([id]).subscribe((ev) => {
          // Ältere Versionen verwerfen
          if (!this.trip() || ev.version >= this.trip()!.version) this.trip.set(ev.data);
        });
      });
    });
    destroyRef.onDestroy(() => this.live?.unsubscribe());
    interval(20000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.now.set(Date.now());
        this.load(this.id(), false);
      });
    this.realtime.resync$.pipe(takeUntilDestroyed()).subscribe(() => this.load(this.id(), false));
  }

  private load(id: string, first: boolean) {
    this.api.trip(id).subscribe({
      next: (t) => {
        this.trip.set(t);
        this.now.set(Date.now());
        if (first) this.account.markViewed(id).subscribe({ error: () => {} });
      },
      error: (err) => {
        if (first) {
          this.missing.set(true);
          this.notify.error(err);
        }
      },
    });
  }

  protected back() {
    if (history.length > 1) this.location.back();
    else this.router.navigate(['/rail']);
  }

  protected stopTime(s: TripStop) {
    return s.scheduledDeparture ?? s.scheduledArrival;
  }
}
