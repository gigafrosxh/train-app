import { applyDecorators, PipeTransform } from "@nestjs/common";
import { ApiBody, ApiQuery, ApiResponse } from "@nestjs/swagger";
import { z } from "zod";
import { fail } from "./errors";
export class Validate implements PipeTransform {
  constructor(private schema: z.ZodType) {}
  transform(value: any) {
    const r = this.schema.safeParse(value);
    if (!r.success)
      fail(400, "VALIDATION_FAILED", "Please check your input.", {
        fieldErrors: r.error.issues.map((i) => ({
          field: i.path.join("."),
          code: "INVALID_VALUE",
          message: i.message,
        })),
      });
    return r.data;
  }
}
export const schemaOf = (s: z.ZodType) =>
  z.toJSONSchema(s, { unrepresentable: "any" }) as any;
export const BodyDoc = (s: z.ZodType) => ApiBody({ schema: schemaOf(s) });
export const ResponseDoc = (s: z.ZodType, status = 200) =>
  ApiResponse({ status, schema: schemaOf(s) });
export function QueryDoc(s: z.ZodType) {
  const j = schemaOf(s);
  return applyDecorators(
    ...Object.entries(j.properties ?? {}).map(([name, v]) =>
      ApiQuery({
        name,
        required: j.required?.includes(name) ?? false,
        schema: v as any,
      }),
    ),
  );
}
export const uuid = z.uuid();
export const iso = z.iso.datetime({ offset: true });
export const text = z.string().trim().min(1).max(200);
export const date = z.iso.date();
export const country = z.string().regex(/^[A-Z]{2}$/);
export const version = z.number().int().positive();
export const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const idQuery = z
  .object({ version: z.coerce.number().int().positive() })
  .strict();
export const coordinates = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export const timezone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA time zone");
export function paginate<T>(items: T[], q: { page: number; pageSize: number }) {
  return {
    items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    total: items.length,
    page: q.page,
    pageSize: q.pageSize,
  };
}
export const listOf = (s: z.ZodType) =>
  z.object({
    items: z.array(s),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });
