import { z } from "zod";
import {
  uuid,
  iso,
  text,
  date,
  country,
  version,
  page,
  coordinates,
  timezone,
} from "../common/validation";
export const stationRef = z.object({
  id: uuid,
  name: z.string(),
  code: z.string().nullable(),
  timeZone: z.string(),
});
export const station = stationRef.extend({
  country,
  coordinates,
  aliases: z.array(z.string()),
  version,
});
export const lineRef = z.object({
  id: uuid,
  name: z.string(),
  color: z.string().nullable(),
});
export const stationDetail = station.extend({ lines: z.array(lineRef) });
export const nearbyStation = station.extend({ distanceMeters: z.number() });
export const nearbyQuery = z
  .object({
    lng: z.coerce.number().min(-180).max(180),
    lat: z.coerce.number().min(-90).max(90),
    pageSize: z.coerce.number().int().min(1).max(20).default(5),
    country: country.optional(),
  })
  .strict();
export const company = z.object({
  id: uuid,
  name: z.string(),
  code: z.string(),
  country,
  version,
});
export const trainType = z.enum([
  "REGIONAL",
  "INTERCITY",
  "HIGH_SPEED",
  "NIGHT",
  "OTHER",
]);
export const train = z.object({
  id: uuid,
  companyId: uuid,
  trainNumber: z.string(),
  name: z.string().nullable(),
  type: trainType,
  active: z.boolean(),
  version,
});
export const line = z.object({
  id: uuid,
  companyId: uuid,
  name: z.string(),
  code: z.string(),
  color: z.string().nullable(),
  version,
});
export const route = z.object({
  id: uuid,
  lineId: uuid,
  name: z.string(),
  direction: z.string(),
  version,
  stops: z.array(
    z.object({ id: uuid, sequence: z.number(), station: stationRef }),
  ),
  trackIds: z.array(uuid),
});
export const reason = z.enum([
  "TECHNICAL",
  "WEATHER",
  "STAFF",
  "CONSTRUCTION",
  "OTHER",
]);
export const tripStatus = z.enum([
  "SCHEDULED",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
]);
export const tripStop = z.object({
  id: uuid,
  sequence: z.number(),
  station: stationRef,
  scheduledArrival: iso.nullable(),
  scheduledDeparture: iso.nullable(),
  expectedArrival: iso.nullable(),
  expectedDeparture: iso.nullable(),
  actualArrival: iso.nullable(),
  actualDeparture: iso.nullable(),
  scheduledPlatform: z.string().nullable(),
  expectedPlatform: z.string().nullable(),
  arrivalDelaySeconds: z.number().nullable(),
  departureDelaySeconds: z.number().nullable(),
  cancelled: z.boolean(),
  reasonCode: reason.nullable(),
  reasonText: z.string().nullable(),
  version,
});
export const tripSummary = z.object({
  id: uuid,
  trainId: uuid,
  trainNumber: z.string(),
  lineId: uuid,
  lineName: z.string(),
  lineColor: z.string().nullable(),
  companyId: uuid,
  companyName: z.string(),
  routeId: uuid,
  serviceDate: date,
  origin: stationRef,
  destination: stationRef,
  scheduledDeparture: iso,
  scheduledArrival: iso,
  expectedDeparture: iso.nullable(),
  expectedArrival: iso.nullable(),
  delaySeconds: z.number(),
  status: tripStatus,
  lastObservedAt: iso.nullable(),
  version,
});
export const tripDetail = tripSummary.extend({ stops: z.array(tripStop) });
export const boardEntry = z.object({
  tripId: uuid,
  stopId: uuid,
  station: stationRef,
  lineName: z.string(),
  lineColor: z.string().nullable(),
  trainNumber: z.string(),
  companyName: z.string(),
  origin: stationRef,
  destination: stationRef,
  scheduledTime: iso,
  expectedTime: iso.nullable(),
  actualTime: iso.nullable(),
  delaySeconds: z.number().nullable(),
  scheduledPlatform: z.string().nullable(),
  expectedPlatform: z.string().nullable(),
  platformChanged: z.boolean(),
  via: z.array(stationRef),
  cancelled: z.boolean(),
  reasonCode: reason.nullable(),
});
export const connection = z.object({
  id: z.string(),
  departure: iso,
  arrival: iso,
  durationSeconds: z.number(),
  transfers: z.number(),
  legs: z.array(
    z.object({
      tripId: uuid,
      lineName: z.string(),
      lineColor: z.string().nullable(),
      trainNumber: z.string(),
      from: boardEntry,
      to: boardEntry,
      transferSeconds: z.number().nullable(),
      transferAtRisk: z.boolean(),
    }),
  ),
});
export const listQuery = page
  .extend({
    country: country.optional(),
    q: z.string().max(100).optional(),
    companyId: uuid.optional(),
  })
  .strict();
export const tripQuery = page
  .extend({
    country: country.optional(),
    from: iso.optional(),
    to: iso.optional(),
    lineId: uuid.optional(),
    trainId: uuid.optional(),
    status: tripStatus.optional(),
  })
  .strict();
export const boardQuery = page
  .extend({ from: iso.optional(), to: iso.optional() })
  .strict();
export const connectionQuery = page
  .extend({
    fromStationId: uuid,
    toStationId: uuid,
    departAfter: iso,
    maxTransfers: z.coerce.number().int().min(0).max(2).default(2),
  })
  .strict();
export const companyCreate = z
  .object({ name: text, code: text, country })
  .strict();
export const stationCreate = z
  .object({
    name: text,
    code: text.nullable().default(null),
    country,
    coordinates,
    timeZone: timezone,
    aliases: z.array(text).max(10).optional(),
  })
  .strict();
export const trainCreate = z
  .object({
    companyId: uuid,
    trainNumber: text,
    name: text.nullable().default(null),
    type: trainType,
    active: z.boolean().default(true),
  })
  .strict();
export const lineCreate = z
  .object({
    companyId: uuid,
    name: text,
    code: text,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .default(null),
  })
  .strict();
export const usage = z.enum([
  "main",
  "branch",
  "industrial",
  "military",
  "tourism",
  "test",
  "unknown",
]);
export const geometry = z
  .object({
    type: z.literal("LineString"),
    coordinates: z.array(coordinates).min(2).max(100000),
  })
  .strict();
export const trackCreate = z
  .object({
    country,
    name: text.nullable().default(null),
    usage: usage.default("unknown"),
    electrified: z.boolean().nullable().default(null),
    geometry,
  })
  .strict();
export const track = trackCreate.extend({ id: uuid, version });
export const routeStopInput = z
  .object({
    id: uuid.optional(),
    stationId: uuid,
    sequence: z.number().int().min(0),
  })
  .strict();
export const routeCreate = z
  .object({
    lineId: uuid,
    name: text,
    direction: text,
    stops: z.array(routeStopInput).min(2).max(200),
    trackIds: z.array(uuid).max(2000).default([]),
  })
  .strict();
export const scheduleStop = z
  .object({
    routeStopId: uuid,
    arrivalOffsetSeconds: z.number().int().min(0).max(259200).nullable(),
    departureOffsetSeconds: z.number().int().min(0).max(259200).nullable(),
  })
  .strict();
export const scheduleCreate = z
  .object({
    routeId: uuid,
    trainId: uuid,
    timeZone: timezone,
    validFrom: date,
    validUntil: date,
    weekdays: z.array(z.number().int().min(1).max(7)).max(7),
    stops: z.array(scheduleStop).min(2).max(200),
    exceptions: z
      .array(z.object({ date, runs: z.boolean() }).strict())
      .max(730)
      .default([]),
    dstDisambiguation: z.enum(["REJECT", "EARLIER", "LATER"]).default("REJECT"),
  })
  .strict();
export const schedule = scheduleCreate.extend({ id: uuid, version });
export const specialTrip = z
  .object({
    routeId: uuid,
    trainId: uuid,
    serviceDate: date,
    stops: z
      .array(
        z
          .object({
            routeStopId: uuid,
            scheduledArrival: iso.nullable(),
            scheduledDeparture: iso.nullable(),
          })
          .strict(),
      )
      .min(2)
      .max(200),
  })
  .strict();
export const tripPatch = z
  .object({
    version,
    delaySeconds: z.number().int().min(-3600).max(86400).optional(),
    reasonCode: reason.nullable().optional(),
    reasonText: z.string().max(1000).nullable().optional(),
    cancelled: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 1, "At least one change is required");
export const stopPatch = z
  .object({
    version,
    expectedArrival: iso.nullable().optional(),
    expectedDeparture: iso.nullable().optional(),
    expectedPlatform: z.string().max(50).nullable().optional(),
    cancelled: z.boolean().optional(),
    reasonCode: reason.nullable().optional(),
    reasonText: z.string().max(1000).nullable().optional(),
    propagate: z.boolean().optional(),
  })
  .strict()
  .refine(
    (d) => Object.keys(d).filter((k) => k !== "propagate").length > 1,
    "At least one change is required",
  )
  .refine(
    (d) =>
      !d.propagate ||
      d.expectedArrival !== undefined ||
      d.expectedDeparture !== undefined,
    "propagate needs a new expected time",
  );
export const severity = z.enum(["INFO", "WARNING", "SEVERE"]);
export const disruptionCreate = z
  .object({
    country,
    severity,
    reasonCode: reason.nullable().default(null),
    title: text,
    text: z.string().max(4000).default(""),
    validFrom: iso,
    validUntil: iso.nullable().default(null),
    stationIds: z.array(uuid).max(200).default([]),
    lineIds: z.array(uuid).max(200).default([]),
  })
  .strict();
export const disruption = disruptionCreate.extend({
  id: uuid,
  createdAt: iso,
  version,
});
export const disruptionQuery = page
  .extend({
    country: country.optional(),
    stationId: uuid.optional(),
    lineId: uuid.optional(),
    activeAt: iso.optional(),
  })
  .strict();
