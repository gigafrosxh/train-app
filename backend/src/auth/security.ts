import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import { fail } from "../common/errors";
export const Public = () => SetMetadata("public", true);
export const Roles = (...roles: string[]) => SetMetadata("roles", roles);
export const PasswordAccess = () => SetMetadata("passwordAccess", true);
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private reflector: Reflector,
    @Inject(AuthService) private auth: AuthService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride("public", targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    req.user = await this.auth.authenticate(
      (req.headers.authorization ?? "").replace(/^Bearer /, ""),
    );
    if (
      req.user.mustChangePassword &&
      !this.reflector.getAllAndOverride("passwordAccess", targets)
    )
      fail(403, "AUTH_PASSWORD_CHANGE_REQUIRED", "Change your password first.");
    const roles = this.reflector.getAllAndOverride<string[]>("roles", targets);
    if (roles && !roles.includes(req.user.role))
      fail(403, "AUTH_FORBIDDEN", "You do not have permission.");
    return true;
  }
}
const mac = (v: string) =>
  createHmac("sha256", process.env.CSRF_SECRET!).update(v).digest("base64url");
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function csrfBootstrap(req: Request, res: Response) {
  const binding = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const payload = nonce + "." + Date.now();
  const token = payload + "." + mac(binding + "." + payload);
  const secure = process.env.NODE_ENV === "production";
  res.cookie("CSRF-BINDING", binding, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 86400000,
  });
  res.cookie("XSRF-TOKEN", token, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 86400000,
  });
}
const buckets = new Map<string, { count: number; until: number }>();
export function security(req: Request, res: Response, next: NextFunction) {
  try {
    const origins = (
      process.env.ALLOWED_ORIGINS ??
      "http://localhost:4200,http://localhost:3000"
    ).split(",");
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin))
      fail(403, "AUTH_ORIGIN_REJECTED", "Origin is not allowed.");
    // Streng begrenzt sind nur Passwort-Endpunkte (Brute Force). CSRF-Bootstrap und
    // Refresh laufen bei jedem Seitenaufruf und zählen zum allgemeinen Kontingent.
    const credential =
      /^\/api\/v1\/auth\/(login|register)$/.test(req.path) ||
      req.path === "/api/v1/me/password";
    const key = req.ip + ":" + (credential ? "auth" : "api");
    const now = Date.now();
    for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
    const b = buckets.get(key) ?? { count: 0, until: now + 60000 };
    b.count++;
    buckets.set(key, b);
    if (b.count > (key.endsWith("auth") ? 40 : 600))
      fail(429, "RATE_LIMITED", "Too many requests. Try again shortly.");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.path.startsWith("/api/v1/ingestion/")
    ) {
      const t = req.headers["x-xsrf-token"];
      const cookie = req.cookies?.["XSRF-TOKEN"];
      const binding = req.cookies?.["CSRF-BINDING"];
      if (typeof t !== "string" || t !== cookie || !binding)
        fail(403, "AUTH_CSRF_INVALID", "Reload the page and try again.");
      const parts = t.split(".");
      if (
        parts.length !== 3 ||
        !Number.isFinite(Number(parts[1])) ||
        now - Number(parts[1]) > 86400000 ||
        Number(parts[1]) > now ||
        !equal(parts[2], mac(binding + "." + parts[0] + "." + parts[1]))
      )
        fail(403, "AUTH_CSRF_INVALID", "Reload the page and try again.");
    }
    next();
  } catch (e) {
    next(e);
  }
}
