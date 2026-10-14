import { Component, DestroyRef, effect, inject, input, model, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { RailApi } from '../core/api/api';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { Station, StationRef } from '../core/models/api.models';

/** Bahnhofssuche mit Vorschlägen. Zweiwege-Bindung über [(station)]. */
@Component({
  selector: 'app-station-picker',
  imports: [
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    TranslatePipe,
  ],
  template: `
    <mat-form-field>
      <mat-label>{{ label() }}</mat-label>
      <mat-icon matPrefix>{{ icon() }}</mat-icon>
      <input
        matInput
        [formControl]="text"
        [matAutocomplete]="auto"
        [placeholder]="'rail.stationPlaceholder' | t"
        autocomplete="off"
        (blur)="restore()"
      />
      @if (text.value) {
        <button matSuffix mat-icon-button type="button" (click)="clear()" [attr.aria-label]="'common.clear' | t">
          <mat-icon>close</mat-icon>
        </button>
      }
      @if (error()) {
        <mat-error>{{ error() }}</mat-error>
      }
      <mat-autocomplete #auto="matAutocomplete" (optionSelected)="pick($event)" [displayWith]="display">
        @for (s of options(); track s.id) {
          <mat-option [value]="s">
            <span>{{ s.name }}</span>
            @if (s.code) {
              <span class="muted small"> · {{ s.code }}</span>
            }
          </mat-option>
        }
        @if (searched() && !options().length) {
          <mat-option disabled>{{ 'rail.noStation' | t }}</mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: ':host { display: block; min-width: 0; }',
})
export class StationPicker implements OnInit {
  private readonly api = inject(RailApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly label = input('');
  readonly icon = input('location_on');
  readonly error = input<string | null>(null);
  readonly station = model<StationRef | null>(null);

  protected readonly text = new FormControl<string | StationRef>('', { nonNullable: true });
  protected readonly options = signal<Station[]>([]);
  protected readonly searched = signal(false);

  protected display = (v: StationRef | string | null) => (typeof v === 'string' ? v : (v?.name ?? ''));

  constructor() {
    // Von außen geänderte Station im Feld anzeigen
    effect(() => {
      const s = this.station();
      untracked(() => {
        const v = this.text.value;
        if (!s) {
          if (typeof v !== 'string') this.text.setValue('', { emitEvent: false });
        } else if (typeof v === 'string' || v.id !== s.id) {
          if (v !== s.name) this.text.setValue(s, { emitEvent: false });
        }
      });
    });
  }

  ngOnInit() {
    const s = this.station();
    if (s) this.text.setValue(s, { emitEvent: false });
    this.text.valueChanges
      .pipe(
        debounceTime(180),
        distinctUntilChanged(),
        switchMap((v) => {
          if (typeof v !== 'string') return of(null);
          if (v.trim().length < 1) return of({ items: [] as Station[] });
          return this.search(v.trim());
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (!res) return;
        this.options.set(res.items);
        this.searched.set(true);
      });
  }

  /** Suche; ohne Treffer zweiter Versuch mit „Hbf“ ↔ „Hauptbahnhof“ (Daten nutzen beide Schreibweisen). */
  private search(q: string) {
    const empty = { items: [] as Station[] };
    const alt = /\bhbf\b/i.test(q)
      ? q.replace(/\bhbf\b/i, 'Hauptbahnhof')
      : /hauptbahnhof/i.test(q)
        ? q.replace(/hauptbahnhof/i, 'Hbf')
        : null;
    return this.api.stations({ q, pageSize: 8 }).pipe(
      switchMap((res) => (res.items.length || !alt ? of(res) : this.api.stations({ q: alt, pageSize: 8 }))),
      catchError(() => of(empty)),
    );
  }

  /** Von außen gesetzte Station anzeigen (z. B. nach Tauschen). */
  setStation(s: StationRef | null) {
    this.station.set(s);
    this.text.setValue(s ?? '', { emitEvent: false });
  }

  protected pick(e: MatAutocompleteSelectedEvent) {
    const s = e.option.value as Station;
    this.station.set({ id: s.id, name: s.name, code: s.code });
  }

  protected clear() {
    this.text.setValue('');
    this.station.set(null);
    this.options.set([]);
    this.searched.set(false);
  }

  /** Freitext ohne Auswahl: zur gewählten Station zurück. */
  protected restore() {
    setTimeout(() => {
      const v = this.text.value;
      if (typeof v === 'string' && this.station() && v !== this.station()!.name) {
        if (!v.trim()) this.station.set(null);
        else this.text.setValue(this.station()!, { emitEvent: false });
      }
    }, 200);
  }
}
