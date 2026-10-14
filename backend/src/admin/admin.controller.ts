import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Roles } from "../auth/security";
import { AdminService } from "./admin.service";
import { Database } from "../database/database";
import { RailService } from "../rail/rail.service";
import {
  BodyDoc,
  QueryDoc,
  ResponseDoc,
  Validate,
  listOf,
  version,
  idQuery,
  country,
} from "../common/validation";
import * as s from "../rail/rail.schemas";
import * as a from "./admin.schemas";
import * as u from "../auth/auth.schemas";
const settingsBody = z.object({ activeCountry: country }).strict();
const CompaniesControllerPatch = s.companyCreate
  .partial()
  .extend({ version })
  .strict();
@ApiTags("Admin: companies")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/companies")
export class CompaniesController {
  constructor(@Inject(AdminService) private service: AdminService) {}
  @Get() @QueryDoc(a.adminQuery) @ResponseDoc(listOf(s.company)) list(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("companies", q);
  }
  @Get(":id") @ResponseDoc(s.company) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("companies", id);
  }
  @Post() @BodyDoc(s.companyCreate) @ResponseDoc(s.company, 201) create(
    @Body(new Validate(s.companyCreate)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("companies", d, r.user.id);
  }
  @Patch(":id")
  @BodyDoc(CompaniesControllerPatch)
  @ResponseDoc(s.company)
  patch(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(CompaniesControllerPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("companies", d, r.user.id, id);
  }
  @Delete(":id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("companies", id, q.version, r.user.id);
  }
}

const StationsControllerPatch = s.stationCreate
  .partial()
  .extend({ version })
  .strict();
@ApiTags("Admin: stations")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/stations")
export class StationsController {
  constructor(@Inject(AdminService) private service: AdminService) {}
  @Get() @QueryDoc(a.adminQuery) @ResponseDoc(listOf(s.station)) list(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("stations", q);
  }
  @Get(":id") @ResponseDoc(s.station) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("stations", id);
  }
  @Post() @BodyDoc(s.stationCreate) @ResponseDoc(s.station, 201) create(
    @Body(new Validate(s.stationCreate)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("stations", d, r.user.id);
  }
  @Patch(":id") @BodyDoc(StationsControllerPatch) @ResponseDoc(s.station) patch(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(StationsControllerPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("stations", d, r.user.id, id);
  }
  @Delete(":id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("stations", id, q.version, r.user.id);
  }
}

const TrainsControllerPatch = s.trainCreate
  .partial()
  .extend({ version })
  .strict();
@ApiTags("Admin: trains")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/trains")
export class TrainsController {
  constructor(@Inject(AdminService) private service: AdminService) {}
  @Get() @QueryDoc(a.adminQuery) @ResponseDoc(listOf(s.train)) list(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("trains", q);
  }
  @Get(":id") @ResponseDoc(s.train) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("trains", id);
  }
  @Post() @BodyDoc(s.trainCreate) @ResponseDoc(s.train, 201) create(
    @Body(new Validate(s.trainCreate)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("trains", d, r.user.id);
  }
  @Patch(":id") @BodyDoc(TrainsControllerPatch) @ResponseDoc(s.train) patch(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(TrainsControllerPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("trains", d, r.user.id, id);
  }
  @Delete(":id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("trains", id, q.version, r.user.id);
  }
}

const LinesControllerPatch = s.lineCreate
  .partial()
  .extend({ version })
  .strict();
@ApiTags("Admin: lines")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/lines")
export class LinesController {
  constructor(@Inject(AdminService) private service: AdminService) {}
  @Get() @QueryDoc(a.adminQuery) @ResponseDoc(listOf(s.line)) list(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("lines", q);
  }
  @Get(":id") @ResponseDoc(s.line) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("lines", id);
  }
  @Post() @BodyDoc(s.lineCreate) @ResponseDoc(s.line, 201) create(
    @Body(new Validate(s.lineCreate)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("lines", d, r.user.id);
  }
  @Patch(":id") @BodyDoc(LinesControllerPatch) @ResponseDoc(s.line) patch(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(LinesControllerPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("lines", d, r.user.id, id);
  }
  @Delete(":id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("lines", id, q.version, r.user.id);
  }
}

const TracksControllerPatch = s.trackCreate
  .partial()
  .extend({ version })
  .strict();
@ApiTags("Admin: tracks")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/tracks")
export class TracksController {
  constructor(@Inject(AdminService) private service: AdminService) {}
  @Get() @QueryDoc(a.adminQuery) @ResponseDoc(listOf(s.track)) list(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("tracks", q);
  }
  @Get(":id") @ResponseDoc(s.track) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("tracks", id);
  }
  @Post() @BodyDoc(s.trackCreate) @ResponseDoc(s.track, 201) create(
    @Body(new Validate(s.trackCreate)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("tracks", d, r.user.id);
  }
  @Patch(":id") @BodyDoc(TracksControllerPatch) @ResponseDoc(s.track) patch(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(TracksControllerPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("tracks", d, r.user.id, id);
  }
  @Delete(":id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("tracks", id, q.version, r.user.id);
  }
}

const RoutesControllerPatch = s.routeCreate
  .partial()
  .extend({ version })
  .strict();
@ApiTags("Admin: routes")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/routes")
export class RoutesController {
  constructor(@Inject(AdminService) private service: AdminService) {}
  @Get() @QueryDoc(a.adminQuery) @ResponseDoc(listOf(s.route)) list(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("routes", q);
  }
  @Get(":id") @ResponseDoc(s.route) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("routes", id);
  }
  @Post() @BodyDoc(s.routeCreate) @ResponseDoc(s.route, 201) create(
    @Body(new Validate(s.routeCreate)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("routes", d, r.user.id);
  }
  @Patch(":id") @BodyDoc(RoutesControllerPatch) @ResponseDoc(s.route) patch(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(RoutesControllerPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("routes", d, r.user.id, id);
  }
  @Delete(":id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("routes", id, q.version, r.user.id);
  }
}

const SchedulesControllerPatch = s.scheduleCreate
  .partial()
  .extend({ version })
  .strict();
@ApiTags("Admin: schedules")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/schedules")
export class SchedulesController {
  constructor(@Inject(AdminService) private service: AdminService) {}
  @Get() @QueryDoc(a.adminQuery) @ResponseDoc(listOf(s.schedule)) list(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("schedules", q);
  }
  @Get(":id") @ResponseDoc(s.schedule) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("schedules", id);
  }
  @Post() @BodyDoc(s.scheduleCreate) @ResponseDoc(s.schedule, 201) create(
    @Body(new Validate(s.scheduleCreate)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("schedules", d, r.user.id);
  }
  @Patch(":id")
  @BodyDoc(SchedulesControllerPatch)
  @ResponseDoc(s.schedule)
  patch(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(SchedulesControllerPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("schedules", d, r.user.id, id);
  }
  @Delete(":id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("schedules", id, q.version, r.user.id);
  }
}

const WorkerAssignmentsControllerPatch = a.assignmentPatch;
@ApiTags("Admin: worker-assignments")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/worker-assignments")
export class WorkerAssignmentsController {
  constructor(@Inject(AdminService) private service: AdminService) {}
  @Get() @QueryDoc(a.adminQuery) @ResponseDoc(listOf(a.assignment)) list(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("worker-assignments", q);
  }
  @Get(":id") @ResponseDoc(a.assignment) get(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("worker-assignments", id);
  }
  @Post() @BodyDoc(a.assignmentCreate) @ResponseDoc(a.assignment, 201) create(
    @Body(new Validate(a.assignmentCreate)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("worker-assignments", d, r.user.id);
  }
  @Patch(":id")
  @BodyDoc(WorkerAssignmentsControllerPatch)
  @ResponseDoc(a.assignment)
  patch(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(WorkerAssignmentsControllerPatch)) d: any,
    @Req() r: any,
  ) {
    return this.service.save("worker-assignments", d, r.user.id, id);
  }
  @Delete(":id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("worker-assignments", id, q.version, r.user.id);
  }
}

@ApiTags("Admin")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin")
export class AdminController {
  constructor(
    @Inject(AdminService) private service: AdminService,
    @Inject(Database) private db: Database,
    @Inject(RailService) private rail: RailService,
  ) {}
  @Get("trips")
  @QueryDoc(s.tripQuery)
  @ResponseDoc(listOf(s.tripSummary))
  trips(@Query(new Validate(s.tripQuery)) q: any) {
    return this.rail.trips(q);
  }
  @Get("trips/:id") @ResponseDoc(s.tripDetail) trip(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.rail.trip(id);
  }
  @Post("trips")
  @BodyDoc(s.specialTrip)
  @ResponseDoc(s.tripDetail, 201)
  special(@Body(new Validate(s.specialTrip)) d: any, @Req() r: any) {
    return this.service.save("trips", d, r.user.id);
  }
  @Delete("trips/:id") @HttpCode(204) @QueryDoc(idQuery) remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new Validate(idQuery)) q: any,
    @Req() r: any,
  ) {
    return this.service.remove("trips", id, q.version, r.user.id);
  }
  @Get("users") @QueryDoc(a.adminQuery) @ResponseDoc(listOf(u.adminUser)) users(
    @Query(new Validate(a.adminQuery)) q: any,
  ) {
    return this.service.list("users", q);
  }
  @Get("users/:id") @ResponseDoc(u.adminUser) user(
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get("users", id);
  }
  @Post("users")
  @BodyDoc(u.createUser)
  @ResponseDoc(u.adminUser, 201)
  createUser(@Body(new Validate(u.createUser)) d: any, @Req() r: any) {
    return this.service.createUser(d, r.user.id);
  }
  @Patch("users/:id") @BodyDoc(u.patchUser) @ResponseDoc(u.adminUser) patchUser(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new Validate(u.patchUser)) d: any,
    @Req() r: any,
  ) {
    return this.service.patchUser(id, d, r.user.id);
  }
  @Patch("settings") @BodyDoc(settingsBody) async settings(
    @Body(new Validate(settingsBody)) d: any,
  ) {
    const c = await this.rail.country(d.activeCountry);
    if (!c.enabled) throw new Error("Country is not enabled");
    await this.db.query("UPDATE settings SET active_country=$1 WHERE id=1", [
      c.code,
    ]);
    return this.rail.settings();
  }
}
