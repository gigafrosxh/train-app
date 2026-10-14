import { Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Format } from '../core/i18n/format.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';

function delayClass(seconds: number): string {
  if (seconds >= 300) return 'late';
  if (seconds >= 60) return 'slight';
  return 'ontime';
}

/** Geplante Zeit, bei Abweichung durchgestrichen, daneben die erwartete. */
@Component({
  selector: 'app-time',
  template: `
    @if (cancelled()) {
      <span class="time-plan changed">{{ f.time(scheduled()) }}</span>
    } @else if (changed()) {
      <span class="time-plan changed">{{ f.time(scheduled()) }}</span>
      <span class="time-exp" [class]="cls()">{{ f.time(expected()) }}</span>
    } @else {
      <span class="time-exp plain">{{ f.time(scheduled()) }}</span>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: baseline; gap: 6px; font-variant-numeric: tabular-nums; flex-wrap: wrap; }
    .plain { font-weight: 650; }
  `,
})
export class TimeView {
  protected readonly f = inject(Format);
  readonly scheduled = input<string | null>(null);
  readonly expected = input<string | null>(null);
  readonly cancelled = input(false);

  protected readonly diff = computed(() => {
    const s = this.scheduled();
    const e = this.expected();
    if (!s || !e) return 0;
    return (Date.parse(e) - Date.parse(s)) / 1000;
  });
  // Minutengenau vergleichen, damit 30 Sekunden nicht als Änderung zählen.
  protected readonly changed = computed(() => Math.round(this.diff() / 60) !== 0);
  protected readonly cls = computed(() => 'time-exp ' + delayClass(this.diff()));
}

/** Kurzer Status: pünktlich / +5 Min. / fällt aus. */
@Component({
  selector: 'app-delay',
  imports: [TranslatePipe, MatIconModule],
  template: `
    @if (cancelled()) {
      <span class="pill bad">{{ 'status.cancelled' | t }}</span>
    } @else if (unknown()) {
      <span class="pill neutral">{{ 'status.noInfo' | t }}</span>
    } @else if (minutes() >= 1) {
      <span class="pill" [class.warn]="minutes() < 5" [class.bad]="minutes() >= 5">
        {{ 'status.late' | t: { n: minutes() } }}
      </span>
    } @else if (minutes() <= -1) {
      <span class="pill ok">{{ 'status.early' | t: { n: -minutes() } }}</span>
    } @else if (!hideOnTime()) {
      <span class="pill ok">{{ 'status.onTime' | t }}</span>
    }
  `,
  styles: ':host { display: inline-flex; }',
})
export class DelayView {
  readonly seconds = input<number | null>(0);
  readonly cancelled = input(false);
  readonly hideOnTime = input(false);
  protected readonly unknown = computed(() => this.seconds() === null);
  protected readonly minutes = computed(() => Math.round((this.seconds() ?? 0) / 60));
}

/** Gleis, bei Änderung hervorgehoben. */
@Component({
  selector: 'app-platform',
  imports: [TranslatePipe],
  template: `
    @if (expected() || scheduled()) {
      <span class="plat" [class.changed]="changed()" [attr.title]="changed() ? ('status.platformChanged' | t) : null">
        <span class="lbl">{{ 'common.platformShort' | t }}</span>
        {{ expected() ?? scheduled() }}
      </span>
    }
  `,
  styles: `
    :host { display: inline-flex; }
    .plat {
      display: inline-flex; align-items: baseline; gap: 3px;
      padding: 1px 8px; border-radius: 8px;
      border: 1px solid var(--c-border); background: var(--c-surface-2);
      font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .lbl { font-size: 0.75rem; font-weight: 500; color: var(--c-muted); }
    .changed { background: var(--c-warn-soft); border-color: transparent; color: var(--c-warn); }
    .changed .lbl { color: inherit; }
  `,
})
export class PlatformView {
  readonly scheduled = input<string | null>(null);
  readonly expected = input<string | null>(null);
  protected readonly changed = computed(
    () => !!this.expected() && !!this.scheduled() && this.expected() !== this.scheduled(),
  );
}
