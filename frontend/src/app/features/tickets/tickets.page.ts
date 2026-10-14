import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { TicketsApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { Format } from '../../core/i18n/format.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TicketSummary } from '../../core/models/api.models';
import { Notify } from '../../core/ui/notify.service';
import { AddTicketDialog } from './add-ticket.dialog';
import { TicketDialog } from './ticket.dialog';

@Component({
  selector: 'app-tickets',
  imports: [MatButtonModule, MatButtonToggleModule, MatIconModule, TranslatePipe, ...FORMAT_PIPES],
  templateUrl: './tickets.page.html',
  styleUrl: './tickets.page.scss',
})
export class TicketsPage implements OnInit {
  private readonly api = inject(TicketsApi);
  private readonly dialog = inject(MatDialog);
  private readonly notify = inject(Notify);
  private readonly router = inject(Router);
  protected readonly f = inject(Format);

  readonly open = input<string>();
  readonly add = input<string>();

  protected readonly tickets = signal<TicketSummary[] | null>(null);
  protected readonly filter = signal<'valid' | 'old'>('valid');

  protected readonly shown = computed(() => {
    const all = this.tickets() ?? [];
    const valid = this.filter() === 'valid';
    const list = all.filter((t) => (t.status === 'ACTIVE') === valid);
    // Gültige: bald zuerst. Alte: zuletzt abgelaufene zuerst.
    return valid ? list : [...list].reverse();
  });
  protected readonly counts = computed(() => {
    const all = this.tickets() ?? [];
    const valid = all.filter((t) => t.status === 'ACTIVE').length;
    return { valid, old: all.length - valid };
  });

  ngOnInit() {
    this.load(() => {
      if (this.open()) {
        const t = this.tickets()?.find((x) => x.id === this.open());
        if (t) this.show(t);
      }
      if (this.add()) this.addTicket();
      if (this.open() || this.add()) this.router.navigate([], { queryParams: {}, replaceUrl: true });
    });
  }

  protected load(after?: () => void) {
    this.api.list({ pageSize: 100 }).subscribe({
      next: (p) => {
        this.tickets.set(p.items);
        after?.();
      },
      error: (err) => {
        this.tickets.set([]);
        this.notify.error(err);
      },
    });
  }

  protected isNow(t: TicketSummary) {
    const now = Date.now();
    return Date.parse(t.validFrom) <= now && Date.parse(t.validUntil) > now;
  }

  protected show(t: TicketSummary) {
    this.dialog
      .open(TicketDialog, { data: t, width: '440px', maxWidth: 'calc(100vw - 24px)', autoFocus: false })
      .afterClosed()
      .subscribe((removed) => {
        if (removed) this.load();
      });
  }

  protected addTicket() {
    this.dialog
      .open(AddTicketDialog, { width: '560px', maxWidth: 'calc(100vw - 24px)', autoFocus: false })
      .afterClosed()
      .subscribe((created) => {
        if (created) {
          this.filter.set('valid');
          this.load();
          this.notify.info('tickets.added');
        }
      });
  }
}
