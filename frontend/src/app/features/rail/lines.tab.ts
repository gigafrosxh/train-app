import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { RailApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Line, TripSummary } from '../../core/models/api.models';
import { Notify } from '../../core/ui/notify.service';
import { LineBadge } from '../../shared/line-badge';
import { DelayView, TimeView } from '../../shared/times';

@Component({
  selector: 'app-lines-tab',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    TranslatePipe,
    LineBadge,
    TimeView,
    DelayView,
    ...FORMAT_PIPES,
  ],
  template: `
    <div class="layout">
      <section class="card lines">
        <mat-form-field>
          <mat-label>{{ 'rail.filterLines' | t }}</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input matInput [value]="q()" (input)="q.set($any($event.target).value)" />
        </mat-form-field>
        @if (lines() === null) {
          <div class="skeleton" style="height: 240px"></div>
        } @else {
          <ul class="list-reset">
            @for (l of filtered(); track l.id) {
              <li>
                <button type="button" class="line clickable" [class.on]="selected()?.id === l.id" (click)="pick(l)">
                  <span class="swatch" [style.background]="l.color ?? 'var(--c-primary)'"></span>
                  <span class="line-text">
                    <strong>{{ l.name }}</strong>
                    <span class="muted small">{{ l.code }}</span>
                  </span>
                  <mat-icon>chevron_right</mat-icon>
                </button>
              </li>
            } @empty {
              <li class="empty small">{{ 'rail.noLines' | t }}</li>
            }
          </ul>
        }
      </section>

      <section class="card trips">
        @if (!selected()) {
          <div class="empty">
            <mat-icon>linear_scale</mat-icon>
            <strong>{{ 'rail.pickLine' | t }}</strong>
            <span>{{ 'rail.pickLineHint' | t }}</span>
          </div>
        } @else {
          <div class="card-title">
            <h2>{{ selected()!.name }}</h2>
            <span class="muted small">{{ 'rail.next24h' | t }}</span>
          </div>
          @if (trips() === null) {
            <div class="skeleton" style="height: 200px"></div>
          } @else if (!trips()!.length) {
            <div class="empty"><span>{{ 'rail.noTrains' | t }}</span></div>
          } @else {
            <ul class="list-reset enter-list">
              @for (t of trips(); track t.id) {
                <li>
                  <a class="trip clickable" [routerLink]="['/rail/trips', t.id]">
                    <app-line-badge [label]="t.trainNumber" [color]="t.lineColor" />
                    <span class="trip-text">
                      <span class="row">
                        <app-time [scheduled]="t.scheduledDeparture" [expected]="t.expectedDeparture" [cancelled]="t.status === 'CANCELLED'" />
                        <strong>{{ t.origin.name }} → {{ t.destination.name }}</strong>
                      </span>
                      <span class="muted small">{{ t.scheduledDeparture | day }} · {{ 'rail.arrives' | t: { time: (t.expectedArrival ?? t.scheduledArrival) | hm } }}</span>
                    </span>
                    <app-delay [seconds]="t.delaySeconds" [cancelled]="t.status === 'CANCELLED'" [hideOnTime]="true" />
                  </a>
                </li>
              }
            </ul>
          }
        }
      </section>
    </div>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .lines ul { display: flex; flex-direction: column; gap: 2px; max-height: 60vh; overflow-y: auto; margin: 0 -8px; padding: 0 8px; }
    .line { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border: none; background: none; border-radius: var(--r-md); color: inherit; font: inherit; text-align: left; }
    .line.on { background: var(--c-primary-soft); }
    .line mat-icon { color: var(--c-muted); }
    .swatch { flex: none; width: 12px; height: 32px; border-radius: 6px; }
    .line-text, .trip-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .trip { display: flex; align-items: center; gap: 12px; padding: 10px; margin: 0 -10px; border-radius: var(--r-md); color: inherit; text-decoration: none; }
    @media (max-width: 800px) { .layout { grid-template-columns: minmax(0, 1fr); } .lines ul { max-height: 260px; } }
  `,
})
export class LinesTab implements OnInit {
  private readonly api = inject(RailApi);
  private readonly notify = inject(Notify);
  protected readonly lines = signal<Line[] | null>(null);
  protected readonly q = signal('');
  protected readonly selected = signal<Line | null>(null);
  protected readonly trips = signal<TripSummary[] | null>(null);
  protected readonly filtered = computed(() => {
    const q = this.q().toLowerCase().trim();
    return (this.lines() ?? []).filter((l) => !q || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q));
  });

  ngOnInit() {
    this.api.lines({ pageSize: 100 }).subscribe({
      next: (p) => this.lines.set(p.items),
      error: (err) => {
        this.lines.set([]);
        this.notify.error(err);
      },
    });
  }

  protected pick(l: Line) {
    this.selected.set(l);
    this.trips.set(null);
    this.api.trips({ lineId: l.id, pageSize: 50 }).subscribe({
      next: (p) => this.trips.set(p.items),
      error: (err) => {
        this.trips.set([]);
        this.notify.error(err);
      },
    });
  }
}
