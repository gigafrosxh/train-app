import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { firstValueFrom } from 'rxjs';
import { AdminApi } from '../../core/api/api';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { apiError, Notify } from '../../core/ui/notify.service';
import { FieldDef, ResourceDef } from './defs';
import { LookupField } from './lookup-field';

export interface CrudDialogData {
  def: ResourceDef;
  row: (Record<string, unknown> & { id: string; version: number }) | null;
}

const COORDS: ValidatorFn = (c) => {
  const v = String(c.value ?? '').trim();
  if (!v) return null;
  const m = /^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/.exec(v);
  if (!m) return { coords: true };
  const lng = Number(m[1]);
  const lat = Number(m[3]);
  return Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? null : { coords: true };
};

/** Generisches Formular für einfache Stammdaten. */
@Component({
  selector: 'app-crud-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatIconModule,
    TranslatePipe,
    LookupField,
  ],
  template: `
    <h2 mat-dialog-title>{{ (data.row ? 'setup.edit' : 'setup.create') | t: { what: ('setup.one.' + data.def.resource | t) } }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form-grid" (ngSubmit)="save()">
        @for (f of visible(); track f.key) {
          <div [class.full]="f.full">
            @switch (f.type) {
              @case ('select') {
                <mat-form-field>
                  <mat-label>{{ f.label | t }}</mat-label>
                  <mat-select [formControlName]="f.key">
                    @for (o of f.options ?? []; track o.value) {
                      <mat-option [value]="o.value">{{ o.label | t }}</mat-option>
                    }
                  </mat-select>
                  @if (errorFor(f.key)) {
                    <mat-error>{{ errorFor(f.key) }}</mat-error>
                  }
                </mat-form-field>
              }
              @case ('bool') {
                <mat-slide-toggle class="toggle" [formControlName]="f.key">{{ f.label | t }}</mat-slide-toggle>
              }
              @case ('lookup') {
                <app-lookup-field
                  [formControlName]="f.key"
                  [resource]="f.resource!"
                  [query]="f.query ?? {}"
                  [label]="f.label | t"
                  [error]="errorFor(f.key)"
                />
              }
              @case ('color') {
                <mat-form-field>
                  <mat-label>{{ f.label | t }}</mat-label>
                  <input matInput [formControlName]="f.key" placeholder="#1D5BD6" />
                  <input matSuffix type="color" class="picker" [value]="form.get(f.key)?.value || '#1d5bd6'" (input)="form.get(f.key)?.setValue($any($event.target).value)" />
                  @if (errorFor(f.key)) {
                    <mat-error>{{ errorFor(f.key) }}</mat-error>
                  }
                </mat-form-field>
              }
              @default {
                <mat-form-field>
                  <mat-label>{{ f.label | t }}</mat-label>
                  <input
                    matInput
                    [formControlName]="f.key"
                    [type]="f.type === 'coords' ? 'text' : f.type"
                    [autocomplete]="f.type === 'password' ? 'new-password' : 'off'"
                  />
                  @if (f.hint) {
                    <mat-hint>{{ f.hint | t }}</mat-hint>
                  }
                  @if (errorFor(f.key)) {
                    <mat-error>{{ errorFor(f.key) }}</mat-error>
                  }
                </mat-form-field>
              }
            }
          </div>
        }
      </form>
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
    .toggle { display: block; margin: 12px 0 18px; }
    .picker { width: 32px; height: 28px; border: none; background: none; padding: 0; margin-right: 8px; cursor: pointer; }
    .error { display: flex; gap: 8px; margin-top: 8px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-bad-soft); color: var(--c-bad); }
    .error mat-icon { flex: none; }
  `,
})
export class CrudDialog {
  protected readonly data = inject<CrudDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<CrudDialog>);
  private readonly api = inject(AdminApi);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly serverErrors = signal<Record<string, string>>({});

  private readonly fields = this.data.def.fields.filter((f) => (this.data.row ? !f.createOnly : !f.editOnly));
  protected readonly form = new FormGroup(
    Object.fromEntries(
      this.fields.map((f) => {
        const validators = [];
        if (f.required && f.type !== 'bool') validators.push(Validators.required);
        if (f.type === 'email') validators.push(Validators.email);
        if (f.type === 'coords') validators.push(COORDS);
        if (f.type === 'color') validators.push(Validators.pattern(/^#[0-9a-fA-F]{6}$/));
        if (f.type === 'password') validators.push(Validators.minLength(8));
        return [f.key, new FormControl<unknown>(this.initial(f), validators)];
      }),
    ),
  );
  private readonly values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected readonly visible = computed(() => {
    const v = this.values() as Record<string, unknown>;
    return this.fields.filter((f) => !f.showIf || f.showIf(v));
  });

  private initial(f: FieldDef): unknown {
    const row = this.data.row ? (this.data.def.fromRow ? this.data.def.fromRow(this.data.row) : this.data.row) : null;
    if (row && f.key in row) {
      const v = row[f.key];
      if (f.type === 'coords' && Array.isArray(v)) return `${v[0]}, ${v[1]}`;
      return v ?? (f.type === 'bool' ? false : '');
    }
    const d = typeof f.default === 'function' ? (f.default as () => unknown)() : f.default;
    return d ?? (f.type === 'bool' ? false : f.type === 'lookup' ? null : '');
  }

  protected errorFor(key: string): string | null {
    const server = this.serverErrors()[key];
    if (server) return server;
    const c = this.form.get(key);
    if (!c || !c.invalid || !c.touched) return null;
    if (c.hasError('required')) return this.i18n.t('common.required');
    if (c.hasError('email')) return this.i18n.t('login.emailInvalid');
    if (c.hasError('coords')) return this.i18n.t('setup.coordsInvalid');
    if (c.hasError('pattern')) return this.i18n.t('setup.colorInvalid');
    if (c.hasError('minlength')) return this.i18n.t('login.passwordHint');
    return this.i18n.t('fieldErrors.INVALID');
  }

  private body(): Record<string, unknown> {
    const raw = this.form.getRawValue() as Record<string, unknown>;
    const visible = new Set(this.visible().map((f) => f.key));
    const out: Record<string, unknown> = {};
    for (const f of this.fields) {
      if (!visible.has(f.key)) continue;
      let v = raw[f.key];
      if (f.type === 'coords') v = String(v).split(',').map((n) => Number(n.trim()));
      else if (f.type === 'number') v = v === '' || v === null ? null : Number(v);
      else if (typeof v === 'string') v = v.trim() === '' ? null : v.trim();
      out[f.key] = v;
    }
    return this.data.def.toBody ? this.data.def.toBody(out, this.data.row) : out;
  }

  protected async save() {
    // Pflichtfelder bei bedingten Feldern prüfen
    for (const f of this.visible()) {
      if (f.showIf && f.type === 'lookup' && !this.form.get(f.key)?.value) this.form.get(f.key)?.setErrors({ required: true });
    }
    this.form.markAllAsTouched();
    this.serverErrors.set({});
    const invalid = this.visible().some((f) => this.form.get(f.key)?.invalid);
    if (invalid) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = this.body();
      if (this.data.row) {
        await firstValueFrom(this.api.update(this.data.def.resource, this.data.row.id, { ...body, version: this.data.row.version }));
      } else {
        await firstValueFrom(this.api.create(this.data.def.resource, body));
      }
      this.ref.close(true);
    } catch (err) {
      const api = apiError(err);
      const fe: Record<string, string> = {};
      for (const e of api?.fieldErrors ?? []) fe[e.field] = this.i18n.t(`fieldErrors.${e.code}`);
      this.serverErrors.set(fe);
      this.error.set(this.notify.messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }
}
