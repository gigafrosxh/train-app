import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { AdminApi } from '../../core/api/api';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Route, StationRef } from '../../core/models/api.models';
import { Notify } from '../../core/ui/notify.service';
import { StationPicker } from '../../shared/station-picker';
import { CrudDialogData } from './crud.dialog';
import { LookupField } from './lookup-field';

interface StopItem {
  id?: string;
  station: StationRef;
}

@Component({
  selector: 'app-route-dialog',
  imports: [
    ReactiveFormsModule,
    DragDropModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    TranslatePipe,
    StationPicker,
    LookupField,
  ],
  template: `
    <h2 mat-dialog-title>{{ (route ? 'setup.edit' : 'setup.create') | t: { what: ('setup.one.routes' | t) } }}</h2>
    <mat-dialog-content>
      <div class="form-grid">
        <app-lookup-field class="full" [formControl]="lineId" resource="lines" [label]="'setup.f.line' | t" />
        <mat-form-field>
          <mat-label>{{ 'setup.f.name' | t }}</mat-label>
          <input matInput [formControl]="name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'setup.f.direction' | t }}</mat-label>
          <input matInput [formControl]="direction" />
        </mat-form-field>
      </div>

      <h3 class="sub">{{ 'setup.f.stops' | t }}</h3>
      <p class="muted small">{{ 'setup.stopsHint' | t }}</p>
      <ol class="list-reset stops" cdkDropList (cdkDropListDropped)="drop($event)">
        @for (s of stops(); track $index; let i = $index; let last = $last) {
          <li class="stop" cdkDrag>
            <mat-icon class="handle" cdkDragHandle>drag_indicator</mat-icon>
            <span class="num">{{ i + 1 }}</span>
            <span class="name">{{ s.station.name }}</span>
            @if (!s.id) {
              <span class="pill">{{ 'setup.newStop' | t }}</span>
            }
            <button mat-icon-button (click)="remove(i)" [attr.aria-label]="'common.delete' | t"><mat-icon>close</mat-icon></button>
          </li>
        } @empty {
          <li class="muted small">{{ 'setup.noStops' | t }}</li>
        }
      </ol>
      <div class="add">
        <app-station-picker #picker [label]="'setup.addStop' | t" icon="add_location" [suggest]="false" (stationChange)="add($event)" />
      </div>
      @if (error()) {
        <p class="error" role="alert"><mat-icon>error</mat-icon>{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="busy()">{{ 'common.save' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .sub { margin: 12px 0 2px; }
    .stops { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; }
    .stop { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 10px; border: 1px solid var(--c-border); border-radius: var(--r-sm); background: var(--c-surface); }
    .handle { cursor: grab; color: var(--c-muted); }
    .num { width: 1.5rem; text-align: right; font-variant-numeric: tabular-nums; color: var(--c-muted); }
    .name { flex: 1; min-width: 0; font-weight: 600; }
    .cdk-drag-preview { box-shadow: var(--shadow-2); }
    .cdk-drag-placeholder { opacity: 0.3; }
    .cdk-drag-animating, .stops.cdk-drop-list-dragging .stop:not(.cdk-drag-placeholder) { transition: transform 180ms var(--ease); }
    .error { display: flex; gap: 8px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-bad-soft); color: var(--c-bad); }
  `,
})
export class RouteDialog {
  private readonly data = inject<CrudDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<RouteDialog>);
  private readonly api = inject(AdminApi);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);
  private readonly picker = viewChild.required<StationPicker>('picker');

  protected readonly route = this.data.row as unknown as Route | null;
  protected readonly lineId = new FormControl<string | null>(this.route?.lineId ?? null, Validators.required);
  protected readonly name = new FormControl(this.route?.name ?? '', { nonNullable: true, validators: Validators.required });
  protected readonly direction = new FormControl(this.route?.direction ?? '', { nonNullable: true, validators: Validators.required });
  protected readonly stops = signal<StopItem[]>(
    [...(this.route?.stops ?? [])].sort((a, b) => a.sequence - b.sequence).map((s) => ({ id: s.id, station: s.station })),
  );
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected add(s: StationRef | null) {
    if (!s) return;
    this.stops.update((list) => [...list, { station: s }]);
    // Richtung automatisch vorschlagen
    if (!this.direction.value) this.direction.setValue(s.name);
    setTimeout(() => this.picker().setStation(null));
  }

  protected remove(i: number) {
    this.stops.update((list) => list.filter((_, k) => k !== i));
  }

  protected drop(e: CdkDragDrop<StopItem[]>) {
    const list = [...this.stops()];
    moveItemInArray(list, e.previousIndex, e.currentIndex);
    this.stops.set(list);
  }

  protected async save() {
    this.lineId.markAsTouched();
    this.name.markAsTouched();
    this.direction.markAsTouched();
    if (this.lineId.invalid || this.name.invalid || this.direction.invalid) {
      this.error.set(this.i18n.t('setup.fillRequired'));
      return;
    }
    if (this.stops().length < 2) {
      this.error.set(this.i18n.t('setup.twoStops'));
      return;
    }
    const body = {
      lineId: this.lineId.value!,
      name: this.name.value.trim(),
      direction: this.direction.value.trim(),
      stops: this.stops().map((s, i) => ({ ...(s.id ? { id: s.id } : {}), stationId: s.station.id, sequence: i + 1 })),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.route) await firstValueFrom(this.api.update('routes', this.route.id, { ...body, version: this.route.version }));
      else await firstValueFrom(this.api.create('routes', { ...body, trackIds: [] }));
      this.ref.close(true);
    } catch (err) {
      this.error.set(this.notify.messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }
}
