import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { AdminApi } from '../../core/api/api';
import { addDays, Format, localDate } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DstDisambiguation, Route, Schedule } from '../../core/models/api.models';
import { apiError, Notify } from '../../core/ui/notify.service';
import { CrudDialogData } from './crud.dialog';
import { LookupField } from './lookup-field';

interface Row {
  routeStopId: string;
  name: string;
  arr: string;
  arrNext: boolean;
  dep: string;
  depNext: boolean;
}

const toTime = (sec: number | null) => {
  if (sec === null) return { t: '', next: false };
  const next = sec >= 86400;
  const r = sec % 86400;
  return { t: `${String(Math.floor(r / 3600)).padStart(2, '0')}:${String(Math.floor((r % 3600) / 60)).padStart(2, '0')}`, next };
};
const toSec = (t: string, next: boolean): number | null => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return (next ? 86400 : 0) + h * 3600 + m * 60;
};

@Component({
  selector: 'app-schedule-dialog',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    LookupField,
  ],
  templateUrl: './schedule.dialog.html',
  styleUrl: './schedule.dialog.scss',
})
export class ScheduleDialog implements OnInit {
  private readonly data = inject<CrudDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ScheduleDialog>);
  private readonly api = inject(AdminApi);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);
  private readonly f = inject(Format);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly schedule = this.data.row as unknown as Schedule | null;
  protected readonly days = [1, 2, 3, 4, 5, 6, 7];
  private readonly today = localDate(new Date().toISOString(), this.f.zone());

  protected readonly routeId = new FormControl<string | null>(this.schedule?.routeId ?? null, Validators.required);
  protected readonly trainId = new FormControl<string | null>(this.schedule?.trainId ?? null, Validators.required);
  protected readonly timeZone = signal(this.schedule?.timeZone ?? this.f.zone());
  protected readonly validFrom = signal(this.schedule?.validFrom ?? this.today);
  protected readonly validUntil = signal(this.schedule?.validUntil ?? addDays(this.today, 365));
  protected readonly weekdays = signal<number[]>(this.schedule?.weekdays ?? [1, 2, 3, 4, 5, 6, 7]);
  protected readonly dst = signal<DstDisambiguation>(this.schedule?.dstDisambiguation ?? 'REJECT');
  protected readonly rows = signal<Row[]>([]);
  protected readonly exceptions = signal<{ date: string; runs: boolean }[]>(this.schedule?.exceptions ?? []);
  protected readonly newException = signal(addDays(this.today, 7));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly fieldErrors = signal<{ field: string; message: string }[]>([]);

  ngOnInit() {
    if (this.schedule) void this.loadRoute(this.schedule.routeId, this.schedule);
    this.routeId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((id) => {
      if (id) void this.loadRoute(id, null);
      else this.rows.set([]);
    });
  }

  private async loadRoute(id: string, sc: Schedule | null) {
    try {
      const route = (await firstValueFrom(this.api.get('routes', id))) as Route;
      const old = this.rows();
      this.rows.set(
        [...route.stops]
          .sort((a, b) => a.sequence - b.sequence)
          .map((rs) => {
            const st = sc?.stops.find((x) => x.routeStopId === rs.id);
            const prev = old.find((r) => r.routeStopId === rs.id);
            const a = toTime(st?.arrivalOffsetSeconds ?? null);
            const d = toTime(st?.departureOffsetSeconds ?? null);
            return prev ?? { routeStopId: rs.id, name: rs.station.name, arr: a.t, arrNext: a.next, dep: d.t, depNext: d.next };
          }),
      );
    } catch (err) {
      this.notify.error(err);
    }
  }

  protected toggleDay(d: number) {
    this.weekdays.update((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));
  }

  protected setRow(i: number, change: Partial<Row>) {
    this.rows.update((rows) => rows.map((r, k) => (k === i ? { ...r, ...change } : r)));
  }

  protected addException() {
    const date = this.newException();
    if (!date || this.exceptions().some((e) => e.date === date)) return;
    this.exceptions.update((list) => [...list, { date, runs: false }].sort((a, b) => a.date.localeCompare(b.date)));
  }

  protected removeException(date: string) {
    this.exceptions.update((list) => list.filter((e) => e.date !== date));
  }

  protected toggleException(date: string) {
    this.exceptions.update((list) => list.map((e) => (e.date === date ? { ...e, runs: !e.runs } : e)));
  }

  protected async save() {
    this.routeId.markAsTouched();
    this.trainId.markAsTouched();
    const rows = this.rows();
    if (this.routeId.invalid || this.trainId.invalid || rows.length < 2) {
      this.error.set(this.i18n.t('setup.fillRequired'));
      return;
    }
    const last = rows.length - 1;
    if (!rows[0].dep || !rows[last].arr || rows.slice(1, last).some((r) => !r.arr && !r.dep)) {
      this.error.set(this.i18n.t('setup.timesMissing'));
      return;
    }
    const body = {
      routeId: this.routeId.value!,
      trainId: this.trainId.value!,
      timeZone: this.timeZone().trim(),
      validFrom: this.validFrom(),
      validUntil: this.validUntil(),
      weekdays: this.weekdays(),
      dstDisambiguation: this.dst(),
      exceptions: this.exceptions(),
      stops: rows.map((r, i) => ({
        routeStopId: r.routeStopId,
        arrivalOffsetSeconds: i === 0 ? null : toSec(r.arr, r.arrNext),
        departureOffsetSeconds: i === last ? null : toSec(r.dep || r.arr, r.dep ? r.depNext : r.arrNext),
      })),
    };
    this.busy.set(true);
    this.error.set(null);
    this.fieldErrors.set([]);
    try {
      if (this.schedule) await firstValueFrom(this.api.update('schedules', this.schedule.id, { ...body, version: this.schedule.version }));
      else await firstValueFrom(this.api.create('schedules', body));
      this.ref.close(true);
    } catch (err) {
      this.error.set(this.notify.messageFor(err));
      this.fieldErrors.set((apiError(err)?.fieldErrors ?? []).map((e) => ({ field: e.field, message: e.message })));
    } finally {
      this.busy.set(false);
    }
  }
}
