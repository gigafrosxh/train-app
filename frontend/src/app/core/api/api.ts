import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { Feature, LineString } from 'geojson';
import { environment } from '../../../environments/environment';
import {
  AdminUser,
  BoardEntry,
  Company,
  Connection,
  Country,
  CreateTicket,
  AuditEntry,
  Dashboard,
  Disruption,
  ImportJob,
  Line,
  MapTrain,
  MapTrainsPage,
  Page,
  Preferences,
  RailwayCollection,
  Route,
  Schedule,
  Settings,
  NearbyStation,
  ServerStatus,
  Station,
  StationDetail,
  StationRef,
  StopPatch,
  TicketSummary,
  Track,
  Train,
  TripDetail,
  TripPatch,
  TripStop,
  TripSummary,
  User,
  WorkerAssignment,
} from '../models/api.models';

const API = environment.apiBase;
type Query = Record<string, string | number | boolean | null | undefined>;

export function toParams(query?: Query): HttpParams {
  let params = new HttpParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== null && v !== undefined && v !== '') params = params.set(k, String(v));
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly http = inject(HttpClient);
  me() {
    return this.http.get<User>(`${API}/me`);
  }
  update(body: { displayName?: string; preferences?: Partial<Preferences> }) {
    return this.http.patch<User>(`${API}/me`, body);
  }
  changePassword(currentPassword: string, newPassword: string) {
    return this.http.patch<void>(`${API}/me/password`, { currentPassword, newPassword });
  }
  dashboard() {
    return this.http.get<Dashboard>(`${API}/me/dashboard`);
  }
  markViewed(tripId: string) {
    return this.http.post<void>(`${API}/me/recent-trips`, { tripId, kind: 'VIEWED' });
  }
  favoriteStations() {
    return this.http.get<StationRef[]>(`${API}/me/favorite-stations`);
  }
  setFavoriteStations(stationIds: string[]) {
    return this.http.put<StationRef[]>(`${API}/me/favorite-stations`, { stationIds });
  }
}

@Injectable({ providedIn: 'root' })
export class TicketsApi {
  private readonly http = inject(HttpClient);
  list(query?: Query) {
    return this.http.get<Page<TicketSummary>>(`${API}/me/tickets`, { params: toParams(query) });
  }
  get(id: string) {
    return this.http.get<TicketSummary>(`${API}/me/tickets/${id}`);
  }
  create(body: CreateTicket) {
    return this.http.post<TicketSummary>(`${API}/me/tickets`, body);
  }
  remove(id: string) {
    return this.http.delete<void>(`${API}/me/tickets/${id}`);
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsApi {
  private readonly http = inject(HttpClient);
  settings() {
    return this.http.get<Settings>(`${API}/settings`);
  }
  countries() {
    return this.http.get<Page<Country>>(`${API}/countries`, { params: toParams({ pageSize: 100 }) });
  }
  setActiveCountry(activeCountry: string) {
    return this.http.patch<Settings>(`${API}/admin/settings`, { activeCountry });
  }
}

@Injectable({ providedIn: 'root' })
export class RailApi {
  private readonly http = inject(HttpClient);
  stations(query?: Query) {
    return this.http.get<Page<Station>>(`${API}/stations`, { params: toParams(query) });
  }
  station(id: string) {
    return this.http.get<StationDetail>(`${API}/stations/${id}`);
  }
  nearby(lng: number, lat: number, pageSize = 5) {
    return this.http.get<Page<NearbyStation>>(`${API}/stations/nearby`, {
      params: toParams({ lng, lat, pageSize }),
    });
  }
  disruptions(query?: Query) {
    return this.http.get<Page<Disruption>>(`${API}/disruptions`, { params: toParams(query) });
  }
  status() {
    return this.http.get<ServerStatus>(`${API}/health/status`);
  }
  departures(stationId: string, query?: Query) {
    return this.http.get<Page<BoardEntry>>(`${API}/stations/${stationId}/departures`, {
      params: toParams(query),
    });
  }
  arrivals(stationId: string, query?: Query) {
    return this.http.get<Page<BoardEntry>>(`${API}/stations/${stationId}/arrivals`, {
      params: toParams(query),
    });
  }
  lines(query?: Query) {
    return this.http.get<Page<Line>>(`${API}/lines`, { params: toParams(query) });
  }
  route(id: string) {
    return this.http.get<Route>(`${API}/routes/${id}`);
  }
  trips(query?: Query) {
    return this.http.get<Page<TripSummary>>(`${API}/trips`, { params: toParams(query) });
  }
  trip(id: string) {
    return this.http.get<TripDetail>(`${API}/trips/${id}`);
  }
  connections(query: Query) {
    return this.http.get<Page<Connection>>(`${API}/connections`, { params: toParams(query) });
  }
}

@Injectable({ providedIn: 'root' })
export class MapApi {
  private readonly http = inject(HttpClient);
  railways(query: Query) {
    return this.http.get<RailwayCollection>(`${API}/map/railways`, { params: toParams(query) });
  }
  trains(query: Query) {
    return this.http.get<MapTrainsPage>(`${API}/map/trains`, { params: toParams(query) });
  }
  position(tripId: string) {
    return this.http.get<MapTrain>(`${API}/trips/${tripId}/position`);
  }
  shape(tripId: string) {
    return this.http.get<Feature<LineString>>(`${API}/trips/${tripId}/shape`);
  }
}

@Injectable({ providedIn: 'root' })
export class OperationsApi {
  private readonly http = inject(HttpClient);
  trips(query?: Query) {
    return this.http.get<Page<TripSummary>>(`${API}/operations/trips`, { params: toParams(query) });
  }
  patchTrip(id: string, body: TripPatch) {
    return this.http.patch<TripDetail>(`${API}/operations/trips/${id}`, body);
  }
  patchStop(tripId: string, stopId: string, body: StopPatch) {
    return this.http.patch<TripStop>(`${API}/operations/trips/${tripId}/stops/${stopId}`, body);
  }
  assignments() {
    return this.http.get<Page<WorkerAssignment>>(`${API}/operations/assignments`, {
      params: toParams({ pageSize: 100 }),
    });
  }
}

export type AdminResource =
  | 'companies'
  | 'stations'
  | 'trains'
  | 'lines'
  | 'routes'
  | 'tracks'
  | 'schedules'
  | 'trips'
  | 'users'
  | 'worker-assignments'
  | 'disruptions';

export interface AdminTypes {
  companies: Company;
  stations: Station;
  trains: Train;
  lines: Line;
  routes: Route;
  tracks: Track;
  schedules: Schedule;
  trips: TripDetail;
  users: AdminUser;
  'worker-assignments': WorkerAssignment;
  disruptions: Disruption;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  audit(query?: Query) {
    return this.http.get<Page<AuditEntry>>(`${API}/admin/audit`, { params: toParams(query) });
  }

  list<R extends AdminResource>(resource: R, query?: Query): Observable<Page<AdminTypes[R]>> {
    return this.http.get<Page<AdminTypes[R]>>(`${API}/admin/${resource}`, {
      params: toParams(query),
    });
  }
  get<R extends AdminResource>(resource: R, id: string): Observable<AdminTypes[R]> {
    return this.http.get<AdminTypes[R]>(`${API}/admin/${resource}/${id}`);
  }
  create<R extends AdminResource>(resource: R, body: object): Observable<AdminTypes[R]> {
    return this.http.post<AdminTypes[R]>(`${API}/admin/${resource}`, body);
  }
  update<R extends AdminResource>(
    resource: R,
    id: string,
    body: object & { version: number },
  ): Observable<AdminTypes[R]> {
    return this.http.patch<AdminTypes[R]>(`${API}/admin/${resource}/${id}`, body);
  }
  remove(resource: AdminResource, id: string, version: number) {
    return this.http.delete<void>(`${API}/admin/${resource}/${id}`, {
      params: toParams({ version }),
    });
  }
  startImport(country: string, kind: ImportJob['kind']) {
    return this.http.post<ImportJob>(`${API}/admin/imports`, { country, kind });
  }
  importJob(id: string) {
    return this.http.get<ImportJob>(`${API}/admin/imports/${id}`);
  }
}
