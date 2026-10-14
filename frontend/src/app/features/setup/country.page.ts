import { Component, DestroyRef, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { AdminApi, SettingsApi } from '../../core/api/api';
import { FORMAT_PIPES } from '../../core/i18n/format.pipes';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ImportJob } from '../../core/models/api.models';
import { SettingsStore } from '../../core/prefs/settings.store';
import { apiError, errorCode, Notify } from '../../core/ui/notify.service';
import { Confirm } from '../../shared/confirm.dialog';

@Component({
  selector: 'app-country-page',
  imports: [MatButtonModule, MatFormFieldModule, MatSelectModule, MatIconModule, MatProgressBarModule, TranslatePipe, ...FORMAT_PIPES],
  template: `
    <section class="card enter">
      <h2 class="title"><mat-icon>public</mat-icon>{{ 'setup.country' | t }}</h2>
      <p class="muted small">{{ 'setup.countryIntro' | t }}</p>

      <div class="row pick">
        <mat-form-field class="sel">
          <mat-label>{{ 'setup.activeCountry' | t }}</mat-label>
          <mat-select [value]="store.activeCountry()" (selectionChange)="change($event.value)" [disabled]="busy()">
            @for (c of store.countries(); track c.code) {
              <mat-option [value]="c.code" [disabled]="!c.enabled">
                {{ c.names[i18n.lang()] }}
                @if (!c.enabled) {
                  <span class="muted small"> · {{ 'setup.notAvailable' | t }}</span>
                }
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      @if (store.settings(); as s) {
        <p class="muted small">
          {{ 'setup.window' | t: { days: s.tripGenerationDays } }}
          ({{ s.searchWindow.from | dateTime }} – {{ s.searchWindow.to | dateTime }})
        </p>
      }
    </section>

    <section class="card enter">
      <h2 class="title"><mat-icon>cloud_download</mat-icon>{{ 'setup.data' | t }}</h2>
      <p class="muted small">{{ 'setup.dataIntro' | t }}</p>

      <ul class="list-reset countries">
        @for (c of store.countries(); track c.code) {
          <li>
            <span class="name">{{ c.names[i18n.lang()] }}</span>
            <span class="pill" [class.ok]="c.dataStatus === 'READY'" [class.warn]="c.dataStatus === 'IMPORTING'" [class.bad]="c.dataStatus === 'FAILED'" [class.neutral]="c.dataStatus === 'NOT_IMPORTED'">
              {{ 'dataStatus.' + c.dataStatus | t }}
            </span>
          </li>
        }
      </ul>

      <div class="row actions">
        <button mat-flat-button (click)="start('RAILWAYS')" [disabled]="!!running()">
          <mat-icon>conversion_path</mat-icon>{{ 'setup.importRailways' | t }}
        </button>
        <button mat-stroked-button (click)="start('STATIONS')" [disabled]="!!running()">
          <mat-icon>location_on</mat-icon>{{ 'setup.importStations' | t }}
        </button>
      </div>

      @if (job(); as j) {
        <div class="job" [class.failed]="j.status === 'FAILED'">
          <div class="row">
            <strong>{{ 'importKind.' + j.kind | t }} · {{ j.country }}</strong>
            <span class="spacer"></span>
            <span class="pill" [class.ok]="j.status === 'DONE'" [class.bad]="j.status === 'FAILED'">{{ 'importStatus.' + j.status | t }}</span>
          </div>
          @if (j.status === 'QUEUED' || j.status === 'RUNNING') {
            <mat-progress-bar [mode]="j.progress === null ? 'indeterminate' : 'determinate'" [value]="j.progress ?? 0" />
            @if (j.progress !== null) {
              <span class="muted small">{{ j.progress }} %</span>
            }
          }
          @if (j.errorMessage) {
            <p class="small err">{{ j.errorMessage }}</p>
          }
          @if (j.finishedAt) {
            <p class="muted small">{{ 'setup.finished' | t: { time: (j.finishedAt | dateTime) } }}</p>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .title { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .title mat-icon { color: var(--c-primary); }
    .pick { margin-top: 12px; }
    .sel { max-width: 320px; }
    .countries { display: flex; flex-direction: column; margin: 12px 0; }
    .countries li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--c-border); }
    .countries li:last-child { border-bottom: none; }
    .name { font-weight: 600; }
    .actions { gap: 8px; }
    .job { margin-top: 16px; padding: 14px; border: 1px solid var(--c-border); border-radius: var(--r-md); display: flex; flex-direction: column; gap: 8px; background: var(--c-surface-2); }
    .job.failed { border-color: var(--c-bad); }
    .err { color: var(--c-bad); }
  `,
})
export class CountryPage {
  protected readonly store = inject(SettingsStore);
  protected readonly i18n = inject(I18n);
  private readonly settingsApi = inject(SettingsApi);
  private readonly admin = inject(AdminApi);
  private readonly notify = inject(Notify);
  private readonly confirm = inject(Confirm);

  protected readonly busy = signal(false);
  protected readonly job = signal<ImportJob | null>(null);
  protected readonly running = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.store.reload();
    inject(DestroyRef).onDestroy(() => this.timer && clearTimeout(this.timer));
  }

  protected async change(code: string) {
    if (code === this.store.activeCountry()) return;
    const c = this.store.countries().find((x) => x.code === code);
    const ok = await this.confirm.ask({
      title: this.i18n.t('setup.switchTitle'),
      text: this.i18n.t('setup.switchText', { country: c?.names[this.i18n.lang()] ?? code }),
      confirm: this.i18n.t('setup.switch'),
    });
    if (!ok) {
      // Auswahl zurücksetzen
      this.store.set({ ...this.store.settings()! });
      return;
    }
    this.busy.set(true);
    try {
      const s = await firstValueFrom(this.settingsApi.setActiveCountry(code));
      this.store.set(s);
      this.notify.info('setup.switched');
    } catch (err) {
      this.notify.error(err);
      this.store.set({ ...this.store.settings()! });
    } finally {
      this.busy.set(false);
    }
  }

  protected async start(kind: ImportJob['kind']) {
    try {
      const job = await firstValueFrom(this.admin.startImport(this.store.activeCountry(), kind));
      this.track(job);
    } catch (err) {
      if (errorCode(err) === 'IMPORT_ALREADY_RUNNING') {
        const id = apiError(err)?.details?.['jobId'];
        this.notify.info('setup.importRunning');
        if (typeof id === 'string') this.poll(id);
        return;
      }
      this.notify.error(err);
    }
  }

  private track(job: ImportJob) {
    this.job.set(job);
    const active = job.status === 'QUEUED' || job.status === 'RUNNING';
    this.running.set(active ? job.id : null);
    if (active) this.timer = setTimeout(() => this.poll(job.id), 3000);
    else this.store.reload();
  }

  private poll(id: string) {
    this.admin.importJob(id).subscribe({
      next: (j) => this.track(j),
      error: (err) => {
        this.running.set(null);
        this.notify.error(err);
      },
    });
  }
}
