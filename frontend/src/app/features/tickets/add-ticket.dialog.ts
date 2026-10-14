import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { RailApi, TicketsApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { addDays, Format, localDate, resolveLocal } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Connection, CreateTicket, StationRef } from '../../core/models/api.models';
import { apiError, Notify } from '../../core/ui/notify.service';
import { LineBadge } from '../../shared/line-badge';
import { StationPicker } from '../../shared/station-picker';
import { TimeView } from '../../shared/times';

/** Eigene Fahrkarte speichern – wird nie als geprüft markiert. */
@Component({
  selector: 'app-add-ticket',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslatePipe,
    StationPicker,
    LineBadge,
    TimeView,
    ...FORMAT_PIPES,
  ],
  templateUrl: './add-ticket.dialog.html',
  styleUrl: './add-ticket.dialog.scss',
})
export class AddTicketDialog {
  private readonly fb = inject(FormBuilder);
  private readonly rail = inject(RailApi);
  private readonly tickets = inject(TicketsApi);
  private readonly ref = inject(MatDialogRef<AddTicketDialog>);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);
  protected readonly f = inject(Format);

  protected readonly kind = signal<'trip' | 'pass'>('trip');
  protected readonly from = signal<StationRef | null>(null);
  protected readonly to = signal<StationRef | null>(null);
  protected readonly date = signal(localDate(new Date().toISOString(), this.f.zone()));
  protected readonly time = signal(this.nowHm());
  protected readonly results = signal<Connection[] | null>(null);
  protected readonly searching = signal(false);
  protected readonly picked = signal<Connection | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly direct = computed(() => (this.results() ?? []).filter((c) => c.transfers === 0));

  protected readonly form = this.fb.group({
    reference: ['', Validators.required],
    productName: [''],
    travelClass: [2 as 1 | 2 | null],
    qrPayload: [''],
    validFrom: [localDate(new Date().toISOString(), this.f.zone())],
    validUntil: [addDays(localDate(new Date().toISOString(), this.f.zone()), 30)],
  });

  private nowHm() {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: this.f.zone() }).format(new Date());
  }

  protected async search() {
    const from = this.from();
    const to = this.to();
    if (!from || !to) return;
    const r = resolveLocal(this.date(), this.time(), this.f.zone());
    const departAfter = r.kind === 'ok' ? r.utc : r.kind === 'ambiguous' ? r.earlier : null;
    if (!departAfter) {
      this.error.set(this.i18n.t('errors.SCHEDULE_TIME_NONEXISTENT'));
      return;
    }
    this.searching.set(true);
    this.picked.set(null);
    this.error.set(null);
    try {
      const page = await firstValueFrom(
        this.rail.connections({ fromStationId: from.id, toStationId: to.id, departAfter, maxTransfers: 0, pageSize: 8 }),
      );
      this.results.set(page.items);
    } catch (err) {
      this.results.set([]);
      this.error.set(this.notify.messageFor(err));
    } finally {
      this.searching.set(false);
    }
  }

  protected async save() {
    if (this.form.invalid || (this.kind() === 'trip' && !this.picked())) {
      this.form.markAllAsTouched();
      if (this.kind() === 'trip' && !this.picked()) this.error.set(this.i18n.t('tickets.pickTrip'));
      return;
    }
    const v = this.form.getRawValue();
    let body: CreateTicket;
    if (this.kind() === 'trip') {
      const leg = this.picked()!.legs[0];
      const dep = leg.from.scheduledTime;
      const arr = leg.to.scheduledTime;
      body = {
        reference: v.reference!.trim(),
        productName: v.productName?.trim() || null,
        travelClass: v.travelClass ?? null,
        qrPayload: v.qrPayload?.trim() || null,
        tripId: leg.tripId,
        boardingStopId: leg.from.stopId,
        alightingStopId: leg.to.stopId,
        validFrom: new Date(Date.parse(dep) - 3 * 3600000).toISOString(),
        validUntil: new Date(Date.parse(arr) + 3 * 3600000).toISOString(),
      };
    } else {
      const start = resolveLocal(v.validFrom!, '00:00', this.f.zone());
      const end = resolveLocal(addDays(v.validUntil!, 1), '00:00', this.f.zone());
      if (start.kind !== 'ok' || end.kind !== 'ok') {
        this.error.set(this.i18n.t('errors.SCHEDULE_TIME_NONEXISTENT'));
        return;
      }
      body = {
        reference: v.reference!.trim(),
        productName: v.productName?.trim() || null,
        travelClass: v.travelClass ?? null,
        qrPayload: v.qrPayload?.trim() || null,
        originStationId: this.from()?.id ?? null,
        destinationStationId: this.to()?.id ?? null,
        validFrom: start.utc,
        validUntil: new Date(Date.parse(end.utc) - 1000).toISOString(),
      };
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.tickets.create(body));
      this.ref.close(true);
    } catch (err) {
      const api = apiError(err);
      for (const fe of api?.fieldErrors ?? []) {
        this.form.get(fe.field)?.setErrors({ server: this.i18n.t(`fieldErrors.${fe.code}`) });
      }
      this.error.set(this.notify.messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }
}
