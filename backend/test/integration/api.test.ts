import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { io, Socket } from "socket.io-client";
import { createApp } from "../../src/bootstrap";
import { source } from "../../src/database/database";
import { seedId } from "../../scripts/seed";
let app: any, server: any, user: any, worker: any, admin: any;
async function login(role: string) {
  const agent = request.agent(server);
  const csrf = await agent.get("/api/v1/auth/csrf").expect(204);
  const cookies = csrf.headers["set-cookie"] as unknown as string[];
  const token = decodeURIComponent(
    cookies
      .find((c) => c.startsWith("XSRF-TOKEN="))!
      .split(";")[0]
      .slice(11),
  );
  const result = await agent
    .post("/api/v1/auth/login")
    .set("X-XSRF-TOKEN", token)
    .send({
      email: role + "@rail-demo.local",
      password: process.env.DEMO_PASSWORD,
    })
    .expect(200);
  return {
    agent,
    csrf: token,
    access: result.body.accessToken,
    user: result.body.user,
    refresh: result.headers["set-cookie"],
    csrfCookies: cookies.map((c) => c.split(";")[0]),
  };
}
const get = (a: any, url: string) =>
  a.agent.get("/api/v1" + url).set("Authorization", "Bearer " + a.access);
const change = (a: any, method: string, url: string, body: any) =>
  a.agent[method]("/api/v1" + url)
    .set("Authorization", "Bearer " + a.access)
    .set("X-XSRF-TOKEN", a.csrf)
    .send(body);
before(async () => {
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /train_app_test_/);
  process.env.DISABLE_JOBS = "true";
  ({ app } = await createApp({ logger: false }));
  await app.listen(0, "127.0.0.1");
  server = app.getHttpServer();
  user = await login("user");
  worker = await login("worker");
  admin = await login("admin");
});
after(async () => {
  await app?.close();
});
test("all domain endpoints require login", async () => {
  await request(server).get("/api/v1/trips").expect(401);
  await request(server).get("/api/v1/map/railways").expect(401);
});
test("registration rejects roles and requests without CSRF", async () => {
  await request(server).post("/api/v1/auth/register").send({}).expect(403);
  await change(user, "post", "/auth/register", {
    email: "test@example.test",
    password: "test-password-123",
    displayName: "Test",
    role: "ADMIN",
  }).expect(400);
});
test("normal user and worker cannot edit setup", async () => {
  await change(user, "post", "/admin/companies", {
    name: "Bad",
    code: "BAD",
    country: "AT",
  }).expect(403);
  await change(worker, "post", "/admin/companies", {
    name: "Bad",
    code: "BAD",
    country: "AT",
  }).expect(403);
});
test("all admin resource lists return a consistent page", async () => {
  for (const resource of [
    "companies",
    "trains",
    "stations",
    "tracks",
    "lines",
    "routes",
    "schedules",
    "trips",
    "users",
    "worker-assignments",
  ]) {
    const r = await get(admin, "/admin/" + resource).expect(200);
    assert.ok(Array.isArray(r.body.items), resource);
    assert.ok(r.body.total > 0, resource);
  }
});
test("dashboard has next ticket and private ticket ownership", async () => {
  const r = await get(user, "/me/dashboard").expect(200);
  assert.ok(r.body.nextTrip);
  assert.equal(r.body.activeTickets[0].verified, false);
  await get(worker, "/me/tickets/" + r.body.activeTickets[0].id).expect(404);
});
test("profile preserves other preferences and rejects role escalation", async () => {
  const r = await change(user, "patch", "/me", {
    preferences: { language: "en" },
  }).expect(200);
  assert.equal(r.body.preferences.theme, "system");
  assert.equal(r.body.preferences.language, "en");
  await change(user, "patch", "/me", { role: "ADMIN" }).expect(400);
});
test("worker filters assignments and rejects unauthorized train changes", async () => {
  const r = await get(worker, "/operations/trips").expect(200);
  assert.ok(r.body.items.length);
  assert.ok(r.body.items.every((t: any) => t.trainId === seedId("train0")));
  const other = await get(admin, "/trips?trainId=" + seedId("train1")).expect(
    200,
  );
  const t = other.body.items[0];
  await change(worker, "patch", "/operations/trips/" + t.id, {
    version: t.version,
    delaySeconds: 120,
  }).expect(403);
});
test("worker updates are visible to users and stale versions conflict", async () => {
  const list = await get(worker, "/operations/trips").expect(200);
  const t = list.body.items[0];
  const updated = await change(worker, "patch", "/operations/trips/" + t.id, {
    version: t.version,
    delaySeconds: 300,
    reasonCode: "WEATHER",
  }).expect(200);
  assert.equal(updated.body.delaySeconds, 300);
  assert.equal(updated.body.version, t.version + 1);
  const visible = await get(user, "/trips/" + t.id).expect(200);
  assert.equal(visible.body.delaySeconds, 300);
  await change(worker, "patch", "/operations/trips/" + t.id, {
    version: t.version,
    delaySeconds: 600,
  }).expect(409);
});
test("concurrent updates allow exactly one winner", async () => {
  const list = await get(worker, "/operations/trips").expect(200);
  const t = list.body.items[1];
  const responses = await Promise.all(
    [120, 180].map((delaySeconds) =>
      change(worker, "patch", "/operations/trips/" + t.id, {
        version: t.version,
        delaySeconds,
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
});
test("stop update prevents reversed times and preserves transaction", async () => {
  const list = await get(worker, "/operations/trips").expect(200);
  const t = (await get(worker, "/trips/" + list.body.items[2].id)).body;
  const s = t.stops[1];
  await change(worker, "patch", `/operations/trips/${t.id}/stops/${s.id}`, {
    version: s.version,
    expectedArrival: t.scheduledArrival,
  }).expect(400);
  const same = (await get(worker, "/trips/" + t.id)).body;
  assert.equal(same.version, t.version);
});
test("board and connection search use stable halt identities", async () => {
  const s = await get(user, "/settings").expect(200);
  const r = await get(
    user,
    "/connections?fromStationId=" +
      seedId("vie") +
      "&toStationId=" +
      seedId("szg") +
      "&departAfter=" +
      encodeURIComponent(new Date().toISOString()),
  ).expect(200);
  assert.ok(r.body.items.length);
  assert.ok(r.body.items[0].legs[0].from.stopId);
  await get(user, "/stations/" + seedId("vie") + "/departures").expect(200);
});
test("ticket input validates order and forbids verified flag", async () => {
  const t = (await get(user, "/trips")).body.items[0];
  const detail = (await get(user, "/trips/" + t.id)).body;
  const d = {
    reference: "test",
    tripId: t.id,
    validFrom: t.scheduledDeparture,
    validUntil: t.scheduledArrival,
  };
  await change(user, "post", "/me/tickets", { ...d, verified: true }).expect(
    400,
  );
  await change(user, "post", "/me/tickets", {
    ...d,
    boardingStopId: detail.stops.at(-1).id,
    alightingStopId: detail.stops[0].id,
  }).expect(400);
  const created = await change(user, "post", "/me/tickets", d).expect(201);
  assert.equal(created.body.verified, false);
  await change(user, "delete", "/me/tickets/" + created.body.id, {}).expect(
    204,
  );
});
test("immutable map snapshot and filter binding", async () => {
  const r = await get(user, "/map/trains?pageSize=1").expect(200);
  assert.ok(r.body.total > 0);
  assert.ok(r.body.items[0].positionType === "ESTIMATED");
  const next = await get(
    user,
    "/map/trains?page=2&pageSize=1&snapshotToken=" + r.body.snapshotToken,
  ).expect(200);
  assert.equal(next.body.snapshotRevision, r.body.snapshotRevision);
  if (next.body.items.length)
    assert.notEqual(next.body.items[0].tripId, r.body.items[0].tripId);
  await get(
    user,
    "/map/trains?pageSize=2&snapshotToken=" + r.body.snapshotToken,
  ).expect(400);
  await get(
    worker,
    "/map/trains?pageSize=1&snapshotToken=" + r.body.snapshotToken,
  ).expect(410);
});
test("rail geometry is GeoJSON with explicit demo provenance", async () => {
  const r = await get(user, "/map/railways?country=AT").expect(200);
  assert.equal(r.body.type, "FeatureCollection");
  assert.match(r.body.metadata.source, /DEMO/);
});
test("password-change flag is enforced server-side", async () => {
  await source.query("UPDATE users SET must_change_password=true WHERE id=$1", [
    worker.user.id,
  ]);
  await get(worker, "/trips")
    .expect(403)
    .then((r) => assert.equal(r.body.code, "AUTH_PASSWORD_CHANGE_REQUIRED"));
  await get(worker, "/me").expect(200);
  await source.query(
    "UPDATE users SET must_change_password=false WHERE id=$1",
    [worker.user.id],
  );
});
test("JWT sessions are revoked after logout", async () => {
  const session = await login("worker");
  await change(session, "post", "/auth/logout", {}).expect(204);
  await get(session, "/me").expect(401);
});
test("concurrent refresh from two tabs keeps the session", async () => {
  const session = await login("user");
  const cookie = (session.refresh as string[]).map((c) => c.split(";")[0]);
  const send = () =>
    request(server)
      .post("/api/v1/auth/refresh")
      .set("Cookie", [...cookie, ...session.csrfCookies])
      .set("X-XSRF-TOKEN", session.csrf)
      .send({});
  const a = await send().expect(200);
  const b = await send().expect(200);
  await request(server)
    .get("/api/v1/me")
    .set("Authorization", "Bearer " + a.body.accessToken)
    .expect(200);
  await request(server)
    .get("/api/v1/me")
    .set("Authorization", "Bearer " + b.body.accessToken)
    .expect(200);
});
test("refresh rotation detects replay and revokes family", async () => {
  process.env.REFRESH_REUSE_GRACE_MS = "0";
  const session = await login("user");
  const old = session.refresh;
  const first = await change(session, "post", "/auth/refresh", {}).expect(200);
  const cookie = (old as string[]).map((c) => c.split(";")[0]);
  await request(server)
    .post("/api/v1/auth/refresh")
    .set("Cookie", [...cookie, ...session.csrfCookies])
    .set("X-XSRF-TOKEN", session.csrf)
    .send({})
    .expect(401);
  await request(server)
    .get("/api/v1/me")
    .set("Authorization", "Bearer " + first.body.accessToken)
    .expect(401);
  delete process.env.REFRESH_REUSE_GRACE_MS;
});
test("socket validates login and delivers worker change", async () => {
  const address = server.address();
  const socket = io("http://127.0.0.1:" + address.port, {
    auth: { accessToken: user.access },
    transports: ["websocket"],
    reconnection: false,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
      setTimeout(
        () => reject(new Error("Socket connect timeout")),
        5000,
      ).unref();
    });
    const t = (await get(worker, "/operations/trips")).body.items[3];
    const ack = await socket
      .timeout(5000)
      .emitWithAck("trips.subscribe", { tripIds: [t.id] });
    assert.equal(ack.ok, true);
    const event = new Promise<any>((resolve, reject) => {
      socket.once("trip.updated", resolve);
      setTimeout(() => reject(new Error("Socket event timeout")), 5000).unref();
    });
    await change(worker, "patch", "/operations/trips/" + t.id, {
      version: t.version,
      delaySeconds: 60,
    }).expect(200);
    assert.equal((await event).data.delaySeconds, 60);
  } finally {
    socket.disconnect();
  }
});
test("station search tolerates abbreviations, umlauts and typos", async () => {
  const names = async (q: string) =>
    (await get(user, "/stations?q=" + encodeURIComponent(q)).expect(200)).body.items.map(
      (s: any) => s.name,
    );
  assert.equal((await names("Linz Hbf"))[0], "Linz Hauptbahnhof");
  assert.equal((await names("salzbrug"))[0], "Salzburg Hauptbahnhof");
  assert.equal((await names("Sal"))[0], "Salzburg Hauptbahnhof");
  const all = await get(user, "/stations").expect(200);
  assert.ok(all.body.items.every((s: any) => s.timeZone && Array.isArray(s.aliases)));
});
test("favorite stations are stored per account in order", async () => {
  await get(user, "/me/favorite-stations").expect(200, []);
  const ids = [seedId("szg"), seedId("lnz")];
  const saved = await change(user, "put", "/me/favorite-stations", {
    stationIds: ids,
  }).expect(200);
  assert.deepEqual(saved.body.map((s: any) => s.id), ids);
  assert.ok(saved.body[0].timeZone);
  await change(user, "put", "/me/favorite-stations", {
    stationIds: [ids[0], ids[0]],
  }).expect(400);
  await change(user, "put", "/me/favorite-stations", {
    stationIds: ["00000000-0000-4000-8000-000000000000"],
  }).expect(400);
  await get(worker, "/me/favorite-stations").expect(200, []);
  const back = await get(user, "/me/favorite-stations").expect(200);
  assert.deepEqual(back.body.map((s: any) => s.id), ids);
});
test("board entries carry via stops, platform change and time zones", async () => {
  const r = await get(user, "/stations/" + seedId("vie") + "/departures").expect(200);
  const e = r.body.items[0];
  assert.ok(e, "departure expected");
  assert.equal(typeof e.platformChanged, "boolean");
  assert.ok(Array.isArray(e.via) && e.via.length <= 3);
  assert.ok(e.via.every((s: any) => s.id !== e.destination.id && s.id !== e.station.id));
  assert.ok(e.station.timeZone);
  const st = await get(user, "/stations/" + seedId("vie")).expect(200);
  assert.ok(st.body.lines.length);
});
test("connections report transfer time per leg", async () => {
  const r = await get(
    user,
    "/connections?fromStationId=" + seedId("vie") + "&toStationId=" + seedId("szg") +
      "&departAfter=" + encodeURIComponent(new Date().toISOString()),
  ).expect(200);
  const legs = r.body.items[0].legs;
  assert.equal(legs[0].transferSeconds, null);
  assert.equal(legs[0].transferAtRisk, false);
});
test("nearby stations are sorted by distance", async () => {
  const r = await get(user, "/stations/nearby?lng=14.29&lat=48.29&pageSize=2").expect(200);
  assert.equal(r.body.items[0].id, seedId("lnz"));
  assert.ok(r.body.items[0].distanceMeters < 500);
  assert.ok(r.body.items[0].distanceMeters <= r.body.items[1].distanceMeters);
  await get(user, "/stations/nearby?lng=200&lat=48").expect(400);
});
test("disruptions: admin CRUD with versions, users read active ones", async () => {
  const body = {
    country: "AT",
    severity: "WARNING",
    reasonCode: "CONSTRUCTION",
    title: "Bauarbeiten Westbahn",
    validFrom: new Date(Date.now() - 60000).toISOString(),
    stationIds: [seedId("lnz")],
  };
  await change(user, "post", "/admin/disruptions", body).expect(403);
  const created = await change(admin, "post", "/admin/disruptions", body).expect(201);
  assert.equal(created.body.version, 1);
  const atLinz = await get(user, "/disruptions?stationId=" + seedId("lnz")).expect(200);
  assert.ok(atLinz.body.items.some((d: any) => d.id === created.body.id));
  const atSalzburg = await get(user, "/disruptions?stationId=" + seedId("szg")).expect(200);
  assert.ok(!atSalzburg.body.items.some((d: any) => d.id === created.body.id));
  await change(admin, "patch", "/admin/disruptions/" + created.body.id, {
    version: 1,
    validUntil: body.validFrom,
  }).expect(400);
  const ended = await change(admin, "patch", "/admin/disruptions/" + created.body.id, {
    version: 1,
    validUntil: new Date(Date.now() - 1000).toISOString(),
  }).expect(200);
  const now = await get(user, "/disruptions").expect(200);
  assert.ok(!now.body.items.some((d: any) => d.id === created.body.id));
  await change(admin, "delete", "/admin/disruptions/" + created.body.id + "?version=1", {}).expect(409);
  await change(admin, "delete", "/admin/disruptions/" + created.body.id + "?version=" + ended.body.version, {}).expect(204);
  const log = await get(admin, "/admin/audit?entityId=" + created.body.id).expect(200);
  assert.deepEqual(
    log.body.items.map((e: any) => e.action),
    ["disruptions.delete", "disruptions.update", "disruptions.create"],
  );
  await get(worker, "/admin/audit").expect(403);
});
test("stop delay propagates to later stops on request", async () => {
  const list = await get(worker, "/operations/trips").expect(200);
  const t = (await get(worker, "/trips/" + list.body.items.at(-1).id)).body;
  const s = t.stops[0];
  const expected = new Date(Date.parse(s.scheduledDeparture) + 420000).toISOString();
  await change(worker, "patch", `/operations/trips/${t.id}/stops/${s.id}`, {
    version: s.version,
    propagate: true,
  }).expect(400);
  await change(worker, "patch", `/operations/trips/${t.id}/stops/${s.id}`, {
    version: s.version,
    expectedDeparture: expected,
    propagate: true,
  }).expect(200);
  const after = (await get(worker, "/trips/" + t.id)).body;
  for (const x of after.stops.slice(1)) {
    if (x.scheduledArrival) assert.equal(x.arrivalDelaySeconds, 420);
    if (x.scheduledDeparture) assert.equal(x.departureDelaySeconds, 420);
  }
});
test("public status reports realtime source without login", async () => {
  const r = await request(server).get("/api/v1/health/status").expect(200);
  assert.ok(["LIVE", "STALE", "SCHEDULE_ONLY"].includes(r.body.realtime));
});
