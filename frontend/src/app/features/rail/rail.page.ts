import { Component, inject, input, OnInit, signal } from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { BoardTab } from './board.tab';
import { ConnectionTab } from './connection.tab';
import { LinesTab } from './lines.tab';

type Tab = 'board' | 'connection' | 'lines';

@Component({
  selector: 'app-rail',
  imports: [MatButtonToggleModule, MatIconModule, TranslatePipe, BoardTab, ConnectionTab, LinesTab],
  template: `
    <div class="page">
      <header class="page-head enter">
        <div>
          <h1>{{ 'rail.title' | t }}</h1>
          <p class="sub">{{ 'rail.subtitle' | t }}</p>
        </div>
      </header>

      <mat-button-toggle-group
        class="segmented tabs"
        [value]="active()"
        (change)="select($event.value)"
        [hideSingleSelectionIndicator]="true"
      >
        <mat-button-toggle value="board"><mat-icon>departure_board</mat-icon><span>{{ 'rail.tabBoard' | t }}</span></mat-button-toggle>
        <mat-button-toggle value="connection"><mat-icon>alt_route</mat-icon><span>{{ 'rail.tabConnection' | t }}</span></mat-button-toggle>
        <mat-button-toggle value="lines"><mat-icon>linear_scale</mat-icon><span>{{ 'rail.tabLines' | t }}</span></mat-button-toggle>
      </mat-button-toggle-group>

      @switch (active()) {
        @case ('board') { <app-board-tab class="enter" /> }
        @case ('connection') { <app-connection-tab class="enter" /> }
        @case ('lines') { <app-lines-tab class="enter" /> }
      }
    </div>
  `,
  styles: `
    .tabs { align-self: flex-start; max-width: 100%; }
    .tabs mat-icon { font-size: 1.2rem; width: 1.2rem; height: 1.2rem; vertical-align: middle; margin-right: 6px; }
    @media (max-width: 600px) {
      .tabs { align-self: stretch; }
      .tabs .mat-button-toggle { flex: 1; }
      .tabs mat-icon { display: none; }
    }
  `,
})
export class RailPage implements OnInit {
  private readonly router = inject(Router);
  readonly tab = input<string>();
  protected readonly active = signal<Tab>('board');

  ngOnInit() {
    const t = this.tab();
    if (t === 'connection' || t === 'lines' || t === 'board') this.active.set(t);
  }

  protected select(t: Tab) {
    this.active.set(t);
    this.router.navigate([], { queryParams: { tab: t }, replaceUrl: true });
  }
}
