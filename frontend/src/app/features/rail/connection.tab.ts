import { Component, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { RailApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { Format, localDate, resolveLocal } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Connection, StationRef } from '../../core/models/api.models';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { apiError, Notify } from '../../core/ui/notify.service';
import { LineBadge } from '../../shared/line-badge';
import { StationPicker } from '../../shared/station-picker';
import { DelayView, PlatformView, TimeView } from '../../shared/times';

@Component({
  selector: 'app-connection-tab',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    TranslatePipe,
    StationPicker,
    LineBadge,
    TimeView,
    DelayView,
    PlatformView,
    ...FORMAT_PIPES,
  ],
  templateUrl: './connection.tab.html',
  styleUrl: './connection.tab.scss',
})
export class ConnectionTab {
  private readonly api = inject(RailApi);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);
  protected readonly f = inject(Format);

  private readonly fromPicker = viewChild.required<StationPicker>('fromPicker');
  private readonly toPicker = viewChild.required<StationPicker>('toPicker');

  protected readonly from = signal<StationRef | null>(null);
  protected readonly to = signal<StationRef | null>(null);
  protected readonly date = signal(localDate(new Date().toISOString(), this.f.zone()));
  protected readonly time = signal(this.nowHm());
  protected readonly results = signal<Connection[] | null>(null);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly open = signal<string | null>(null);
  protected readonly fieldError = signal<Record<string, string>>({});
  private departAfter: string | null = null;

  constructor() {
    // Live-Änderungen: Seite zurücksetzen und neu suchen (Vertrag)
    inject(RealtimeService)
      .scheduleUpdates()
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.departAfter && this.fetch(1));
  }

  private nowHm() {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: this.f.zone() }).format(new Date());
  }

  protected swap() {
    const a = this.from();
    const b = this.to();
    this.fromPicker().setStation(b);
    this.toPicker().setStation(a);
  }

  protected setNow() {
    this.date.set(localDate(new Date().toISOString(), this.f.zone()));
    this.time.set(this.nowHm());
  }

  protected search() {
    const errs: Record<string, string> = {};
    if (!this.from()) errs['fromStationId'] = this.i18n.t('common.required');
    if (!this.to()) errs['toStationId'] = this.i18n.t('common.required');
    this.fieldError.set(errs);
    if (Object.keys(errs).length) return;
    const r = resolveLocal(this.date(), this.time(), this.f.zone());
    if (r.kind === 'nonexistent') {
      this.error.set(this.i18n.t('errors.SCHEDULE_TIME_NONEXISTENT'));
      return;
    }
    this.departAfter = r.kind === 'ok' ? r.utc : r.earlier;
    this.fetch(1);
  }

  private fetch(page: number) {
    if (!this.from() || !this.to() || !this.departAfter) return;
    this.loading.set(true);
    this.error.set(null);
    this.api
      .connections({
        fromStationId: this.from()!.id,
        toStationId: this.to()!.id,
        departAfter: this.departAfter,
        maxTransfers: 2,
        page,
        pageSize: 6,
      })
      .subscribe({
        next: (p) => {
          this.results.set(page === 1 ? p.items : [...(this.results() ?? []), ...p.items]);
          this.total.set(p.total);
          this.page.set(page);
          this.loading.set(false);
          if (page === 1) this.open.set(p.items[0]?.id ?? null);
        },
        error: (err) => {
          this.loading.set(false);
          const api = apiError(err);
          const fe: Record<string, string> = {};
          for (const e of api?.fieldErrors ?? []) fe[e.field] = this.i18n.t(`fieldErrors.${e.code}`);
          this.fieldError.set(fe);
          this.error.set(this.notify.messageFor(err));
          if (page === 1) this.results.set(null);
        },
      });
  }

  protected more() {
    this.fetch(this.page() + 1);
  }

  protected toggle(id: string) {
    this.open.set(this.open() === id ? null : id);
  }

  protected atRisk(c: Connection) {
    return c.legs.some((l) => l.transferAtRisk);
  }

  protected transferMinutes(c: Connection, i: number): number {
    const next = c.legs[i + 1].transferSeconds;
    if (next !== undefined && next !== null) return Math.round(next / 60);
    const arr = c.legs[i].to.expectedTime ?? c.legs[i].to.scheduledTime;
    const dep = c.legs[i + 1].from.expectedTime ?? c.legs[i + 1].from.scheduledTime;
    return Math.round((Date.parse(dep) - Date.parse(arr)) / 60000);
  }
}
