import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { randomBytes, createHash } from "node:crypto";
import { Database, camel } from "../database/database";
import { fail } from "../common/errors";
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export function publicUser(row: any) {
  const r = camel(row);
  return {
    id: r.id,
    email: r.email,
    displayName: r.displayName,
    role: r.role,
    preferences: r.preferences,
    mustChangePassword: r.mustChangePassword,
  };
}
@Injectable()
export class AuthService {
  private jwt = new JwtService();
  constructor(@Inject(Database) private db: Database) {}
  async register(d: any) {
    const hash = await argon2.hash(d.password);
    const r = await this.db.one(
      "INSERT INTO users(email,password_hash,display_name,role) VALUES($1,$2,$3,$4) RETURNING *",
      [d.email.toLowerCase(), hash, d.displayName, "USER"],
    );
    return publicUser(r);
  }
  async login(d: any) {
    const u = await this.db.one("SELECT * FROM users WHERE email=$1", [
      d.email.toLowerCase(),
    ]);
    if (
      !u ||
      !(await argon2.verify(u.password_hash, d.password)) ||
      u.status !== "ACTIVE"
    )
      fail(401, "AUTH_INVALID_CREDENTIALS", "Email or password is incorrect.");
    const result = await this.db.transaction(async (m) => {
      const [s] = await m.query(
        "INSERT INTO sessions(user_id,expires_at) VALUES($1,now()+interval '7 days') RETURNING *",
        [u.id],
      );
      const token = randomBytes(40).toString("base64url");
      await m.query(
        "INSERT INTO refresh_tokens(hash,session_id) VALUES($1,$2)",
        [digest(token), s.id],
      );
      await m.query("UPDATE users SET last_login_at=now() WHERE id=$1", [u.id]);
      return { s, token };
    });
    return this.response(u, result.s.id, result.token);
  }
  private async response(u: any, sid: string, refreshToken: string) {
    return {
      accessToken: await this.jwt.signAsync(
        { sub: u.id, role: u.role, sid },
        {
          secret: process.env.JWT_SECRET,
          expiresIn: 900,
          issuer: "train-app",
          audience: "train-app",
        },
      ),
      expiresIn: 900,
      user: publicUser(u),
      refreshToken,
    };
  }
  async refresh(token: string) {
    if (!token) fail(401, "AUTH_SESSION_EXPIRED", "Please sign in again.");
    const out = await this.db.transaction(async (m) => {
      const [r] = await m.query(
        "SELECT t.*,s.user_id,s.expires_at,s.revoked_at FROM refresh_tokens t JOIN sessions s ON s.id=t.session_id WHERE hash=$1 FOR UPDATE OF s,t",
        [digest(token)],
      );
      if (!r) return null;
      // Mehrere Tabs erneuern oft gleichzeitig mit demselben Cookie. Innerhalb kurzer
      // Frist ist das kein Diebstahl: neues Token derselben Sitzung ausgeben.
      const grace = Number(process.env.REFRESH_REUSE_GRACE_MS ?? 20000);
      const concurrent =
        r.used_at && Date.now() - new Date(r.used_at).getTime() < grace;
      if (r.used_at && !concurrent) {
        await m.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [
          r.session_id,
        ]);
        return null;
      }
      if (r.revoked_at || new Date(r.expires_at) <= new Date()) return null;
      const [u] = await m.query("SELECT * FROM users WHERE id=$1", [r.user_id]);
      if (!u || u.status !== "ACTIVE") return null;
      const next = randomBytes(40).toString("base64url");
      if (!r.used_at)
        await m.query("UPDATE refresh_tokens SET used_at=now() WHERE hash=$1", [
          digest(token),
        ]);
      await m.query(
        "INSERT INTO refresh_tokens(hash,session_id) VALUES($1,$2)",
        [digest(next), r.session_id],
      );
      return { u, sid: r.session_id, next };
    });
    if (!out) fail(401, "AUTH_SESSION_EXPIRED", "Please sign in again.");
    return this.response(out.u, out.sid, out.next);
  }
  async logout(token: string) {
    if (token)
      await this.db.query(
        "UPDATE sessions SET revoked_at=now() WHERE id IN (SELECT session_id FROM refresh_tokens WHERE hash=$1)",
        [digest(token)],
      );
  }
  async authenticate(token: string) {
    let p: any;
    try {
      p = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
        issuer: "train-app",
        audience: "train-app",
        algorithms: ["HS256"],
      });
    } catch {
      fail(401, "AUTH_SESSION_EXPIRED", "Please sign in again.");
    }
    const u = await this.db.one(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status=$3",
      [p.sub, p.sid, "ACTIVE"],
    );
    if (!u) fail(401, "AUTH_SESSION_EXPIRED", "Please sign in again.");
    return { ...publicUser(u), sessionId: p.sid, expiresAt: p.exp * 1000 };
  }
  async changePassword(id: string, d: any) {
    const u = await this.db.one("SELECT * FROM users WHERE id=$1", [id]);
    if (!(await argon2.verify(u.password_hash, d.currentPassword)))
      fail(400, "AUTH_INVALID_CREDENTIALS", "Current password is incorrect.");
    const hash = await argon2.hash(d.newPassword);
    await this.db.transaction(async (m) => {
      await m.query(
        "UPDATE users SET password_hash=$1,must_change_password=false,version=version+1 WHERE id=$2",
        [hash, id],
      );
      await m.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [
        id,
      ]);
    });
  }
}
