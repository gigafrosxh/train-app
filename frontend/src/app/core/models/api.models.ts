import type { FeatureCollection, LineString, MultiLineString } from 'geojson';

// Typen nach docs/api-contract.md. Sobald backend/openapi.json existiert,
// werden diese Typen durch generierte ersetzt.

export type Role = 'USER' | 'WORKER' | 'ADMIN';
export type Language = 'de' | 'en';
export type ThemeMode = 'light' | 'dark' | 'system';
export type FontScale = 'sm' | 'md' | 'lg';
export type LngLat = [number, number];

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiFieldError {
  field: string;
  code: string;
  message: string;
}

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  fieldErrors?: ApiFieldError[];
  requestId?: string;
  /** Je Fehlercode dokumentiert, z. B. IMPORT_ALREADY_RUNNING → { jobId } */
  details?: Record<string, unknown>;
}

// ---------- Konto ----------

export interface Preferences {
  language: Language;
  theme: ThemeMode;
  fontScale: FontScale;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  preferences: Preferences;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

// ---------- Länder & Einstellungen ----------

export type DataStatus = 'NOT_IMPORTED' | 'IMPORTING' | 'READY' | 'FAILED';

export interface Country {
  code: string;
  names: { de: string; en: string };
  enabled: boolean;
  dataStatus: DataStatus;
}

export interface Settings {
  activeCountry: string;
  tripGenerationDays: number;
  searchWindow: { from: string; to: string };
}

// ---------- Stammdaten ----------

export interface StationRef {
  id: string;
  name: string;
  code: string | null;
  /** Zeitzone des Halts. Fehlt bei lokal gemerkten Bahnhöfen aus älteren Versionen. */
  timeZone?: string;
}

export interface Station extends StationRef {
  country: string;
  coordinates: LngLat;
  timeZone: string;
  aliases?: string[];
  version: number;
}

export interface LineRef {
  id: string;
  name: string;
  color: string | null;
}

export interface StationDetail extends Station {
  lines: LineRef[];
}

export interface NearbyStation extends Station {
  distanceMeters: number;
}

export type Severity = 'INFO' | 'WARNING' | 'SEVERE';

export interface Disruption {
  id: string;
  country: string;
  severity: Severity;
  reasonCode: DelayReason | null;
  title: string;
  text: string;
  validFrom: string;
  validUntil: string | null;
  stationIds: string[];
  lineIds: string[];
  createdAt: string;
  version: number;
}

/** LIVE = echte Positionen, STALE = Positionsgeber verstummt, SCHEDULE_ONLY = nur Fahrplan. */
export type RealtimeState = 'LIVE' | 'STALE' | 'SCHEDULE_ONLY';

export interface ServerStatus {
  status: 'ok';
  realtime: RealtimeState;
  lastPositionAt: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityId: string | null;
  details: Record<string, unknown>;
}

export interface Company {
  id: string;
  name: string;
  code: string;
  country: string;
  version: number;
}

export type TrainType = 'REGIONAL' | 'INTERCITY' | 'HIGH_SPEED' | 'NIGHT' | 'OTHER';

export interface Train {
  id: string;
  companyId: string;
  trainNumber: string;
  name: string | null;
  type: TrainType;
  active: boolean;
  version: number;
}

export interface Line {
  id: string;
  companyId: string;
  name: string;
  code: string;
  color: string | null;
  version: number;
}

export interface RouteStop {
  id: string;
  sequence: number;
  station: StationRef;
}

export interface Route {
  id: string;
  lineId: string;
  name: string;
  direction: string;
  stops: RouteStop[];
  trackIds?: string[];
  version: number;
}

export type TrackUsage =
  | 'main'
  | 'branch'
  | 'industrial'
  | 'military'
  | 'tourism'
  | 'test'
  | 'unknown';

export interface Track {
  id: string;
  country: string;
  name: string | null;
  usage: TrackUsage;
  electrified: boolean | null;
  geometry: LineString;
  version: number;
}

export interface ScheduleStop {
  routeStopId: string;
  arrivalOffsetSeconds: number | null;
  departureOffsetSeconds: number | null;
}

export interface Schedule {
  id: string;
  routeId: string;
  trainId: string;
  timeZone: string;
  validFrom: string;
  validUntil: string;
  weekdays: number[];
  stops: ScheduleStop[];
  exceptions: { date: string; runs: boolean }[];
  dstDisambiguation?: DstDisambiguation;
  version: number;
}

export type DstDisambiguation = 'REJECT' | 'EARLIER' | 'LATER';

// ---------- Fahrten ----------

export type TripStatus = 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';
export type DelayReason = 'TECHNICAL' | 'WEATHER' | 'STAFF' | 'CONSTRUCTION' | 'OTHER';
export const DELAY_REASONS: DelayReason[] = [
  'TECHNICAL',
  'WEATHER',
  'STAFF',
  'CONSTRUCTION',
  'OTHER',
];

export interface TripSummary {
  id: string;
  trainId: string;
  trainNumber: string;
  lineId: string;
  lineName: string;
  routeId: string;
  companyId: string;
  lineColor: string | null;
  companyName: string;
  serviceDate: string;
  origin: StationRef;
  destination: StationRef;
  scheduledDeparture: string;
  scheduledArrival: string;
  expectedDeparture: string | null;
  expectedArrival: string | null;
  delaySeconds: number;
  status: TripStatus;
  /** Letzte echte Positionsmeldung (null = nur Fahrplanschätzung). */
  lastObservedAt?: string | null;
  version: number;
}

export interface TripStop {
  id: string;
  sequence: number;
  station: StationRef;
  scheduledArrival: string | null;
  scheduledDeparture: string | null;
  expectedArrival: string | null;
  expectedDeparture: string | null;
  actualArrival: string | null;
  actualDeparture: string | null;
  scheduledPlatform: string | null;
  expectedPlatform: string | null;
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;
  cancelled: boolean;
  reasonCode: DelayReason | null;
  reasonText: string | null;
  version: number;
}

export interface TripDetail extends TripSummary {
  stops: TripStop[];
}

export interface BoardEntry {
  tripId: string;
  stopId: string;
  station: StationRef;
  lineName: string;
  trainNumber: string;
  lineColor: string | null;
  companyName: string;
  reasonCode: DelayReason | null;
  origin: StationRef;
  destination: StationRef;
  scheduledTime: string;
  expectedTime: string | null;
  actualTime: string | null;
  delaySeconds: number | null;
  scheduledPlatform: string | null;
  expectedPlatform: string | null;
  platformChanged?: boolean;
  /** Wichtige Halte danach (Abfahrt) bzw. davor (Ankunft), max. 3. */
  via?: StationRef[];
  cancelled: boolean;
}

export interface ConnectionLeg {
  tripId: string;
  lineName: string;
  lineColor: string | null;
  trainNumber: string;
  from: BoardEntry;
  to: BoardEntry;
  /** Umstiegszeit zum vorherigen Abschnitt (null beim ersten). */
  transferSeconds?: number | null;
  transferAtRisk?: boolean;
}

export interface Connection {
  id: string;
  departure: string;
  arrival: string;
  durationSeconds: number;
  transfers: number;
  legs: ConnectionLeg[];
}

// ---------- Fahrkarten & Home ----------

export type TicketStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface TicketSummary {
  id: string;
  reference: string;
  companyId: string | null;
  tripId: string | null;
  origin: StationRef | null;
  destination: StationRef | null;
  validFrom: string;
  validUntil: string;
  status: TicketStatus;
  verified: boolean;
  qrPayload: string | null;
  productName: string | null;
  travelClass: 1 | 2 | null;
  companyName: string | null;
  boardingStopId: string | null;
  alightingStopId: string | null;
}

export interface CreateTicket {
  reference: string;
  productName?: string | null;
  companyId?: string | null;
  tripId?: string | null;
  boardingStopId?: string | null;
  alightingStopId?: string | null;
  originStationId?: string | null;
  destinationStationId?: string | null;
  validFrom: string;
  validUntil: string;
  travelClass?: 1 | 2 | null;
  qrPayload?: string | null;
}

export type AlertCode = 'TRIP_DELAYED' | 'TRIP_CANCELLED' | 'PLATFORM_CHANGED' | 'SCHEDULE_CHANGED';

export interface TripAlert {
  id: string;
  tripId: string;
  code: AlertCode;
  severity: 'INFO' | 'WARNING';
  delaySeconds: number | null;
  reasonCode: DelayReason | null;
  reasonText: string | null;
  createdAt: string;
}

export type NextTrip = TripSummary & {
  ticketId: string;
  boardingStop: TripStop | null;
  alightingStop: TripStop | null;
};

export interface Dashboard {
  nextTrip: NextTrip | null;
  recentTrips: TripSummary[];
  activeTickets: TicketSummary[];
  alerts: TripAlert[];
}

// ---------- Karte ----------

export type PositionType = 'REALTIME' | 'ESTIMATED' | 'UNAVAILABLE';

export interface MapTrain {
  tripId: string;
  positionVersion: number;
  lineName: string;
  trainNumber: string;
  coordinates: LngLat | null;
  bearing: number | null;
  delaySeconds: number;
  nextStopName: string | null;
  positionType: PositionType;
  isStale: boolean;
  observedAt: string | null;
  calculatedAt: string | null;
  source: string | null;
  estimationMethod: 'SCHEDULE' | 'SCHEDULE_WITH_UPDATES' | null;
}

/** /map/trains: Seite 1 erzeugt einen Snapshot, Folgeseiten senden denselben Token. */
export interface MapTrainsPage extends Page<MapTrain> {
  snapshotToken: string;
  snapshotAt: string;
  snapshotExpiresAt: string;
  snapshotRevision: number;
}

export interface RailwayProps {
  id: string;
  usage: TrackUsage;
  electrified?: boolean;
  name?: string;
}

export type RailwayCollection = FeatureCollection<
  LineString | MultiLineString,
  RailwayProps
> & {
  metadata: {
    country: string;
    source: string;
    attribution: string;
    updatedAt: string;
    dataStatus: DataStatus;
  };
};

// ---------- Worker ----------

export interface TripPatch {
  version: number;
  delaySeconds?: number;
  reasonCode?: DelayReason | null;
  reasonText?: string | null;
  cancelled?: boolean;
}

export interface StopPatch {
  version: number;
  expectedArrival?: string | null;
  expectedDeparture?: string | null;
  expectedPlatform?: string | null;
  cancelled?: boolean;
  reasonCode?: DelayReason | null;
  reasonText?: string | null;
  /** Neue erwartete Zeit auf alle folgenden Halte übertragen. */
  propagate?: boolean;
}

export interface WorkerAssignment {
  id: string;
  workerId: string;
  workerName: string;
  scope: 'TRAIN' | 'COMPANY';
  trainId: string | null;
  trainNumber: string | null;
  companyId: string | null;
  companyName: string | null;
  validFrom: string | null;
  validUntil: string | null;
  version: number;
}

// ---------- Admin ----------

export interface AdminUser extends User {
  status: 'ACTIVE' | 'LOCKED';
  createdAt: string;
  lastLoginAt: string | null;
  version: number;
}

export interface ImportJob {
  id: string;
  country: string;
  kind: 'RAILWAYS' | 'STATIONS';
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  progress: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

// ---------- Socket.IO ----------

export interface SocketEvent<T> {
  eventId: string;
  occurredAt: string;
  entityId: string;
  version: number;
  data: T;
  /** nur bei Kartenereignissen */
  subscriptionId?: string;
  mapRevision?: number;
}
