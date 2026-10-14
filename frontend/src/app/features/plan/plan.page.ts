import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom, interval, Subscription } from 'rxjs';
import { OperationsApi, RailApi } from '../../core/api/api';
import { AuthService } from '../../core/auth/auth.service';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { Format, localTime } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  DELAY_REASONS,
  DelayReason,
  StopPatch,
  TripDetail,
  TripStop,
  TripSummary,
  WorkerAssignment,
} from '../../core/models/api.models';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { errorCode, Notify } from '../../core/ui/notify.service';
import { Confirm } from '../../shared/confirm.dialog';
import { LineBadge } from '../../shared/line-badge';
import { DelayView } from '../../shared/times';
import { LocalTimeInput } from './local-time';

interface StopDraft {
  arr: string;
  dep: string;
  platform: string;
  cancelled: boolean;
}

@Component({
  selector: 'app-plan',
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    LineBadge,
    DelayView,
    ...FORMAT_PIPES,
  ],
  templateUrl: './plan.page.html',
  styleUrl: './plan.page.scss',
})
export class PlanPage implements OnInit {
  private readonly ops = inject(OperationsApi);
  private readonly rail = inject(RailApi);
  private readonly realtime = inject(RealtimeService);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);
  private readonly localTime = inject(LocalTimeInput);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);
  protected readonly f = inject(Format);
  protected readonly reasons = DELAY_REASONS;
  protected readonly quick = [0, 5, 10, 15, 30];

  protected readonly trips = signal<TripSummary[] | null>(null);
  protected readonly assignments = signal<WorkerAssignment[]>([]);
  protected readonly q = signal('');
  protected readonly onlyRunning = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly trip = signal<TripDetail | null>(null);
  protected readonly stale = signal(false);
  protected readonly busy = signal(false);

  // Formular Verspätung
  protected readonly delayMin = signal<number | null>(null);
  protected readonly reasonCode = signal<DelayReason | null>(null);
  protected readonly reasonText = signal('');
  protected readonly drafts = signal<Record<string, StopDraft>>({});

  private live: Subscription | null = null;

  protected readonly shown = computed(() => {
    const q = this.q().toLowerCase().trim();
    return (this.trips() ?? []).filter(
      (t) =>
        (!this.onlyRunning() || t.status === 'RUNNING') &&
        (!q ||
          t.trainNumber.toLowerCase().includes(q) ||
          t.lineName.toLowerCase().includes(q) ||
          t.origin.name.toLowerCase().includes(q) ||
          t.destination.name.toLowerCase().includes(q)),
    );
  });

  protected readonly delayDirty = computed(() => {
    const t = this.trip();
    if (!t) return false;
    return (
      (this.delayMin() !== null && this.delayMin() !== Math.round(t.delaySeconds / 60)) ||
      this.reasonCode() !== (t.stops.find((s) => s.reasonCode)?.reasonCode ?? null) ||
      this.reasonText() !== (t.stops.find((s) => s.reasonText)?.reasonText ?? '')
    );
  });

  constructor() {
    effect(() => {
      const id = this.selectedId();
      untracked(() => {
        this.live?.unsubscribe();
        this.live = null;
        if (!id) return;
        this.loadTrip(id);
        this.live = this.realtime.tripUpdates([id]).subscribe((ev) => {
          const cur = this.trip();
          if (!cur || ev.version <= cur.version) return;
          // Eigene ungespeicherte Änderungen nicht überschreiben – Hinweis zeigen.
          if (this.hasDrafts()) this.stale.set(true);
          else this.applyTrip(ev.data);
        });
      });
    });
    this.destroyRef.onDestroy(() => this.live?.unsubscribe());
  }

  ngOnInit() {
    this.loadList();
    this.ops.assignments().subscribe({ next: (p) => this.assignments.set(p.items), error: () => {} });
    interval(30000).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.loadList(true));
  }

  protected loadList(quiet = false) {
    this.ops.trips({ pageSize: 100 }).subscribe({
      next: (p) => {
        this.trips.set(p.items);
        if (!this.selectedId() && p.items.length) {
          const running = p.items.find((t) => t.status === 'RUNNING');
          this.selectedId.set((running ?? p.items[0]).id);
        }
      },
      error: (err) => {
        if (!quiet) {
          this.trips.set([]);
          this.notify.error(err);
        }
      },
    });
  }

  private loadTrip(id: string) {
    this.rail.trip(id).subscribe({
      next: (t) => this.applyTrip(t),
      error: (err) => this.notify.error(err),
    });
  }

  private applyTrip(t: TripDetail) {
    this.trip.set(t);
    this.stale.set(false);
    this.delayMin.set(Math.round(t.delaySeconds / 60));
    this.reasonCode.set(t.stops.find((s) => s.reasonCode)?.reasonCode ?? null);
    this.reasonText.set(t.stops.find((s) => s.reasonText)?.reasonText ?? '');
    const zone = this.f.zone();
    const d: Record<string, StopDraft> = {};
    for (const s of t.stops) {
      d[s.id] = {
        arr: s.expectedArrival ? localTime(s.expectedArrival, zone) : '',
        dep: s.expectedDeparture ? localTime(s.expectedDeparture, zone) : '',
        platform: s.expectedPlatform ?? s.scheduledPlatform ?? '',
        cancelled: s.cancelled,
      };
    }
    this.drafts.set(d);
    // Liste mit aktuellem Stand abgleichen
    this.trips.update((list) => list?.map((x) => (x.id === t.id ? { ...x, ...this.summary(t) } : x)) ?? null);
  }

  private summary(t: TripDetail): TripSummary {
    const { stops: _s, ...rest } = t;
    return rest;
  }

  protected reload() {
    const id = this.selectedId();
    if (id) this.loadTrip(id);
  }

  protected select(t: TripSummary) {
    if (t.id === this.selectedId()) return;
    this.trip.set(null);
    this.selectedId.set(t.id);
  }

  // ---------- Verspätung & Ausfall

  protected async saveDelay() {
    const t = this.trip();
    const min = this.delayMin();
    if (!t || min === null) return;
    await this.patchTrip({
      version: t.version,
      delaySeconds: Math.round(min * 60),
      reasonCode: min >= 1 ? this.reasonCode() : null,
      reasonText: min >= 1 ? this.reasonText().trim() || null : null,
    }, 'plan.delaySaved');
  }

  protected async toggleCancel() {
    const t = this.trip();
    if (!t) return;
    const cancel = t.status !== 'CANCELLED';
    if (cancel) {
      const ok = await this.confirm.ask({
        title: this.i18n.t('plan.cancelTitle', { train: t.trainNumber }),
        text: this.i18n.t('plan.cancelText'),
        confirm: this.i18n.t('plan.cancelConfirm'),
        danger: true,
      });
      if (!ok) return;
    }
    await this.patchTrip(
      { version: t.version, cancelled: cancel, ...(cancel ? { reasonCode: this.reasonCode(), reasonText: this.reasonText().trim() || null } : {}) },
      cancel ? 'plan.cancelled' : 'plan.restored',
    );
  }

  private async patchTrip(body: Parameters<OperationsApi['patchTrip']>[1], okKey: string) {
    const t = this.trip()!;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(this.ops.patchTrip(t.id, body));
      this.applyTrip(updated);
      this.notify.info(okKey);
    } catch (err) {
      await this.handleError(err);
    } finally {
      this.busy.set(false);
    }
  }

  // ---------- Halte

  protected draft(s: TripStop): StopDraft {
    return this.drafts()[s.id];
  }

  protected setDraft(s: TripStop, change: Partial<StopDraft>) {
    this.drafts.update((d) => ({ ...d, [s.id]: { ...d[s.id], ...change } }));
  }

  protected stopDirty(s: TripStop): boolean {
    const d = this.drafts()[s.id];
    if (!d) return false;
    const zone = this.f.zone();
    return (
      d.arr !== (s.expectedArrival ? localTime(s.expectedArrival, zone) : '') ||
      d.dep !== (s.expectedDeparture ? localTime(s.expectedDeparture, zone) : '') ||
      d.platform !== (s.expectedPlatform ?? s.scheduledPlatform ?? '') ||
      d.cancelled !== s.cancelled
    );
  }

  private hasDrafts() {
    const t = this.trip();
    return !!t && (t.stops.some((s) => this.stopDirty(s)) || this.delayDirty());
  }

  protected resetStop(s: TripStop) {
    const zone = this.f.zone();
    this.setDraft(s, {
      arr: s.expectedArrival ? localTime(s.expectedArrival, zone) : '',
      dep: s.expectedDeparture ? localTime(s.expectedDeparture, zone) : '',
      platform: s.expectedPlatform ?? s.scheduledPlatform ?? '',
      cancelled: s.cancelled,
    });
  }

  protected async saveStop(s: TripStop) {
    const t = this.trip();
    const d = this.drafts()[s.id];
    if (!t || !d) return;
    const zone = this.f.zone();
    const body: StopPatch = { version: s.version };

    for (const [key, value, ref] of [
      ['expectedArrival', d.arr, s.scheduledArrival],
      ['expectedDeparture', d.dep, s.scheduledDeparture],
    ] as const) {
      const before = key === 'expectedArrival' ? s.expectedArrival : s.expectedDeparture;
      if (value === (before ? localTime(before, zone) : '')) continue;
      if (!value) {
        body[key] = null;
        continue;
      }
      // Datum vom geplanten Halt übernehmen; nach Mitternacht auf den Folgetag rollen.
      const base = ref ?? s.scheduledArrival ?? s.scheduledDeparture!;
      let date = this.localTime.dateOf(base, zone);
      if (value < localTime(base, zone) && localTime(base, zone) > '18:00' && value < '06:00') {
        date = this.localTime.dateOf(new Date(Date.parse(base) + 86400000).toISOString(), zone);
      }
      const r = await this.localTime.toUtc(date, value, zone);
      if (!r) return;
      if ('error' in r) {
        this.notify.info('errors.SCHEDULE_TIME_NONEXISTENT');
        return;
      }
      body[key] = r.utc;
    }
    if (d.platform !== (s.expectedPlatform ?? s.scheduledPlatform ?? '')) body.expectedPlatform = d.platform.trim() || null;
    if (d.cancelled !== s.cancelled) body.cancelled = d.cancelled;

    this.busy.set(true);
    try {
      await firstValueFrom(this.ops.patchStop(t.id, s.id, body));
      // Haltänderung erhöht auch die Fahrtversion → komplett neu laden
      this.loadTrip(t.id);
      this.notify.info('plan.stopSaved', { station: s.station.name });
    } catch (err) {
      await this.handleError(err);
    } finally {
      this.busy.set(false);
    }
  }

  private async handleError(err: unknown) {
    const code = errorCode(err);
    if (code === 'TRIP_VERSION_CONFLICT') {
      const ok = await this.confirm.ask({
        title: this.i18n.t('plan.conflictTitle'),
        text: this.i18n.t('plan.conflictText'),
        confirm: this.i18n.t('plan.reload'),
      });
      if (ok) this.reload();
      else this.stale.set(true);
      return;
    }
    this.notify.error(err);
  }

  protected assignmentLabel(a: WorkerAssignment) {
    return a.scope === 'COMPANY' ? a.companyName : a.trainNumber;
  }
}
