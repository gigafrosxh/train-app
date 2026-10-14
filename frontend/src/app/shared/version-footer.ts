import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { APP_VERSION, RELEASE_URL } from '../core/version';

/** Versionsnummer am unteren Seitenrand (App und Server). */
@Component({
  selector: 'app-version-footer',
  imports: [TranslatePipe],
  template: `
    <footer>
      <a [href]="url" target="_blank" rel="noopener">{{ 'shell.version' | t: { v: version } }}</a>
      @if (server(); as s) {
        <span aria-hidden="true">·</span>
        <span [class.mismatch]="s !== version" [attr.title]="s !== version ? ('shell.versionMismatch' | t) : null">
          {{ 'shell.serverVersion' | t: { v: s } }}
        </span>
      }
      @if (demo) {
        <span aria-hidden="true">·</span>
        <span>{{ 'shell.demo' | t }}</span>
      }
    </footer>
  `,
  styles: `
    :host { display: block; }
    footer {
      display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 6px;
      padding: 10px 16px; font-size: 0.75rem; color: var(--c-muted); font-variant-numeric: tabular-nums;
    }
    a { color: inherit; text-decoration: none; }
    a:hover { color: var(--c-primary); text-decoration: underline; }
    .mismatch { color: var(--c-warn); }
  `,
})
export class VersionFooter {
  protected readonly version = APP_VERSION;
  protected readonly url = RELEASE_URL;
  protected readonly demo = environment.useMocks;
  protected readonly server = signal<string | null>(null);

  constructor() {
    // Öffentlicher Endpunkt, liefert { status, version }
    if (!this.demo) {
      inject(HttpClient)
        .get<{ version?: string }>(`${environment.apiBase}/health/live`)
        .subscribe({ next: (r) => this.server.set(r.version ?? null), error: () => {} });
    }
  }
}
