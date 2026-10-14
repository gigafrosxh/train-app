import { Component } from '@angular/core';
import { environment } from '../../environments/environment';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { APP_VERSION, RELEASE_URL } from '../core/version';

/** Versionsnummer am unteren Seitenrand. */
@Component({
  selector: 'app-version-footer',
  imports: [TranslatePipe],
  template: `
    <footer>
      <a [href]="url" target="_blank" rel="noopener">{{ 'shell.version' | t: { v: version } }}</a>
      @if (demo) {
        <span aria-hidden="true">·</span>
        <span>{{ 'shell.demo' | t }}</span>
      }
    </footer>
  `,
  styles: `
    :host { display: block; }
    footer {
      display: flex; justify-content: center; align-items: center; gap: 6px;
      padding: 10px 16px; font-size: 0.75rem; color: var(--c-muted);
    }
    a { color: inherit; text-decoration: none; font-variant-numeric: tabular-nums; }
    a:hover { color: var(--c-primary); text-decoration: underline; }
  `,
})
export class VersionFooter {
  protected readonly version = APP_VERSION;
  protected readonly url = RELEASE_URL;
  protected readonly demo = environment.useMocks;
}
