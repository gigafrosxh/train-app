import { Type } from '@angular/core';
import { AdminResource } from '../../core/api/api';
import { DELAY_REASONS } from '../../core/models/api.models';

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'bool'
  | 'color'
  | 'coords'
  | 'date'
  | 'password'
  | 'email'
  | 'lookup';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Feste Auswahl: value + Übersetzungsschlüssel */
  options?: { value: unknown; label: string }[];
  /** Für lookup */
  resource?: AdminResource;
  query?: Record<string, string>;
  createOnly?: boolean;
  editOnly?: boolean;
  hint?: string;
  /** Feld nur zeigen, wenn Bedingung erfüllt */
  showIf?: (v: Record<string, unknown>) => boolean;
  full?: boolean;
  default?: unknown | (() => unknown);
}

export type ColumnKind = 'text' | 'color' | 'pill' | 'ref' | 'date' | 'day' | 'bool' | 'translate';

export interface ColumnDef {
  key: string;
  label: string;
  kind?: ColumnKind;
  /** Für ref: Ressource der ID */
  resource?: AdminResource;
  /** Für translate: Präfix des Schlüssels */
  prefix?: string;
  value?: (row: Record<string, unknown>) => unknown;
  hideMobile?: boolean;
  nowrap?: boolean;
}

export interface ResourceDef {
  resource: AdminResource;
  title: string;
  intro: string;
  icon: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  /** Eigener Dialog statt generischem Formular */
  dialog?: () => Promise<Type<unknown>>;
  /** Formularwerte → Request-Body */
  toBody?: (v: Record<string, unknown>, row: Record<string, unknown> | null) => Record<string, unknown>;
  /** Datensatz → Formularwerte */
  fromRow?: (row: Record<string, unknown>) => Record<string, unknown>;
  query?: Record<string, string>;
  /** false: Endpunkt kennt keinen q-Parameter (Backend-Validierung ist strikt) */
  searchable?: boolean;
  canCreate?: boolean;
  canDelete?: boolean;
}

const TRAIN_TYPES = ['REGIONAL', 'INTERCITY', 'HIGH_SPEED', 'NIGHT', 'OTHER'].map((v) => ({ value: v, label: `trainTypes.${v}` }));
const USAGES = ['main', 'branch', 'industrial', 'military', 'tourism', 'test', 'unknown'].map((v) => ({ value: v, label: `usage.${v}` }));
const ROLES = ['USER', 'WORKER', 'ADMIN'].map((v) => ({ value: v, label: `roles.${v}` }));
const SEVERITIES = ['INFO', 'WARNING', 'SEVERE'].map((v) => ({ value: v, label: `severity.${v}` }));
const REASONS = DELAY_REASONS.map((v) => ({ value: v, label: `reasons.${v}` }));
const DAY = 86400000;
// Lokale Mitternacht (Störungen gelten ab Tagesbeginn vor Ort, nicht ab 00:00 UTC)
const localDayStart = (v: unknown) => (v ? new Date(`${v}T00:00:00`).toISOString() : null);
const localDayOf = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleDateString('sv-SE') : '');

const toIsoDate = (v: unknown) => (v ? new Date(String(v) + 'T00:00:00Z').toISOString() : null);
const fromIsoDate = (v: unknown) => (v ? String(v).slice(0, 10) : '');

export const DEFS: Record<string, ResourceDef> = {
  companies: {
    resource: 'companies',
    title: 'setup.companies',
    intro: 'setup.companiesIntro',
    icon: 'apartment',
    columns: [
      { key: 'name', label: 'setup.f.name' },
      { key: 'code', label: 'setup.f.code' },
      { key: 'country', label: 'setup.f.country', hideMobile: true },
    ],
    fields: [
      { key: 'name', label: 'setup.f.name', type: 'text', required: true },
      { key: 'code', label: 'setup.f.code', type: 'text', required: true },
      { key: 'country', label: 'setup.f.country', type: 'text', required: true, default: 'AT' },
    ],
  },
  stations: {
    resource: 'stations',
    title: 'setup.stations',
    intro: 'setup.stationsIntro',
    icon: 'location_on',
    columns: [
      { key: 'name', label: 'setup.f.name' },
      { key: 'code', label: 'setup.f.code' },
      { key: 'coordinates', label: 'setup.f.coordinates', value: (r) => (r['coordinates'] as number[]).map((n) => n.toFixed(4)).join(', '), hideMobile: true },
      { key: 'timeZone', label: 'setup.f.timeZone', hideMobile: true },
    ],
    fields: [
      { key: 'name', label: 'setup.f.name', type: 'text', required: true },
      { key: 'code', label: 'setup.f.code', type: 'text' },
      { key: 'coordinates', label: 'setup.f.coordinates', type: 'coords', required: true, hint: 'setup.coordsHint', full: true },
      { key: 'country', label: 'setup.f.country', type: 'text', required: true, default: 'AT' },
      { key: 'timeZone', label: 'setup.f.timeZone', type: 'text', required: true, default: 'Europe/Vienna' },
    ],
  },
  trains: {
    resource: 'trains',
    title: 'setup.trains',
    intro: 'setup.trainsIntro',
    icon: 'train',
    columns: [
      { key: 'trainNumber', label: 'setup.f.trainNumber', nowrap: true },
      { key: 'companyId', label: 'setup.f.company', kind: 'ref', resource: 'companies', hideMobile: true },
      { key: 'type', label: 'setup.f.type', kind: 'translate', prefix: 'trainTypes.' },
      { key: 'active', label: 'setup.f.active', kind: 'bool' },
    ],
    fields: [
      { key: 'trainNumber', label: 'setup.f.trainNumber', type: 'text', required: true },
      { key: 'name', label: 'setup.f.trainName', type: 'text' },
      { key: 'companyId', label: 'setup.f.company', type: 'lookup', resource: 'companies', required: true },
      { key: 'type', label: 'setup.f.type', type: 'select', options: TRAIN_TYPES, required: true, default: 'REGIONAL' },
      { key: 'active', label: 'setup.f.active', type: 'bool', default: true },
    ],
  },
  lines: {
    resource: 'lines',
    title: 'setup.lines',
    intro: 'setup.linesIntro',
    icon: 'linear_scale',
    columns: [
      { key: 'color', label: '', kind: 'color' },
      { key: 'name', label: 'setup.f.name' },
      { key: 'code', label: 'setup.f.code' },
      { key: 'companyId', label: 'setup.f.company', kind: 'ref', resource: 'companies', hideMobile: true },
    ],
    fields: [
      { key: 'name', label: 'setup.f.name', type: 'text', required: true },
      { key: 'code', label: 'setup.f.code', type: 'text', required: true },
      { key: 'companyId', label: 'setup.f.company', type: 'lookup', resource: 'companies', required: true },
      { key: 'color', label: 'setup.f.color', type: 'color', default: '#1d5bd6' },
    ],
  },
  routes: {
    resource: 'routes',
    title: 'setup.routes',
    intro: 'setup.routesIntro',
    icon: 'route',
    columns: [
      { key: 'name', label: 'setup.f.name' },
      { key: 'lineId', label: 'setup.f.line', kind: 'ref', resource: 'lines', hideMobile: true },
      { key: 'stops', label: 'setup.f.stops', value: (r) => (r['stops'] as unknown[]).length },
    ],
    fields: [],
    dialog: () => import('./route.dialog').then((m) => m.RouteDialog),
  },
  schedules: {
    resource: 'schedules',
    title: 'setup.schedules',
    intro: 'setup.schedulesIntro',
    icon: 'calendar_month',
    columns: [
      { key: 'trainId', label: 'setup.f.train', kind: 'ref', resource: 'trains', nowrap: true },
      { key: 'routeId', label: 'setup.f.route', kind: 'ref', resource: 'routes' },
      { key: 'first', label: 'setup.f.departure', value: (r) => offsetLabel((r['stops'] as { departureOffsetSeconds: number | null }[])[0]?.departureOffsetSeconds) },
      { key: 'validUntil', label: 'setup.f.validUntil', kind: 'day', hideMobile: true },
    ],
    fields: [],
    dialog: () => import('./schedule.dialog').then((m) => m.ScheduleDialog),
  },
  tracks: {
    resource: 'tracks',
    title: 'setup.tracks',
    intro: 'setup.tracksIntro',
    icon: 'conversion_path',
    columns: [
      { key: 'name', label: 'setup.f.name' },
      { key: 'usage', label: 'setup.f.usage', kind: 'translate', prefix: 'usage.' },
      { key: 'electrified', label: 'setup.f.electrified', kind: 'bool', hideMobile: true },
      { key: 'points', label: 'setup.f.points', value: (r) => ((r['geometry'] as { coordinates: unknown[] }).coordinates ?? []).length, hideMobile: true },
    ],
    fields: [],
    dialog: () => import('./track.dialog').then((m) => m.TrackDialog),
  },
  trips: {
    resource: 'trips',
    title: 'setup.special',
    intro: 'setup.specialIntro',
    icon: 'star',
    searchable: false,
    columns: [
      { key: 'trainNumber', label: 'setup.f.train', nowrap: true },
      { key: 'route', label: 'setup.f.route', value: (r) => `${(r['origin'] as { name: string }).name} → ${(r['destination'] as { name: string }).name}` },
      { key: 'serviceDate', label: 'setup.f.date', kind: 'day' },
    ],
    fields: [],
    dialog: () => import('./special-trip.dialog').then((m) => m.SpecialTripDialog),
  },
  users: {
    resource: 'users',
    title: 'setup.users',
    intro: 'setup.usersIntro',
    icon: 'group',
    columns: [
      { key: 'displayName', label: 'setup.f.name' },
      { key: 'email', label: 'login.email', hideMobile: true },
      { key: 'role', label: 'setup.f.role', kind: 'translate', prefix: 'roles.' },
      { key: 'status', label: 'setup.f.status', kind: 'translate', prefix: 'userStatus.' },
      { key: 'lastLoginAt', label: 'setup.f.lastLogin', kind: 'date', hideMobile: true },
    ],
    fields: [
      { key: 'displayName', label: 'setup.f.name', type: 'text', required: true },
      { key: 'email', label: 'login.email', type: 'email', required: true, createOnly: true },
      { key: 'role', label: 'setup.f.role', type: 'select', options: ROLES, required: true, default: 'WORKER' },
      {
        key: 'status',
        label: 'setup.f.status',
        type: 'select',
        options: [
          { value: 'ACTIVE', label: 'userStatus.ACTIVE' },
          { value: 'LOCKED', label: 'userStatus.LOCKED' },
        ],
        editOnly: true,
      },
      { key: 'temporaryPassword', label: 'setup.f.tempPassword', type: 'password', required: true, createOnly: true, hint: 'setup.tempPasswordHint', full: true },
    ],
    canDelete: false,
  },
  'worker-assignments': {
    resource: 'worker-assignments',
    title: 'setup.assignments',
    intro: 'setup.assignmentsIntro',
    icon: 'badge',
    columns: [
      { key: 'workerName', label: 'setup.f.worker' },
      { key: 'scope', label: 'setup.f.scope', kind: 'translate', prefix: 'scope.' },
      { key: 'target', label: 'setup.f.target', value: (r) => (r['scope'] === 'TRAIN' ? r['trainNumber'] : r['companyName']) },
      { key: 'validUntil', label: 'setup.f.validUntil', kind: 'date', hideMobile: true },
    ],
    fields: [
      { key: 'workerId', label: 'setup.f.worker', type: 'lookup', resource: 'users', query: { role: 'WORKER' }, required: true, createOnly: true },
      {
        key: 'scope',
        label: 'setup.f.scope',
        type: 'select',
        required: true,
        createOnly: true,
        default: 'TRAIN',
        options: [
          { value: 'TRAIN', label: 'scope.TRAIN' },
          { value: 'COMPANY', label: 'scope.COMPANY' },
        ],
      },
      { key: 'trainId', label: 'setup.f.train', type: 'lookup', resource: 'trains', createOnly: true, showIf: (v) => v['scope'] === 'TRAIN' },
      { key: 'companyId', label: 'setup.f.company', type: 'lookup', resource: 'companies', createOnly: true, showIf: (v) => v['scope'] === 'COMPANY' },
      { key: 'validFrom', label: 'setup.f.validFrom', type: 'date' },
      { key: 'validUntil', label: 'setup.f.validUntil', type: 'date' },
    ],
    fromRow: (r) => ({ ...r, validFrom: fromIsoDate(r['validFrom']), validUntil: fromIsoDate(r['validUntil']) }),
    toBody: (v, row) => {
      const dates = { validFrom: toIsoDate(v['validFrom']), validUntil: toIsoDate(v['validUntil']) };
      if (row) return dates;
      return {
        workerId: v['workerId'],
        scope: v['scope'],
        ...(v['scope'] === 'TRAIN' ? { trainId: v['trainId'] } : { companyId: v['companyId'] }),
        ...dates,
      };
    },
  },
};

// Störungen: Gültigkeit tageweise, Ende einschließlich (bis Mitternacht danach)
DEFS['disruptions'] = {
  resource: 'disruptions',
  title: 'setup.disruptions',
  intro: 'setup.disruptionsIntro',
  icon: 'campaign',
  columns: [
    { key: 'title', label: 'setup.f.title' },
    { key: 'severity', label: 'setup.f.severity', kind: 'translate', prefix: 'severity.' },
    { key: 'validFrom', label: 'setup.f.validFrom', kind: 'date', hideMobile: true },
    { key: 'validUntil', label: 'setup.f.validUntil', kind: 'date', value: (r) => (r['validUntil'] ? new Date(Date.parse(String(r['validUntil'])) - DAY).toISOString() : null) },
  ],
  fields: [
    { key: 'title', label: 'setup.f.title', type: 'text', required: true, full: true },
    { key: 'text', label: 'setup.f.text', type: 'text', full: true, hint: 'setup.disruptionTextHint' },
    { key: 'severity', label: 'setup.f.severity', type: 'select', options: SEVERITIES, required: true, default: 'WARNING' },
    { key: 'reasonCode', label: 'setup.f.reason', type: 'select', options: REASONS },
    { key: 'stationId', label: 'setup.f.station', type: 'lookup', resource: 'stations', hint: 'setup.disruptionScopeHint' },
    { key: 'lineId', label: 'setup.f.line', type: 'lookup', resource: 'lines' },
    { key: 'validFrom', label: 'setup.f.validFrom', type: 'date', required: true, default: () => new Date().toLocaleDateString('sv-SE') },
    { key: 'validUntil', label: 'setup.f.validUntil', type: 'date' },
    { key: 'country', label: 'setup.f.country', type: 'text', required: true, default: 'AT', createOnly: true },
  ],
  fromRow: (r) => ({
    ...r,
    stationId: (r['stationIds'] as string[])?.[0] ?? null,
    lineId: (r['lineIds'] as string[])?.[0] ?? null,
    validFrom: localDayOf(r['validFrom']),
    validUntil: r['validUntil'] ? localDayOf(new Date(Date.parse(String(r['validUntil'])) - DAY).toISOString()) : '',
  }),
  toBody: (v, row) => {
    const until = localDayStart(v['validUntil']);
    const body: Record<string, unknown> = {
      title: v['title'],
      text: v['text'] ?? '',
      severity: v['severity'],
      reasonCode: v['reasonCode'] || null,
      stationIds: v['stationId'] ? [v['stationId']] : [],
      lineIds: v['lineId'] ? [v['lineId']] : [],
      validFrom: localDayStart(v['validFrom']),
      validUntil: until ? new Date(Date.parse(until) + DAY).toISOString() : null,
    };
    if (!row) body['country'] = v['country'];
    return body;
  },
};

export function offsetLabel(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '–';
  const day = Math.floor(sec / 86400);
  const rest = sec - day * 86400;
  const hh = String(Math.floor(rest / 3600)).padStart(2, '0');
  const mm = String(Math.floor((rest % 3600) / 60)).padStart(2, '0');
  return `${hh}:${mm}${day ? ` +${day}` : ''}`;
}

export { DELAY_REASONS };
