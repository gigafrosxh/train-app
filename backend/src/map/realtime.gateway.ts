import { Inject, OnModuleDestroy } from "@nestjs/common";
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthService } from "../auth/auth.service";
import { Events } from "../common/events";
import { RailService } from "../rail/rail.service";
import { MapService } from "./map.service";
import { bbox } from "./map.schemas";
import { inside } from "./geometry";
import { fail } from "../common/errors";
const trips = z.object({ tripIds: z.array(z.uuid()).max(100) }).strict();
const subscription = z
  .object({
    subscriptionId: z.uuid(),
    country: z.string().regex(/^[A-Z]{2}$/),
    bbox: bbox.optional(),
  })
  .strict();
@WebSocketGateway({
  path: "/socket.io",
  cors: {
    origin: (origin: any, cb: any) =>
      cb(
        null,
        !origin ||
          (
            process.env.ALLOWED_ORIGINS ??
            "http://localhost:4200,http://localhost:3000"
          )
            .split(",")
            .includes(origin),
      ),
    credentials: true,
  },
})
export class RealtimeGateway implements OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private clients = new Set<Socket>();
  private queue: Promise<any> = Promise.resolve();
  constructor(
    @Inject(AuthService) private auth: AuthService,
    @Inject(Events) private events: Events,
    @Inject(RailService) private rail: RailService,
    @Inject(MapService) private map: MapService,
  ) {
    events.on("trip.updated", (t: any) => {
      void this.broadcastTrip(t);
      void this.map.refresh().catch(() => {});
    });
    events.on("schedule.updated", (s: any) => {
      void this.broadcastSchedule(s);
    });
    events.on("map.position", (e: any) => {
      this.queue = this.queue.then(() => this.position(e)).catch(() => {});
    });
  }
  private async check(s: Socket) {
    try {
      const u = await this.auth.authenticate(
        s.handshake.auth?.accessToken ?? "",
      );
      if (u.mustChangePassword) throw new Error();
      return u;
    } catch {
      s.disconnect(true);
      return null;
    }
  }
  async handleConnection(s: Socket) {
    const u = await this.check(s);
    if (!u) return;
    s.data.tripIds = new Set<string>();
    s.data.expires = setTimeout(
      () => s.disconnect(true),
      Math.max(1, u.expiresAt - Date.now()),
    );
    this.clients.add(s);
  }
  handleDisconnect(s: Socket) {
    clearTimeout(s.data.expires);
    this.clients.delete(s);
  }
  onModuleDestroy() {
    for (const s of this.clients) s.disconnect(true);
  }
  private async action(s: Socket, fn: () => Promise<any>) {
    try {
      if (!(await this.check(s)))
        return {
          ok: false,
          error: { code: "AUTH_SESSION_EXPIRED", message: "Sign in again." },
        };
      const now = Date.now();
      if (!s.data.bucket || s.data.bucket.until < now)
        s.data.bucket = { n: 0, until: now + 60000 };
      if (++s.data.bucket.n > 180)
        fail(429, "RATE_LIMITED", "Too many subscriptions.");
      return await fn();
    } catch (e: any) {
      return {
        ok: false,
        error: {
          code: e.getResponse?.()?.code ?? "VALIDATION_FAILED",
          message: "Subscription could not be applied.",
        },
      };
    }
  }
  @SubscribeMessage("trips.subscribe") subscribe(
    @ConnectedSocket() s: Socket,
    @MessageBody() d: any,
  ) {
    return this.action(s, async () => {
      const q = trips.parse(d);
      const ids = new Set<string>([...(s.data.tripIds ?? []), ...q.tripIds]);
      if (ids.size > 100) throw new Error();
      for (const id of q.tripIds) await this.rail.trip(id);
      s.data.tripIds = ids;
      return { ok: true };
    });
  }
  @SubscribeMessage("trips.unsubscribe") unsubscribe(
    @ConnectedSocket() s: Socket,
    @MessageBody() d: any,
  ) {
    return this.action(s, async () => {
      for (const id of trips.parse(d).tripIds) s.data.tripIds?.delete(id);
      return { ok: true };
    });
  }
  @SubscribeMessage("map.subscribe") mapSubscribe(
    @ConnectedSocket() s: Socket,
    @MessageBody() d: any,
  ) {
    return this.action(s, async () => {
      const q = subscription.parse(d);
      await this.rail.country(q.country);
      s.data.map = q;
      return { ok: true, subscriptionId: q.subscriptionId };
    });
  }
  @SubscribeMessage("map.unsubscribe") mapUnsubscribe(
    @ConnectedSocket() s: Socket,
    @MessageBody() d: any,
  ) {
    return this.action(s, async () => {
      z.object({}).strict().parse(d);
      s.data.map = null;
      return { ok: true };
    });
  }
  private envelope(id: string, version: number, data: any) {
    return {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      entityId: id,
      version,
      data,
    };
  }
  private async broadcastTrip(t: any) {
    for (const s of this.clients)
      if (s.data.tripIds?.has(t.id) && (await this.check(s)))
        s.emit("trip.updated", this.envelope(t.id, t.version, t));
  }
  private async broadcastSchedule(t: any) {
    const route = await this.rail.route(t.routeId);
    const c = await this.rail.db.one(
      "SELECT c.country FROM lines l JOIN companies c ON c.id=l.company_id WHERE l.id=$1",
      [route.lineId],
    );
    for (const s of this.clients)
      if (await this.check(s))
        s.emit(
          "schedule.updated",
          this.envelope(t.id, t.version, {
            scheduleId: t.id,
            country: c.country,
            affectedTripIds: [],
            requiresRefetch: true,
          }),
        );
  }
  private async position(e: any) {
    const { country, ...item } = e.item;
    for (const s of this.clients) {
      if (!(await this.check(s))) continue;
      if (s.data.tripIds?.has(item.tripId))
        s.emit(
          "trip.position.updated",
          this.envelope(item.tripId, item.positionVersion, item),
        );
      const m = s.data.map;
      if (!m) continue;
      const before =
        e.old &&
        e.old.country === m.country &&
        inside(e.old.coordinates, m.bbox);
      const after = country === m.country && inside(item.coordinates, m.bbox);
      if (after || before)
        s.emit(after ? "trip.position.updated" : "map.train.removed", {
          ...this.envelope(
            item.tripId,
            item.positionVersion,
            after ? item : { tripId: item.tripId },
          ),
          subscriptionId: m.subscriptionId,
          mapRevision: e.revision,
        });
    }
  }
}
