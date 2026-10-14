import { AfterViewInit, Component, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import maplibregl, { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { firstValueFrom } from 'rxjs';
import { AdminApi, MapApi } from '../../core/api/api';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LngLat, Track, TrackUsage } from '../../core/models/api.models';
import { SettingsStore } from '../../core/prefs/settings.store';
import { Notify } from '../../core/ui/notify.service';
import { bboxOf, findCountry, loadCountries } from '../map/country-geo';
import { CrudDialogData } from './crud.dialog';

const USAGES: TrackUsage[] = ['main', 'branch', 'industrial', 'military', 'tourism', 'test', 'unknown'];

/** Strecke auf einer kleinen Karte zeichnen: Klick setzt Punkte. */
@Component({
  selector: 'app-track-dialog',
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ (track ? 'setup.edit' : 'setup.create') | t: { what: ('setup.one.tracks' | t) } }}</h2>
    <mat-dialog-content>
      <div class="form-grid">
        <mat-form-field>
          <mat-label>{{ 'setup.f.name' | t }}</mat-label>
          <input matInput [(ngModel)]="name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'setup.f.usage' | t }}</mat-label>
          <mat-select [(ngModel)]="usage">
            @for (u of usages; track u) {
              <mat-option [value]="u">{{ 'usage.' + u | t }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ 'setup.f.electrified' | t }}</mat-label>
          <mat-select [(ngModel)]="electrified">
            <mat-option [value]="true">{{ 'common.yes' | t }}</mat-option>
            <mat-option [value]="false">{{ 'common.no' | t }}</mat-option>
            <mat-option [value]="null">{{ 'common.unknown' | t }}</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      <div class="bar">
        <span class="muted small">{{ 'setup.drawHint' | t }} · {{ 'setup.f.points' | t }}: {{ points().length }}</span>
        <span class="spacer"></span>
        <button mat-button (click)="undo()" [disabled]="!points().length"><mat-icon>undo</mat-icon>{{ 'setup.undo' | t }}</button>
        <button mat-button (click)="clear()" [disabled]="!points().length"><mat-icon>delete_sweep</mat-icon>{{ 'common.clear' | t }}</button>
      </div>
      <div #mapEl class="draw-map"></div>
      @if (error()) {
        <p class="error" role="alert"><mat-icon>error</mat-icon>{{ error() }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button (click)="save()" [disabled]="busy()">{{ 'common.save' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .bar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    .draw-map { height: 380px; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--c-border); margin-top: 6px; cursor: crosshair; }
    .error { display: flex; gap: 8px; margin-top: 12px; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-bad-soft); color: var(--c-bad); }
    @media (max-width: 600px) { .draw-map { height: 300px; } }
  `,
})
export class TrackDialog implements AfterViewInit, OnDestroy {
  private readonly data = inject<CrudDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<TrackDialog>);
  private readonly api = inject(AdminApi);
  private readonly mapApi = inject(MapApi);
  private readonly settings = inject(SettingsStore);
  private readonly notify = inject(Notify);
  private readonly i18n = inject(I18n);
  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>('mapEl');

  protected readonly track = this.data.row as unknown as Track | null;
  protected readonly usages = USAGES;
  protected name = this.track?.name ?? '';
  protected usage: TrackUsage = this.track?.usage ?? 'main';
  protected electrified: boolean | null = this.track?.electrified ?? true;
  protected readonly points = signal<LngLat[]>((this.track?.geometry.coordinates as LngLat[]) ?? []);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private map: MlMap | null = null;

  async ngAfterViewInit() {
    const dark = document.documentElement.dataset['theme'] === 'dark' || (!document.documentElement.dataset['theme'] && matchMedia('(prefers-color-scheme: dark)').matches);
    const map = new maplibregl.Map({
      container: this.mapEl().nativeElement,
      style: {
        version: 8,
        sources: {
          countries: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          rails: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          draft: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': dark ? '#070c17' : '#dfe8f5' } },
          { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': dark ? '#16213a' : '#ffffff' } },
          { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': dark ? '#2b3b5e' : '#c9d3e3' } },
          { id: 'rails', type: 'line', source: 'rails', paint: { 'line-color': '#6f93db', 'line-width': 2 } },
          { id: 'draft-line', type: 'line', source: 'draft', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#f59e0b', 'line-width': 4 } },
          { id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', '$type', 'Point'], paint: { 'circle-color': '#fff', 'circle-stroke-color': '#f59e0b', 'circle-stroke-width': 2, 'circle-radius': 4 } },
        ],
      },
      center: [13.3, 47.6],
      zoom: 5.5,
      attributionControl: false,
    });
    this.map = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('click', (e) => {
      this.points.update((p) => [...p, [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))]]);
      this.draw();
    });
    map.on('load', async () => {
      const countries = await loadCountries();
      (map.getSource('countries') as GeoJSONSource).setData(countries);
      const shape = findCountry(countries, this.settings.activeCountry());
      if (this.points().length > 1) {
        const xs = this.points().map((p) => p[0]);
        const ys = this.points().map((p) => p[1]);
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 40, duration: 0 });
      } else if (shape) {
        const [w, s, e, n] = bboxOf(shape);
        map.fitBounds([[w, s], [e, n]], { padding: 20, duration: 0 });
      }
      try {
        const rails = await firstValueFrom(this.mapApi.railways({ country: this.settings.activeCountry() }));
        (map.getSource('rails') as GeoJSONSource).setData(rails);
      } catch {
        // ohne Hintergrundnetz weiterzeichnen
      }
      this.draw();
    });
  }

  private draw() {
    const src = this.map?.getSource('draft') as GeoJSONSource | undefined;
    const pts = this.points();
    src?.setData({
      type: 'FeatureCollection',
      features: [
        ...(pts.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: pts } }] : []),
        ...pts.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: p } })),
      ],
    });
  }

  protected undo() {
    this.points.update((p) => p.slice(0, -1));
    this.draw();
  }

  protected clear() {
    this.points.set([]);
    this.draw();
  }

  protected async save() {
    if (this.points().length < 2) {
      this.error.set(this.i18n.t('setup.twoPoints'));
      return;
    }
    const body = {
      name: this.name.trim() || null,
      usage: this.usage,
      electrified: this.electrified,
      geometry: { type: 'LineString', coordinates: this.points() },
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.track) await firstValueFrom(this.api.update('tracks', this.track.id, { ...body, version: this.track.version }));
      else await firstValueFrom(this.api.create('tracks', { ...body, country: this.settings.activeCountry() }));
      this.ref.close(true);
    } catch (err) {
      this.error.set(this.notify.messageFor(err));
    } finally {
      this.busy.set(false);
    }
  }

  ngOnDestroy() {
    this.map?.remove();
  }
}
