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
import { AuthService, publicUser } from "../auth/auth.service";
import { PasswordAccess } from "../auth/security";
import { profile, changePassword, userSchema } from "../auth/auth.schemas";
import {
  BodyDoc,
  ResponseDoc,
  QueryDoc,
  Validate,
  listOf,
  page,
  paginate,
} from "../common/validation";
import { tripSummary } from "../rail/rail.schemas";
import { AccountService } from "./account.service";
import * as s from "./account.schemas";
@ApiTags("Account")
@ApiBearerAuth()
@Controller("me")
export class AccountController {
  constructor(
    @Inject(AccountService) private service: AccountService,
    @Inject(AuthService) private auth: AuthService,
  ) {}
  @Get() @PasswordAccess() @ResponseDoc(userSchema) me(@Req() r: any) {
    const { sessionId, expiresAt, ...u } = r.user;
    return u;
  }
  @Patch() @BodyDoc(profile) @ResponseDoc(userSchema) profile(
    @Req() r: any,
    @Body(new Validate(profile)) d: any,
  ) {
    return this.service.profile(r.user.id, d);
  }
  @Patch("password")
  @PasswordAccess()
  @HttpCode(204)
  @BodyDoc(changePassword)
  password(@Req() r: any, @Body(new Validate(changePassword)) d: any) {
    return this.auth.changePassword(r.user.id, d);
  }
  @Delete() @HttpCode(204) remove(@Req() r: any) {
    return this.service.deleteAccount(r.user.id);
  }
  @Get("dashboard") @ResponseDoc(s.dashboard) dashboard(@Req() r: any) {
    return this.service.dashboard(r.user.id);
  }
  @Get("tickets") @QueryDoc(page) @ResponseDoc(listOf(s.ticket)) async tickets(
    @Req() r: any,
    @Query(new Validate(page)) q: any,
  ) {
    return paginate(await this.service.tickets(r.user.id), q);
  }
  @Get("tickets/:id") @ResponseDoc(s.ticket) ticket(
    @Req() r: any,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.ticket(r.user.id, id);
  }
  @Post("tickets") @BodyDoc(s.ticketCreate) @ResponseDoc(s.ticket, 201) create(
    @Req() r: any,
    @Body(new Validate(s.ticketCreate)) d: any,
  ) {
    return this.service.create(r.user.id, d);
  }
  @Delete("tickets/:id") @HttpCode(204) delete(
    @Req() r: any,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.remove(r.user.id, id);
  }
  @Get("recent-trips")
  @QueryDoc(page)
  @ResponseDoc(listOf(tripSummary))
  async recent(@Req() r: any, @Query(new Validate(page)) q: any) {
    return paginate(await this.service.recent(r.user.id), q);
  }
  @Post("recent-trips") @HttpCode(204) @BodyDoc(s.recent) viewed(
    @Req() r: any,
    @Body(new Validate(s.recent)) d: any,
  ) {
    return this.service.viewed(r.user.id, d);
  }
}
