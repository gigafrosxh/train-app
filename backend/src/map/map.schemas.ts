import { z } from "zod";
import { uuid, iso, country, coordinates, page } from "../common/validation";
export const bbox = z
  .string()
  .max(150)
  .refine((v) => {
    const a = v.split(",").map(Number);
    return (
      a.length === 4 &&
      a.every(Number.isFinite) &&
      a[0] >= -180 &&
      a[2] <= 180 &&
      a[1] >= -90 &&
      a[3] <= 90 &&
      a[0] < a[2] &&
      a[1] < a[3]
    );
  }, "Expected minLng,minLat,maxLng,maxLat");
export const mapQuery = z
  .object({
    country: country.optional(),
    bbox: bbox.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
    snapshotToken: uuid.optional(),
  })
  .strict();
export const railwayQuery = z
  .object({
    country: country.optional(),
    bbox: bbox.optional(),
    zoom: z.coerce.number().min(0).max(22).default(8),
  })
  .strict();
export const mapTrain = z.object({
  tripId: uuid,
  positionVersion: z.number(),
  lineName: z.string(),
  trainNumber: z.string(),
  coordinates: coordinates.nullable(),
  bearing: z.number().nullable(),
  delaySeconds: z.number(),
  nextStopName: z.string().nullable(),
  positionType: z.enum(["REALTIME", "ESTIMATED", "UNAVAILABLE"]),
  isStale: z.boolean(),
  observedAt: iso.nullable(),
  calculatedAt: iso.nullable(),
  source: z.string().nullable(),
  estimationMethod: z.enum(["SCHEDULE", "SCHEDULE_WITH_UPDATES"]).nullable(),
});
export const snapshot = z.object({
  items: z.array(mapTrain),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  snapshotToken: uuid,
  snapshotAt: iso,
  snapshotExpiresAt: iso,
  snapshotRevision: z.number(),
});
export const positionInput = z
  .object({
    tripId: uuid,
    coordinates,
    observedAt: iso,
    bearing: z.number().min(0).lt(360).nullable().optional(),
  })
  .strict();
export const feature = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(coordinates),
  }),
  properties: z.record(z.string(), z.unknown()),
});
export const featureCollection = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(feature),
  metadata: z.object({
    country,
    source: z.string(),
    attribution: z.string(),
    updatedAt: iso.nullable(),
    dataStatus: z.string(),
  }),
});
