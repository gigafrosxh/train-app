import { Component, computed, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { StationRef } from '../core/models/api.models';
import { StationMemory } from '../core/prefs/station-memory';

/**
 * Favoriten (Stern) und zuletzt gewählte Bahnhöfe als Chips.
 * Ohne Listener auf (picked) sind es Links auf die Abfahrtstafel.
 */
@Component({
  selector: 'app-station-chips',
  imports: [RouterLink, MatIconModule],
  template: `
    <ul class="list-reset chips">
      @for (s of list(); track s.station.id) {
        <li>
          @if (asLinks()) {
            <a class="chip clickable" routerLink="/rail" [queryParams]="{ tab: 'board', station: s.station.id, name: s.station.name }">
              <mat-icon [class.fav]="s.fav">{{ s.fav ? 'star' : 'history' }}</mat-icon>{{ s.station.name }}
            </a>
          } @else {
            <button type="button" class="chip clickable" (click)="picked.emit(s.station)">
              <mat-icon [class.fav]="s.fav">{{ s.fav ? 'star' : 'history' }}</mat-icon>{{ s.station.name }}
            </button>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      padding: 6px 14px 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--c-border);
      background: var(--c-surface);
      color: var(--c-text);
      font: inherit;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .chip:hover { border-color: var(--c-primary); }
    .chip:focus-visible { outline: 2px solid var(--c-primary); outline-offset: 2px; }
    mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; color: var(--c-muted); }
    mat-icon.fav { color: var(--c-warn); }
  `,
})
export class StationChips {
  private readonly memory = inject(StationMemory);

  /** false: nur Favoriten, true: auch zuletzt gewählte */
  readonly withRecent = input(true);
  readonly max = input(8);
  readonly asLinks = input(false);
  readonly picked = output<StationRef>();

  readonly list = computed(() => {
    const fav = this.memory.favorites().map((station) => ({ station, fav: true }));
    const recent = this.withRecent()
      ? this.memory.recent().filter((r) => !fav.some((f) => f.station.id === r.id)).map((station) => ({ station, fav: false }))
      : [];
    return [...fav, ...recent].slice(0, this.max());
  });
}
