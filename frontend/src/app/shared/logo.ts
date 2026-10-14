import { Component, input } from '@angular/core';

/** Bildmarke: zwei Schienen mit Schwellen. */
@Component({
  selector: 'app-logo',
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--c-primary)" />
      <path
        d="M22 14 18 50M42 14l4 36M17 24h30M16 34h32M15 44h34"
        stroke="var(--c-on-primary)"
        stroke-width="4.5"
        stroke-linecap="round"
        fill="none"
      />
    </svg>
  `,
  styles: ':host { display: inline-flex; flex: none; }',
})
export class Logo {
  readonly size = input(34);
}
