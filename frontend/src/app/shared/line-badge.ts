import { Component, computed, input } from '@angular/core';

function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#0f1a30' : '#fff';
}

/** Zugnummer im Linienfarbton, z. B. „RJ 540“. */
@Component({
  selector: 'app-line-badge',
  template: `<span class="badge" [style.background]="bg()" [style.color]="fg()">{{ label() }}</span>`,
  styles: `
    :host { display: inline-flex; flex: none; }
    .badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 7px;
      font-weight: 700;
      font-size: 0.8125rem;
      line-height: 1.55;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class LineBadge {
  readonly label = input.required<string>();
  readonly color = input<string | null>(null);
  protected readonly bg = computed(() => this.color() ?? 'var(--c-primary)');
  protected readonly fg = computed(() => (this.color() ? textOn(this.color()!) : 'var(--c-on-primary)'));
}
