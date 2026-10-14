import { z } from "zod";
import { uuid, iso, text } from "../common/validation";
import {
  stationRef,
  tripSummary,
  tripStop,
  reason,
} from "../rail/rail.schemas";
export const ticket = z.object({
  id: uuid,
  reference: z.string(),
  productName: z.string().nullable(),
  companyId: uuid.nullable(),
  companyName: z.string().nullable(),
  tripId: uuid.nullable(),
  origin: stationRef.nullable(),
  destination: stationRef.nullable(),
  boardingStopId: uuid.nullable(),
  alightingStopId: uuid.nullable(),
  validFrom: iso,
  validUntil: iso,
  travelClass: z.union([z.literal(1), z.literal(2)]).nullable(),
  status: z.enum(["ACTIVE", "EXPIRED", "CANCELLED"]),
  verified: z.boolean(),
  qrPayload: z.string().nullable(),
});
export const ticketCreate = z
  .object({
    reference: text,
    productName: text.nullable().optional(),
    companyId: uuid.nullable().optional(),
    tripId: uuid.nullable().optional(),
    boardingStopId: uuid.nullable().optional(),
    alightingStopId: uuid.nullable().optional(),
    originStationId: uuid.nullable().optional(),
    destinationStationId: uuid.nullable().optional(),
    validFrom: iso,
    validUntil: iso,
    travelClass: z
      .union([z.literal(1), z.literal(2)])
      .nullable()
      .optional(),
    qrPayload: z.string().max(4096).nullable().optional(),
  })
  .strict();
export const recent = z
  .object({ tripId: uuid, kind: z.literal("VIEWED") })
  .strict();
export const alert = z.object({
  id: z.string(),
  tripId: uuid,
  code: z.enum([
    "TRIP_DELAYED",
    "TRIP_CANCELLED",
    "PLATFORM_CHANGED",
    "SCHEDULE_CHANGED",
  ]),
  severity: z.enum(["INFO", "WARNING"]),
  delaySeconds: z.number().nullable(),
  reasonCode: reason.nullable(),
  reasonText: z.string().nullable(),
  createdAt: iso,
});
export const dashboard = z.object({
  nextTrip: tripSummary
    .extend({
      ticketId: uuid,
      boardingStop: tripStop.nullable(),
      alightingStop: tripStop.nullable(),
    })
    .nullable(),
  recentTrips: z.array(tripSummary),
  activeTickets: z.array(ticket),
  alerts: z.array(alert),
});
