import { Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { firstValueFrom } from 'rxjs';
import { TicketsApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TicketSummary } from '../../core/models/api.models';
import { Notify } from '../../core/ui/notify.service';
import { Confirm } from '../../shared/confirm.dialog';

@Component({
  selector: 'app-ticket-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, RouterLink, TranslatePipe, ...FORMAT_PIPES],
  template: `
    <div class="head">
      <div>
        <h2>{{ t.productName ?? ('tickets.ticket' | t) }}</h2>
        @if (t.origin && t.destination) {
          <p class="route">{{ t.origin.name }} → {{ t.destination.name }}</p>
        } @else {
          <p class="route">{{ 'tickets.network' | t }}</p>
        }
      </div>
      <button mat-icon-button mat-dialog-close [attr.aria-label]="'common.close' | t"><mat-icon>close</mat-icon></button>
    </div>

    <mat-dialog-content>
      <div class="qr-box">
        @if (qr()) {
          <img [src]="qr()" [alt]="'tickets.qrAlt' | t" width="232" height="232" />
        } @else {
          <div class="no-qr">
            <mat-icon>qr_code_2</mat-icon>
            <span>{{ 'tickets.noQr' | t }}</span>
          </div>
        }
      </div>

      @if (!t.verified) {
        <p class="note"><mat-icon>info</mat-icon>{{ 'tickets.notVerified' | t }}</p>
      }

      <dl class="facts">
        <div><dt>{{ 'tickets.reference' | t }}</dt><dd class="tabular">{{ t.reference }}</dd></div>
        @if (t.travelClass) {
          <div><dt>{{ 'tickets.class' | t }}</dt><dd>{{ 'tickets.classLong' | t: { n: t.travelClass } }}</dd></div>
        }
        <div><dt>{{ 'tickets.validFrom' | t }}</dt><dd>{{ t.validFrom | dateTime }}</dd></div>
        <div><dt>{{ 'tickets.validTo' | t }}</dt><dd>{{ t.validUntil | dateTime }}</dd></div>
        @if (t.companyName) {
          <div><dt>{{ 'tickets.company' | t }}</dt><dd>{{ t.companyName }}</dd></div>
        }
      </dl>
    </mat-dialog-content>

    <mat-dialog-actions>
      <button mat-button class="remove" (click)="remove()" [disabled]="busy()">
        <mat-icon>delete</mat-icon>{{ 'tickets.remove' | t }}
      </button>
      <span class="spacer"></span>
      @if (t.tripId) {
        <a mat-flat-button [routerLink]="['/rail/trips', t.tripId]" mat-dialog-close>
          {{ 'tickets.openTrip' | t }}
        </a>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 20px 16px 0 24px; }
    .route { color: var(--c-muted); margin-top: 2px; font-weight: 500; }
    .qr-box { display: grid; place-items: center; padding: 16px; margin: 4px 0 12px; border-radius: var(--r-md); background: #fff; border: 1px solid var(--c-border); }
    .qr-box img { width: min(232px, 60vw); height: auto; image-rendering: pixelated; }
    .no-qr { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px 8px; color: #56627c; text-align: center; }
    .no-qr mat-icon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; opacity: 0.4; }
    .note { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-warn-soft); color: var(--c-warn); margin-bottom: 12px; font-size: 0.9rem; }
    .note mat-icon { flex: none; font-size: 1.2rem; width: 1.2rem; height: 1.2rem; }
    .facts { margin: 0; display: grid; gap: 8px; }
    .facts div { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    dt { color: var(--c-muted); }
    dd { margin: 0; font-weight: 600; text-align: right; }
    .remove { color: var(--c-bad); }
  `,
})
export class TicketDialog implements OnInit {
  protected readonly t = inject<TicketSummary>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<TicketDialog>);
  private readonly api = inject(TicketsApi);
  private readonly confirm = inject(Confirm);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);
  protected readonly qr = signal<string | null>(null);
  protected readonly busy = signal(false);

  async ngOnInit() {
    if (!this.t.qrPayload) return;
    try {
      this.qr.set(await QRCode.toDataURL(this.t.qrPayload, { margin: 1, width: 464, errorCorrectionLevel: 'M' }));
    } catch {
      this.qr.set(null);
    }
  }

  protected async remove() {
    const ok = await this.confirm.ask({
      title: this.i18n.t('tickets.removeTitle'),
      text: this.i18n.t('tickets.removeText'),
      confirm: this.i18n.t('tickets.remove'),
      danger: true,
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.remove(this.t.id));
      this.notify.info('tickets.removed');
      this.ref.close(true);
    } catch (err) {
      this.notify.error(err);
    } finally {
      this.busy.set(false);
    }
  }
}
