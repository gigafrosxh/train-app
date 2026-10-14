import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { Public, csrfBootstrap } from "./security";
import { BodyDoc, ResponseDoc, Validate } from "../common/validation";
import { login, register, authResponse, userSchema } from "./auth.schemas";
@ApiTags("Authentication")
@Public()
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  @Get("csrf") @HttpCode(204) csrf(
    @Req() r: any,
    @Res({ passthrough: true }) s: Response,
  ) {
    csrfBootstrap(r, s);
  }
  @Post("register") @BodyDoc(register) @ResponseDoc(userSchema, 201) register(
    @Body(new Validate(register)) d: any,
  ) {
    return this.auth.register(d);
  }
  private send(r: any, res: Response) {
    const { refreshToken, ...body } = r;
    res.cookie("REFRESH-TOKEN", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/v1/auth",
      maxAge: 7 * 86400000,
    });
    return body;
  }
  @Post("login")
  @HttpCode(200)
  @BodyDoc(login)
  @ResponseDoc(authResponse)
  async login(
    @Body(new Validate(login)) d: any,
    @Res({ passthrough: true }) s: Response,
  ) {
    return this.send(await this.auth.login(d), s);
  }
  @Post("refresh") @HttpCode(200) @ResponseDoc(authResponse) async refresh(
    @Req() r: any,
    @Res({ passthrough: true }) s: Response,
  ) {
    return this.send(await this.auth.refresh(r.cookies?.["REFRESH-TOKEN"]), s);
  }
  @Post("logout") @HttpCode(204) async logout(
    @Req() r: any,
    @Res({ passthrough: true }) s: Response,
  ) {
    await this.auth.logout(r.cookies?.["REFRESH-TOKEN"]);
    s.clearCookie("REFRESH-TOKEN", { path: "/api/v1/auth" });
  }
}
