import { z } from "zod";
import { text, uuid } from "../common/validation";
export const roles = z.enum(["USER", "WORKER", "ADMIN"]);
export const preferences = z
  .object({
    language: z.enum(["de", "en"]),
    theme: z.enum(["light", "dark", "system"]),
    fontScale: z.enum(["sm", "md", "lg"]),
  })
  .strict();
export const userSchema = z.object({
  id: uuid,
  email: z.email(),
  displayName: z.string(),
  role: roles,
  preferences,
  mustChangePassword: z.boolean(),
});
export const authResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  user: userSchema,
});
export const password = z.string().min(12).max(128);
export const login = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
  .strict();
export const register = login.extend({ password, displayName: text });
export const profile = z
  .object({
    displayName: text.optional(),
    preferences: preferences.partial().optional(),
  })
  .strict();
export const changePassword = z
  .object({ currentPassword: z.string().max(128), newPassword: password })
  .strict();
export const adminUser = userSchema.extend({
  status: z.enum(["ACTIVE", "LOCKED"]),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
  version: z.number(),
});
export const createUser = z
  .object({
    email: z.email().max(254),
    displayName: text,
    role: roles,
    temporaryPassword: password,
  })
  .strict();
export const patchUser = z
  .object({
    version: z.number().int().positive(),
    role: roles.optional(),
    status: z.enum(["ACTIVE", "LOCKED"]).optional(),
    displayName: text.optional(),
  })
  .strict();
