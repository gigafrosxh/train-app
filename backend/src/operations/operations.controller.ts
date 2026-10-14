import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/security";
import { RailService } from "../rail/rail.service";
import { AdminService } from "../admin/admin.service";
import { OperationsService } from "./operations.service";
import {
  BodyDoc,
  QueryDoc,
  ResponseDoc,
  Validate,
  listOf,
  page,
} from "../common/validation";
import { assignment } from "../admin/admin.schemas";
import * as s from "../rail/rail.schemas";
@ApiTags("Operations")
@ApiBearerAuth()
@Roles("WORKER", "ADMIN")
@Controller("operations")
export class OperationsController {
  constructor(
    @Inject(RailService) private rail: RailService,
    @Inject(AdminService) private admin: AdminService,
    @Inject(OperationsService) private service: OperationsService,
  ) {}
  @Get("trips")
  @QueryDoc(s.tripQuery)
  @ResponseDoc(listOf(s.tripSummary))
  trips(@Query(new Validate(s.tripQuery)) q: any, @Req() r: any) {
    return this.rail.trips(q, r.user.role === "ADMIN" ? undefined : r.user.id);
  }
  @Get("assignments")
  @QueryDoc(page)
  @ResponseDoc(listOf(assignment))
  assignments(@Query(new Validate(page)) q: any, @Req() r: any) {
    return this.admin.assignments(q, r.user.id);
  }
  @Patch("trips/:id") @BodyDoc(s.tripPatch) @ResponseDoc(s.tripDetail) update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(s.tripPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.update(id, d, r.user);
  }
  @Patch("trips/:id/stops/:stopId")
  @BodyDoc(s.stopPatch)
  @ResponseDoc(s.tripStop)
  stop(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("stopId", new ParseUUIDPipe()) stopId: string,
    @Body(new Validate(s.stopPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.update(id, d, r.user, stopId);
  }
}
