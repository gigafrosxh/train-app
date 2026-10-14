import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import {
  BodyDoc,
  ResponseDoc,
  Validate,
  country,
  uuid,
  iso,
} from "../common/validation";
import { Roles } from "../auth/security";
import { ImportsService } from "./imports.service";
const input = z
  .object({ country, kind: z.enum(["RAILWAYS", "STATIONS"]) })
  .strict();
const job = input.extend({
  id: uuid,
  status: z.enum(["QUEUED", "RUNNING", "DONE", "FAILED"]),
  progress: z.number().nullable(),
  startedAt: iso.nullable(),
  finishedAt: iso.nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
@ApiTags("Imports")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/imports")
export class ImportsController {
  constructor(@Inject(ImportsService) private service: ImportsService) {}
  @Post() @HttpCode(202) @BodyDoc(input) @ResponseDoc(job, 202) start(
    @Body(new Validate(input)) d: any,
  ) {
    return this.service.start(d);
  }
  @Get(":id") @ResponseDoc(job) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(id);
  }
}
