import { Component, computed, DestroyRef, effect, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { interval, Subscription } from 'rxjs';
import { AccountApi } from '../../core/api/api';
import { AuthService } from '../../core/auth/auth.service';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { Format } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Dashboard, TicketSummary, TripAlert } from '../../core/models/api.models';
import { StationMemory } from '../../core/prefs/station-memory';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { Notify } from '../../core/ui/notify.service';
import { LineBadge } from '../../shared/line-badge';
import { StationChips } from '../../shared/station-chips';
import { DelayView, PlatformView, TimeView } from '../../shared/times';

@Component({
  selector: 'app-home',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    TranslatePipe,
    LineBadge,
    StationChips,
    TimeView,
    DelayView,
    PlatformView,
    ...FORMAT_PIPES,
  ],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage implements OnInit {
  private readonly api = inject(AccountApi);
  private readonly realtime = inject(RealtimeService);
  private readonly notify = inject(Notify);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly stations = inject(StationMemory);
  protected readonly f = inject(Format);
  private readonly i18n = inject(I18n);

  protected readonly data = signal<Dashboard | null>(null);
  protected readonly failed = signal(false);
  protected readonly now = signal(Date.now());
  private liveSub: Subscription | null = null;

  protected readonly greeting = computed(() => {
    this.i18n.lang();
    const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Vienna' }).format(this.now()));
    const key = h < 5 ? 'home.hiEvening' : h < 11 ? 'home.hiMorning' : h < 18 ? 'home.hiDay' : 'home.hiEvening';
    const first = this.auth.user()?.displayName.split(' ')[0] ?? '';
    return this.i18n.t(key, { name: first });
  });

  protected readonly today = computed(() =>
    new Intl.DateTimeFormat(this.i18n.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Vienna',
    }).format(this.now()),
  );

  protected readonly next = computed(() => this.data()?.nextTrip ?? null);
  private readonly nextId = computed(() => this.next()?.id ?? null);
  protected readonly boardingTime = computed(() => {
    const n = this.next();
    const s = n?.boardingStop;
    return s?.expectedDeparture ?? s?.scheduledDeparture ?? n?.expectedDeparture ?? n?.scheduledDeparture ?? null;
  });
  protected readonly minutesToGo = computed(() => {
    const t = this.boardingTime();
    if (!t) return null;
    return Math.round((Date.parse(t) - this.now()) / 60000);
  });

  constructor() {
    // Live: Änderungen an der nächsten Fahrt sofort übernehmen
    effect(() => {
      const id = this.nextId();
      this.liveSub?.unsubscribe();
      this.liveSub = id ? this.realtime.tripUpdates([id]).subscribe(() => this.load()) : null;
    });
    this.destroyRef.onDestroy(() => this.liveSub?.unsubscribe());
  }

  ngOnInit() {
    this.load();
    interval(30000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.now.set(Date.now());
        this.load();
      });
    this.realtime.resync$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  protected load() {
    this.api.dashboard().subscribe({
      next: (d) => {
        this.data.set(d);
        this.failed.set(false);
      },
      error: (err) => {
        if (!this.data()) this.failed.set(true);
        this.notify.error(err);
      },
    });
  }

  protected ticketFor(alert: TripAlert): TicketSummary | undefined {
    return this.data()?.activeTickets.find((t) => t.tripId === alert.tripId);
  }

  protected alertIcon(a: TripAlert) {
    switch (a.code) {
      case 'TRIP_CANCELLED':
        return 'block';
      case 'PLATFORM_CHANGED':
        return 'swap_horiz';
      case 'SCHEDULE_CHANGED':
        return 'update';
      default:
        return 'schedule';
    }
  }
}
