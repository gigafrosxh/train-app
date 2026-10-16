import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DEFS } from './defs';

interface Section {
  path: string;
  icon: string;
  label: string;
}

const GROUPS: { title: string; items: Section[] }[] = [
  { title: 'setup.groupCountry', items: [{ path: 'country', icon: 'public', label: 'setup.country' }] },
  {
    title: 'setup.groupNetwork',
    items: ['stations', 'tracks', 'companies', 'lines', 'routes'].map((k) => ({ path: k, icon: DEFS[k].icon, label: DEFS[k].title })),
  },
  {
    title: 'setup.groupTimetable',
    items: ['trains', 'schedules', 'trips', 'disruptions'].map((k) => ({ path: k, icon: DEFS[k].icon, label: DEFS[k].title })),
  },
  {
    title: 'setup.groupPeople',
    items: ['users', 'worker-assignments'].map((k) => ({ path: k, icon: DEFS[k].icon, label: DEFS[k].title })),
  },
];

@Component({
  selector: 'app-setup-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, TranslatePipe],
  template: `
    <div class="page wide">
      <header class="page-head enter">
        <div>
          <h1>{{ 'setup.title' | t }}</h1>
          <p class="sub">{{ 'setup.subtitle' | t }}</p>
        </div>
      </header>
      <div class="layout">
        <nav class="sub-nav" [attr.aria-label]="'setup.title' | t">
          @for (g of groups; track g.title) {
            <div class="group">
              <span class="group-title">{{ g.title | t }}</span>
              @for (s of g.items; track s.path) {
                <a [routerLink]="s.path" routerLinkActive="active" class="link">
                  <mat-icon>{{ s.icon }}</mat-icon><span>{{ s.label | t }}</span>
                </a>
              }
            </div>
          }
        </nav>
        <div class="content"><router-outlet /></div>
      </div>
    </div>
  `,
  styles: `
    .wide { max-width: 1320px; }
    .layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 24px; align-items: start; }
    .sub-nav { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 14px; }
    .group { display: flex; flex-direction: column; gap: 2px; }
    .group-title { font-size: 0.72rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-muted); padding: 0 10px 4px; }
    .link { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; color: var(--c-muted); text-decoration: none; font-weight: 550; }
    .link mat-icon { font-size: 1.25rem; width: 1.25rem; height: 1.25rem; }
    .link:hover { background: var(--c-surface); color: var(--c-text); }
    .link.active { background: var(--c-primary-soft); color: var(--c-primary-strong); }
    .content { min-width: 0; }
    @media (max-width: 1180px) {
      .layout { grid-template-columns: minmax(0, 1fr); gap: 12px; }
      .sub-nav { position: static; flex-direction: row; overflow-x: auto; gap: 4px; padding-bottom: 4px; scrollbar-width: thin; }
      .group { flex-direction: row; gap: 4px; }
      .group-title { display: none; }
      .link { white-space: nowrap; border: 1px solid var(--c-border); background: var(--c-surface); }
    }
  `,
})
export class SetupShell {
  protected readonly groups = GROUPS;
}
