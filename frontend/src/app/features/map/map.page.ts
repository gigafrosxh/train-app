import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import maplibregl, { LngLatBoundsLike, Map as MlMap, Marker } from 'maplibre-gl';
import { firstValueFrom } from 'rxjs';
import { MapApi, RailApi } from '../../core/api/api';
import { Format } from '../../core/i18n/format.service';
import { I18n } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MapTrain, Station } from '../../core/models/api.models';
import { PreferencesService } from '../../core/prefs/preferences.service';
import { SettingsStore } from '../../core/prefs/settings.store';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { Notify } from '../../core/ui/notify.service';
import { DelayView } from '../../shared/times';
import { Bbox, bboxOf, findCountry, loadCountries } from './country-geo';
import { applyPalette, buildStyle, DARK, LIGHT } from './map-style';
import { exaggerationFor, registerRaisedTerrain, setRaisedCountry } from './raised-terrain';
import { TrainFeed } from './train-feed';

interface TrainView {
  data: MapTrain;
  marker: Marker;
  el: HTMLElement;
  from: [number, number];
  to: [number, number];
  start: number;
  dur: number;
}

/** Wichtige Bahnhöfe: früher beschriftet, eigener Punktstil. */
const MAJOR =
  /(\bHbf\b|Hauptbahnhof|^Flughafen Wien|^Wien (Westbahnhof|Meidling|Mitte)|^Bregenz$|^Kufstein$|^Feldkirch$|^Bischofshofen$|^Schwarzach-St\. ?Veit$|^Wörgl|^Landeck)/;

@Component({
  selector: 'app-map',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe, DelayView],
  templateUrl: './map.page.html',
  styleUrl: './map.page.scss',
  encapsulation: ViewEncapsulation.None,
})
export class MapPage implements AfterViewInit, OnDestroy {
  private readonly mapApi = inject(MapApi);
  private readonly rail = inject(RailApi);
  private readonly realtime = inject(RealtimeService);
  private readonly settings = inject(SettingsStore);
  private readonly prefs = inject(PreferencesService);
  private readonly notify = inject(Notify);
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18n);
  protected readonly f = inject(Format);

  readonly trip = input<string>();
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('map');

  private map: MlMap | null = null;
  private feed: TrainFeed | null = null;
  private views = new Map<string, TrainView>();
  private stationMarkers: { marker: Marker; el: HTMLElement; major: boolean }[] = [];
  private frame = 0;
  private labelFrame = 0;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private countryBbox: Bbox | null = null;
  private loadedCountry: string | null = null;
  private media = matchMedia('(prefers-color-scheme: dark)');

  protected readonly ready = signal(false);
  protected readonly count = signal(0);
  protected readonly live = signal(false);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly railStatus = signal<string | null>(null);
  protected readonly attribution = signal('');
  protected readonly threeD = signal(true);
  protected readonly selected = signal<MapTrain | null>(null);
  protected readonly follow = signal(false);
  protected readonly legendOpen = signal(true);
  protected readonly query = signal('');
  protected readonly trainList = signal<MapTrain[]>([]);
  protected readonly matches = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return [];
    return this.trainList()
      .filter((t) => t.trainNumber.toLowerCase().includes(q) || t.lineName.toLowerCase().includes(q))
      .slice(0, 6);
  });
  protected readonly countryName = computed(() => {
    const c = this.settings.country();
    return c ? c.names[this.i18n.lang()] : this.settings.activeCountry();
  });

  private readonly dark = signal(this.isDark());

  constructor() {
    this.media.addEventListener('change', this.onScheme);
    effect(() => {
      this.prefs.theme();
      untracked(() => this.dark.set(this.isDark()));
    });
    effect(() => {
      const dark = this.dark();
      if (this.map?.isStyleLoaded()) applyPalette(this.map, dark ? DARK : LIGHT);
    });
    // Land wechseln (Admin-Einstellung)
    effect(() => {
      const code = this.settings.activeCountry();
      if (this.ready() && code !== this.loadedCountry) untracked(() => this.loadCountry(code));
    });
  }

  // Nach Reconnect: neues Abo + Snapshot
  private readonly resyncSub = this.realtime.resync$.pipe(takeUntilDestroyed()).subscribe(() => this.subscribeViewport());

  private onScheme = () => this.dark.set(this.isDark());

  private isDark() {
    const t = document.documentElement.dataset['theme'];
    return t ? t === 'dark' : this.media.matches;
  }

  ngAfterViewInit() {
    registerRaisedTerrain();
    // MapLibre außerhalb von Angular laufen lassen – Updates erfolgen über Signale.
    this.zone.runOutsideAngular(() => this.init());
  }

  private init() {
    const palette = this.dark() ? DARK : LIGHT;
    const map = new maplibregl.Map({
      container: this.host().nativeElement,
      style: buildStyle(palette),
      center: [13.3, 47.6],
      zoom: 6,
      pitch: 45,
      maxPitch: 70,
      minZoom: 3.5,
      maxZoom: 15,
      attributionControl: false,
      dragRotate: true,
    });
    this.map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', async () => {

      try {
        const all = await loadCountries();
        (map.getSource('countries') as maplibregl.GeoJSONSource).setData(all);
      } catch {
        // ohne Ländergrenzen geht es trotzdem
      }
      this.zone.run(() => this.ready.set(true));
      void this.loadCountry(this.settings.activeCountry());
    });

    // Überhöhung erst nach dem Zoomen anpassen – setTerrain während einer Kamerafahrt stört die Animation.
    map.on('zoomend', () => this.updateTerrain());
    map.on('moveend', () => this.onMoveEnd());
    map.on('move', () => this.scheduleLabels());
    map.on('dragstart', () => this.zone.run(() => this.follow.set(false)));
    map.on('click', (e) => {
      // Klick ins Leere schließt die Zugkarte
      if (!(e.originalEvent.target as HTMLElement).closest('.tm')) this.zone.run(() => this.select(null));
    });
  }

  private async loadCountry(code: string) {
    const map = this.map;
    if (!map) return;
    this.loadedCountry = code;
    this.loading.set(true);
    this.failed.set(false);

    const all = await loadCountries().catch(() => null);
    const shape = all ? findCountry(all, code) : null;
    if (shape) {
      setRaisedCountry(code, shape);
      (map.getSource('selected') as maplibregl.GeoJSONSource).setData(shape);
      this.countryBbox = bboxOf(shape);
      // DEM-Quelle für das neue Land
      this.ensureDem(code);
    }
    // Sofort auf das Land zoomen, Terrain erst danach passend zur Zoomstufe setzen.
    this.fit(false);
    // Terrain erst setzen, wenn die neue Höhenquelle bereitsteht – sofort gesetzt bleibt die Karte schwarz.
    if (shape) {
      map.once('idle', () => {
        if (this.threeD() && this.loadedCountry === code) {
          map.setTerrain({ source: 'raised', exaggeration: this.exaggeration() });
          this.scheduleLabels();
        }
      });
    }

    await Promise.all([this.loadRailways(code).catch(() => {}), this.loadStations(code).catch(() => {})]);
    if (this.trip()) void this.focusTrip(this.trip()!);
    this.startFeed();
  }

  /** Höhenquellen für ein Land (neu) anlegen. Eigene Quelle für die Schattierung. */
  private ensureDem(code: string) {
    const map = this.map!;
    const palette = this.dark() ? DARK : LIGHT;
    if (map.getTerrain()) map.setTerrain(null);
    if (map.getLayer('hillshade')) map.removeLayer('hillshade');
    for (const id of ['raised', 'raised-shade']) {
      if (map.getSource(id)) map.removeSource(id);
      map.addSource(id, {
        type: 'raster-dem',
        tiles: [`raised://${code}/{z}/{x}/{y}`],
        tileSize: 256,
        maxzoom: 9,
        encoding: 'mapbox',
      });
    }
    map.addLayer(
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'raised-shade',
        paint: {
          'hillshade-shadow-color': palette.shadow,
          'hillshade-highlight-color': palette.highlight,
          'hillshade-accent-color': palette.shadow,
          'hillshade-exaggeration': 0.6,
          'hillshade-illumination-direction': 315,
        },
      },
      'rail-casing',
    );
  }

  private exaggeration() {
    const map = this.map!;
    return exaggerationFor(map.getZoom(), map.getCenter().lat, 22);
  }

  private updateTerrain() {
    const current = this.map?.getTerrain();
    if (!this.map || !this.threeD() || !current) return;
    const next = this.exaggeration();
    if (Math.abs(next - (current.exaggeration ?? 1)) / next > 0.15) this.map.setTerrain({ source: 'raised', exaggeration: next });
    this.scheduleLabels();
  }

  private async loadRailways(code: string) {
    const map = this.map!;
    const bbox = this.countryBbox;
    try {
      const fc = await firstValueFrom(
        this.mapApi.railways({ country: code, bbox: bbox?.map((v) => v.toFixed(4)).join(','), zoom: Math.round(map.getZoom()) }),
      );
      (map.getSource('railways') as maplibregl.GeoJSONSource).setData(fc);
      this.zone.run(() => {
        this.railStatus.set(fc.metadata?.dataStatus ?? null);
        this.attribution.set(fc.metadata?.attribution ?? '');
      });
    } catch (err) {
      this.zone.run(() => this.notify.error(err));
    }
  }

  private async loadStations(code: string) {
    const map = this.map!;
    const items: Station[] = [];
    try {
      for (let page = 1; page < 30; page++) {
        const p = await firstValueFrom(this.rail.stations({ country: code, page, pageSize: 100 }));
        items.push(...p.items);
        if (items.length >= p.total || !p.items.length) break;
      }
    } catch {
      return;
    }
    (map.getSource('stations') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: items.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: s.coordinates },
        properties: { id: s.id, name: s.name, major: MAJOR.test(s.name) },
      })),
    });
    this.stationMarkers.forEach((s) => s.marker.remove());
    this.stationMarkers = items.map((s) => {
      const el = document.createElement('div');
      const major = MAJOR.test(s.name);
      el.className = 'st-label' + (major ? ' major' : '');
      el.textContent = s.name;
      const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [8, 0] }).setLngLat(s.coordinates).addTo(map);
      return { marker, el, major };
    });
    this.scheduleLabels();
  }

  private fit(animate: boolean) {
    if (!this.map || !this.countryBbox) return;
    const [w, s, e, n] = this.countryBbox;
    const width = this.map.getContainer().clientWidth;
    const mobile = width < 700;
    // Breite Fenster: Panel links freihalten. Sonst liegt das Land unter dem Panel.
    const padding = mobile
      ? { top: 170, bottom: 30, left: 16, right: 16 }
      : width >= 1100
        ? { top: 50, bottom: 50, left: 330, right: 60 }
        : { top: 200, bottom: 30, left: 50, right: 60 };
    this.map.fitBounds([[w, s], [e, n]] as LngLatBoundsLike, {
      padding,
      pitch: this.threeD() ? 45 : 0,
      duration: animate ? 900 : 0,
    });
  }

  // ---------------------------------------------------------- Züge

  private startFeed() {
    this.feed?.stop();
    this.feed = new TrainFeed(this.mapApi, this.realtime, {
      reset: (trains) => this.resetTrains(trains),
      update: (t) => this.upsert(t, true),
      remove: (id) => this.removeTrain(id),
      status: (s) =>
        this.zone.run(() => {
          this.live.set(s.live);
          this.loading.set(s.loading);
          if (s.error) {
            this.failed.set(true);
            this.notify.error(s.error);
          }
        }),
    });
    this.subscribeViewport();
  }

  private viewportBbox(): Bbox {
    const b = this.map!.getBounds();
    let box: Bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const c = this.countryBbox;
    if (c) {
      box = [Math.max(box[0], c[0] - 0.5), Math.max(box[1], c[1] - 0.5), Math.min(box[2], c[2] + 0.5), Math.min(box[3], c[3] + 0.5)];
      if (box[0] >= box[2] || box[1] >= box[3]) box = c;
    }
    return box;
  }

  private subscribeViewport() {
    if (!this.feed || !this.map) return;
    void this.feed.start(this.settings.activeCountry(), this.viewportBbox());
  }

  private onMoveEnd() {
    this.scheduleLabels();
    // Entprellt: erst nach Ende der Bewegung neues Abo (Vertrag: ca. 400 ms)
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = setTimeout(() => this.subscribeViewport(), 400);
  }

  private resetTrains(trains: MapTrain[]) {
    const ids = new Set(trains.map((t) => t.tripId));
    for (const id of [...this.views.keys()]) if (!ids.has(id)) this.removeTrain(id);
    trains.forEach((t) => this.upsert(t, false));
    this.syncList();
  }

  private upsert(t: MapTrain, animate: boolean) {
    if (!this.map || !t.coordinates) return;
    const to = t.coordinates as [number, number];
    let v = this.views.get(t.tripId);
    if (!v) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tm';
      el.innerHTML = '<span class="tm-dot"><span class="tm-arrow"></span></span><span class="tm-label"></span>';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.zone.run(() => this.select(this.views.get(t.tripId)?.data ?? null));
      });
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(to).addTo(this.map);
      v = { data: t, marker, el, from: to, to, start: 0, dur: 0 };
      this.views.set(t.tripId, v);
    } else {
      const cur = v.marker.getLngLat();
      v.from = [cur.lng, cur.lat];
      v.to = to;
      v.start = performance.now();
      v.dur = animate ? 3800 : 0;
      v.data = t;
      if (!animate) v.marker.setLngLat(to);
      this.animate();
    }
    this.decorate(v);
    if (this.selected()?.tripId === t.tripId) this.zone.run(() => this.selected.set(t));
    if (animate) this.syncListSoon();
  }

  private decorate(v: TrainView) {
    const t = v.data;
    const min = Math.round(t.delaySeconds / 60);
    // Nur eigene Klassen umschalten – MapLibre braucht seine Marker-Klassen für die Positionierung.
    const c = v.el.classList;
    c.toggle('late', min >= 5);
    c.toggle('slight', min >= 1 && min < 5);
    c.toggle('ok', min < 1);
    c.toggle('est', t.positionType === 'ESTIMATED');
    c.toggle('stale', t.isStale);
    c.toggle('on', this.selected()?.tripId === t.tripId);
    (v.el.querySelector('.tm-label') as HTMLElement).textContent = t.trainNumber;
    const arrow = v.el.querySelector('.tm-arrow') as HTMLElement;
    arrow.style.display = t.bearing === null ? 'none' : '';
    arrow.style.transform = `rotate(${(t.bearing ?? 0) - (this.map?.getBearing() ?? 0)}deg)`;
    v.el.setAttribute('aria-label', `${t.trainNumber} ${t.lineName}`);
  }

  private removeTrain(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    v.marker.remove();
    this.views.delete(id);
    if (this.selected()?.tripId === id) this.zone.run(() => this.select(null));
    this.syncListSoon();
  }

  private animate() {
    if (this.frame) return;
    const step = (now: number) => {
      let running = false;
      for (const v of this.views.values()) {
        if (!v.dur) continue;
        const k = Math.min(1, (now - v.start) / v.dur);
        v.marker.setLngLat([v.from[0] + (v.to[0] - v.from[0]) * k, v.from[1] + (v.to[1] - v.from[1]) * k]);
        if (k < 1) running = true;
        else v.dur = 0;
      }
      const sel = this.selected();
      if (this.follow() && sel) {
        const v = this.views.get(sel.tripId);
        if (v) this.map?.setCenter(v.marker.getLngLat());
      }
      this.frame = running ? requestAnimationFrame(step) : 0;
    };
    this.frame = requestAnimationFrame(step);
  }

  private listTimer: ReturnType<typeof setTimeout> | null = null;
  private syncListSoon() {
    if (this.listTimer) return;
    this.listTimer = setTimeout(() => {
      this.listTimer = null;
      this.syncList();
    }, 500);
  }

  private syncList() {
    const list = [...this.views.values()].map((v) => v.data);
    this.zone.run(() => {
      this.trainList.set(list);
      this.count.set(list.length);
    });
  }

  // ---------------------------------------------------------- Beschriftung

  private scheduleLabels() {
    if (this.labelFrame) return;
    this.labelFrame = requestAnimationFrame(() => {
      this.labelFrame = 0;
      this.layoutLabels();
    });
  }

  /** Beschriftungen ohne Überlappung: wichtige zuerst, Rest ausblenden. */
  private layoutLabels() {
    const map = this.map;
    if (!map) return;
    const z = map.getZoom();
    const placed: DOMRect[] = [];
    const fits = (r: DOMRect) =>
      !placed.some((p) => r.left < p.right + 4 && r.right > p.left - 4 && r.top < p.bottom + 2 && r.bottom > p.top - 2);

    // Zugnummern ab Zoom 8 – zuerst, damit Züge lesbar bleiben
    const showTrains = z >= 8;
    for (const v of this.views.values()) {
      const label = v.el.querySelector('.tm-label') as HTMLElement;
      v.el.classList.toggle('labelled', false);
      if (!showTrains) continue;
      v.el.classList.add('labelled');
      const r = label.getBoundingClientRect();
      if (fits(r)) placed.push(r);
      else v.el.classList.remove('labelled');
    }
    // Trains selbst als Hindernis
    for (const v of this.views.values()) placed.push((v.el.querySelector('.tm-dot') as HTMLElement).getBoundingClientRect());

    const order = [...this.stationMarkers].sort((a, b) => Number(b.major) - Number(a.major));
    for (const s of order) {
      const visible = s.major ? z >= 5 : z >= 8;
      s.el.classList.remove('hidden');
      if (!visible) {
        s.el.classList.add('hidden');
        continue;
      }
      const r = s.el.getBoundingClientRect();
      if (fits(r)) placed.push(r);
      else s.el.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------- Aktionen

  protected select(t: MapTrain | null) {
    const prev = this.selected();
    this.selected.set(t);
    if (!t) this.follow.set(false);
    for (const id of [prev?.tripId, t?.tripId]) {
      const v = id ? this.views.get(id) : null;
      if (v) this.decorate(v);
    }
    const src = this.map?.getSource('route') as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: [] });
    if (t) {
      this.mapApi.shape(t.tripId).subscribe({
        next: (shape) => {
          if (this.selected()?.tripId === t.tripId) src?.setData(shape);
        },
        error: () => {
          // kein verlässlicher Verlauf – nichts zeichnen
        },
      });
    }
  }

  protected pickMatch(t: MapTrain) {
    this.query.set('');
    this.select(t);
    if (t.coordinates) this.map?.flyTo({ center: t.coordinates, zoom: Math.max(this.map.getZoom(), 9.5), duration: 1200 });
  }

  private async focusTrip(id: string) {
    try {
      const pos = await firstValueFrom(this.mapApi.position(id));
      if (pos.coordinates) {
        this.zone.run(() => {
          this.select(pos);
          this.follow.set(true);
        });
        this.map?.flyTo({ center: pos.coordinates, zoom: 10, pitch: this.threeD() ? 50 : 0, duration: 1400 });
      } else {
        this.zone.run(() => this.notify.info('map.noPosition'));
        this.fit(true);
      }
    } catch (err) {
      this.zone.run(() => this.notify.error(err));
    }
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  protected toggle3d() {
    const on = !this.threeD();
    this.threeD.set(on);
    const map = this.map;
    if (!map) return;
    if (on) {
      map.setTerrain({ source: 'raised', exaggeration: this.exaggeration() });
      map.easeTo({ pitch: 45, duration: 600 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }

  protected recenter() {
    this.follow.set(false);
    this.fit(true);
  }

  protected toggleFollow() {
    const t = this.selected();
    this.follow.set(!this.follow());
    if (this.follow() && t?.coordinates) this.map?.easeTo({ center: t.coordinates, zoom: Math.max(this.map.getZoom(), 9.5), duration: 800 });
  }

  protected positionLabel(t: MapTrain): string {
    if (t.isStale) return this.i18n.t('map.posStale');
    if (t.positionType === 'REALTIME') return this.i18n.t('map.posLive');
    return this.i18n.t('map.posEstimated');
  }

  protected positionTime(t: MapTrain): string {
    const at = t.observedAt ?? t.calculatedAt;
    return at ? this.f.time(at) : '';
  }

  ngOnDestroy() {
    this.media.removeEventListener('change', this.onScheme);
    this.feed?.stop();
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.labelFrame) cancelAnimationFrame(this.labelFrame);
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.map?.remove();
  }
}
