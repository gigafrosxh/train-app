import { Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { interval, merge } from 'rxjs';
import { RailApi } from '../core/api/api';
import { FORMAT_PIPES } from '../core/i18n/format.pipes';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { Disruption } from '../core/models/api.models';
import { RealtimeService } from '../core/realtime/realtime.service';

const ICON: Record<Disruption['severity'], string> = { SEVERE: 'error', WARNING: 'warning', INFO: 'info' };

/**
 * Aktive Störungen und Baustellen. Mit stationId/lineId nur die betroffenen (plus netzweite).
 * Aktualisiert sich bei Live-Ereignissen; ausgeblendete bleiben bis zum Neuladen weg.
 */
@Component({
  selector: 'app-disruption-banner',
  imports: [MatIconModule, MatButtonModule, TranslatePipe, ...FORMAT_PIPES],
  template: `
    @for (d of visible(); track d.id) {
      <section class="disruption" [class]="d.severity.toLowerCase()" role="status">
        <mat-icon class="lead">{{ icon[d.severity] }}</mat-icon>
        <div class="body">
          <strong>{{ d.title }}</strong>
          @if (d.text && !compact()) {
            <span class="text">{{ d.text }}</span>
          }
          <span class="muted small">
            @if (d.reasonCode) {
              {{ 'reasons.' + d.reasonCode | t }} ·
            }
            @if (d.validUntil) {
              {{ 'disruptions.until' | t: { date: (d.validUntil | day), time: (d.validUntil | hm) } }}
            } @else {
              {{ 'disruptions.open' | t }}
            }
          </span>
        </div>
        <button mat-icon-button type="button" class="close" (click)="hide(d.id)" [attr.aria-label]="'common.close' | t">
          <mat-icon>close</mat-icon>
        </button>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    :host:empty { display: none; }
    .disruption {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px 8px 12px 14px;
      border-radius: var(--r-md);
      border: 1px solid var(--c-border);
      background: var(--c-surface);
      border-left: 4px solid var(--c-muted);
    }
    .disruption.warning { border-left-color: var(--c-warn); background: linear-gradient(var(--c-warn-soft), var(--c-warn-soft)), var(--c-surface); }
    .disruption.severe { border-left-color: var(--c-bad); background: linear-gradient(var(--c-bad-soft), var(--c-bad-soft)), var(--c-surface); }
    .lead { margin-top: 2px; color: var(--c-muted); flex: none; }
    .warning .lead { color: var(--c-warn); }
    .severe .lead { color: var(--c-bad); }
    .body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .text { overflow-wrap: anywhere; }
    .close { flex: none; margin: -6px 0; }
  `,
})
export class DisruptionBanner {
  private readonly api = inject(RailApi);
  protected readonly icon = ICON;

  readonly stationId = input<string | null>(null);
  readonly lineId = input<string | null>(null);
  /** Nur Titel und Gültigkeit (z. B. auf Home) */
  readonly compact = input(false);
  readonly max = input(3);

  private readonly items = signal<Disruption[]>([]);
  private readonly hidden = signal<Set<string>>(new Set());
  protected readonly visible = computed(() => this.items().filter((d) => !this.hidden().has(d.id)).slice(0, this.max()));

  constructor() {
    effect(() => {
      this.stationId();
      this.lineId();
      untracked(() => this.load());
    });
    merge(inject(RealtimeService).disruptionUpdates(), interval(5 * 60000))
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.load());
  }

  private load() {
    this.api
      .disruptions({ stationId: this.stationId() ?? undefined, lineId: this.lineId() ?? undefined, pageSize: 20 })
      // Störungen sind Zusatzinfo: Fehler hier nicht melden
      .subscribe({ next: (p) => this.items.set(p.items), error: () => this.items.set([]) });
  }

  protected hide(id: string) {
    this.hidden.update((s) => new Set(s).add(id));
  }
}
