import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AdminApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { addDays, Format, localDate } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Route, TripDetail } from '../../core/models/api.models';
import { Notify } from '../../core/ui/notify.service';
import { LocalTimeInput } from '../plan/local-time';
import { CrudDialogData } from './crud.dialog';
import { LookupField } from './lookup-field';

interface Row {
  routeStopId: string;
  name: string;
  arr: string;
  dep: string;
  next: boolean;
}

/** Sonderfahrt anlegen; bestehende Fahrten werden nur angezeigt. */
@Component({
  selector: 'app-special-trip-dialog',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatTooltipModule,
    TranslatePipe,
    LookupField,
    ...FORMAT_PIPES,
  ],
  template: `
    @if (trip) {
      <h2 mat-dialog-title>{{ trip.trainNumber }} · {{ trip.origin.name }} → {{ trip.destination.name }}</h2>
      <mat-dialog-content>
        <p class="muted">{{ trip.serviceDate }} · {{ trip.scheduledDeparture | hm }} – {{ trip.scheduledArrival | hm }}</p>
        <p class="small">{{ 'setup.tripReadOnly' | t }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>{{ 'common.close' | t }}</button>
        <a mat-flat-button [routerLink]="['/rail/trips', trip.id]" mat-dialog-close>{{ 'tickets.openTrip' | t }}</a>
      </mat-dialog-actions>
    } @else {
      <h2 mat-dialog-title>{{ 'setup.newSpecial' | t }}</h2>
      <mat-dialog-content>
        <p class="muted small intro">{{ 'setup.specialHint' | t }}</p>
        <div class="form-grid">
          <app-lookup-field [formControl]="routeId" resource="routes" [label]="'setup.f.route' | t" />
          <app-lookup-field [formControl]="trainId" resource="trains" [label]="'setup.f.train' | t" />
          <mat-form-field>
            <mat-label>{{ 'setup.f.date' | t }}</mat-label>
            <input matInput type="date" [formControl]="date" />
          </mat-form-field>
        </div>
        @if (rows().length) {
          <div class="times">
            @for (r of rows(); track r.routeStopId; let i = $index; let first = $first; let last = $last) {
              <div class="tr">
                <span class="st">{{ r.name }}</span>
                <span class="cell">
                  @if (!first) {
                    <input type="time" class="time" [value]="r.arr" (change)="set(i, { arr: $any($event.target).value })" [attr.aria-label]="('trip.arr' | t) + ' ' + r.name" />
                  }
                </span>
                <span class="cell">
                  @if (!last) {
                    <input type="time" class="time" [value]="r.dep" (change)="set(i, { dep: $any($event.target).value })" [attr.aria-label]="('trip.dep' | t) + ' ' + r.name" />
                  }
                </span>
                <mat-checkbox [checked]="r.next" (change)="set(i, { next: $event.checked })" [matTooltip]="'setup.nextDay' | t">+1</mat-checkbox>
              </div>
            }
          </div>
        } @else {
          <p class="muted small empty-note">{{ 'setup.pickRouteFirst' | t }}</p>
        }
        @if (error()) {
          <p class="error" role="alert"><mat-icon>error</mat-icon>{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
        <button mat-flat-button (click)="save()" [disabled]="busy()">{{ 'common.save' | t }}</button>
      </mat-dialog-actions>
    }
  `,
  styles: `
    .intro { margin-bottom: 12px; }
    .times { display: flex; flex-direction: column; border: 1px solid var(--c-border); border-radius: var(--r-md); overflow: hidden; margin-top: 8px; }
    .tr { display: grid; grid-template-columns: minmax(0, 1fr) 7rem 7rem auto; gap: 8px; align-items: center; padding: 6px 12px; }
    .tr + .tr { border-top: 1px solid var(--c-border); }
    .st { font-weight: 600; min-width: 0; }
    .time { height: 36px; padding: 0 8px; border: 1px solid var(--c-border); border-radius: 8px; background: var(--c-surface); color: var(--c-text); font: inherit; }
    .empty-note { padding: 12px; border: 1px dashed var(--c-border); border-radius: var(--r-sm); }
    .error { display: flex; gap: 8px; margin-top: 12px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-bad-soft); color: var(--c-bad); }
    @media (max-width: 600px) { .tr { grid-template-columns: 1fr 1fr auto; } .st { grid-column: 1 / -1; } }
  `,
})
export class SpecialTripDialog implements OnInit {
  private readonly data = inject<CrudDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<SpecialTripDialog>);
  private readonly api = inject(AdminApi);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);
  private readonly f = inject(Format);
  private readonly localTime = inject(LocalTimeInput);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly trip = this.data.row as unknown as TripDetail | null;
  protected readonly routeId = new FormControl<string | null>(null, Validators.required);
  protected readonly trainId = new FormControl<string | null>(null, Validators.required);
  protected readonly date = new FormControl(addDays(localDate(new Date().toISOString(), this.f.zone()), 1), { nonNullable: true });
  protected readonly rows = signal<Row[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit() {
    this.routeId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(async (id) => {
      if (!id) return this.rows.set([]);
      try {
        const route = (await firstValueFrom(this.api.get('routes', id))) as Route;
        this.rows.set(
          [...route.stops]
            .sort((a, b) => a.sequence - b.sequence)
            .map((s) => ({ routeStopId: s.id, name: s.station.name, arr: '', dep: '', next: false })),
        );
      } catch (err) {
        this.notify.error(err);
      }
    });
  }

  protected set(i: number, change: Partial<Row>) {
    this.rows.update((rows) => rows.map((r, k) => (k === i ? { ...r, ...change } : r)));
  }

  protected async save() {
    const rows = this.rows();
    if (!this.routeId.value || !this.trainId.value || !this.date.value || rows.length < 2) {
      this.error.set(this.i18n.t('setup.fillRequired'));
      return;
    }
    const zone = this.f.zone();
    const convert = async (t: string, next: boolean) => {
      if (!t) return null;
      const r = await this.localTime.toUtc(next ? addDays(this.date.value, 1) : this.date.value, t, zone);
      if (!r) throw new Error('cancel');
      if ('error' in r) throw new Error(r.error);
      return r.utc;
    };
    try {
      const stops = [];
      for (const [i, r] of rows.entries()) {
        stops.push({
          routeStopId: r.routeStopId,
          scheduledArrival: i === 0 ? null : await convert(r.arr, r.next),
          scheduledDeparture: i === rows.length - 1 ? null : await convert(r.dep || r.arr, r.next),
        });
      }
      if (!stops[0].scheduledDeparture || !stops[stops.length - 1].scheduledArrival) {
        this.error.set(this.i18n.t('setup.timesMissing'));
        return;
      }
      this.busy.set(true);
      this.error.set(null);
      await firstValueFrom(
        this.api.create('trips', { routeId: this.routeId.value, trainId: this.trainId.value, serviceDate: this.date.value, stops }),
      );
      this.ref.close(true);
    } catch (err) {
      if (err instanceof Error && err.message === 'cancel') return;
      this.error.set(err instanceof Error ? err.message : this.notify.messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }
}
