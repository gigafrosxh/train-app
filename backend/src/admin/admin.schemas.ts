import { z } from "zod";
import { uuid, iso, text, version, page, country } from "../common/validation";
export const assignment = z.object({
  id: uuid,
  workerId: uuid,
  workerName: z.string(),
  scope: z.enum(["TRAIN", "COMPANY"]),
  trainId: uuid.nullable(),
  trainNumber: z.string().nullable(),
  companyId: uuid.nullable(),
  companyName: z.string().nullable(),
  validFrom: iso.nullable(),
  validUntil: iso.nullable(),
  version,
});
export const assignmentCreate = z
  .object({
    workerId: uuid,
    scope: z.enum(["TRAIN", "COMPANY"]),
    trainId: uuid.nullable().optional(),
    companyId: uuid.nullable().optional(),
    validFrom: iso.nullable().optional(),
    validUntil: iso.nullable().optional(),
  })
  .strict();
export const assignmentPatch = z
  .object({
    version,
    validFrom: iso.nullable().optional(),
    validUntil: iso.nullable().optional(),
  })
  .strict();
export const adminQuery = page
  .extend({
    q: z.string().max(100).optional(),
    country: country.optional(),
    companyId: uuid.optional(),
    trainId: uuid.optional(),
    workerId: uuid.optional(),
    role: z.enum(["USER", "WORKER", "ADMIN"]).optional(),
    status: z.enum(["ACTIVE", "LOCKED"]).optional(),
  })
  .strict();
