import { test } from "node:test";
import assert from "node:assert/strict";
import { localTime, chronological, operates } from "../src/rail/time";
import { along, locate } from "../src/map/geometry";
import { Validate } from "../src/common/validation";
import { register } from "../src/auth/auth.schemas";
test("DST gap is rejected rather than silently shifted", () => {
  assert.throws(
    () => localTime("2026-03-29", 9000, "Europe/Vienna"),
    (e: any) => e.getResponse().code === "SCHEDULE_TIME_NONEXISTENT",
  );
});
test("DST overlap requires explicit policy and distinguishes both instants", () => {
  assert.throws(
    () => localTime("2026-10-25", 9000, "Europe/Vienna"),
    (e: any) => e.getResponse().code === "SCHEDULE_TIME_AMBIGUOUS",
  );
  assert.equal(
    localTime("2026-10-25", 9000, "Europe/Vienna", "EARLIER"),
    "2026-10-25T00:30:00.000Z",
  );
  assert.equal(
    localTime("2026-10-25", 9000, "Europe/Vienna", "LATER"),
    "2026-10-25T01:30:00.000Z",
  );
});
test("overnight offsets use local calendar days", () => {
  assert.equal(
    localTime("2026-03-28", 86400 + 4 * 3600, "Europe/Vienna"),
    "2026-03-29T02:00:00.000Z",
  );
});
test("calendar exception overrides weekdays", () => {
  assert.equal(
    operates(
      { weekdays: [3], exceptions: [{ date: "2026-10-14", runs: false }] },
      "2026-10-14",
    ),
    false,
  );
});
test("negative travel duration is rejected", () => {
  assert.throws(() =>
    chronological([
      { scheduledDeparture: "2026-10-14T12:00:00Z" },
      { scheduledArrival: "2026-10-14T11:00:00Z" },
    ]),
  );
});
test("position follows polyline bend rather than shortcut", () => {
  const line: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
  ];
  const p = along(line, 0.75);
  assert.ok(Math.abs(p.coordinates[0] - 1) < 0.001);
  assert.ok(Math.abs(p.coordinates[1] - 0.5) < 0.01);
  assert.ok(Math.abs(locate(line, [1, 0.5]).fraction - 0.75) < 0.01);
});
test("registration cannot assign privileged roles", () => {
  assert.throws(() =>
    new Validate(register).transform({
      email: "a@example.test",
      password: "long-enough-password",
      displayName: "Test",
      role: "ADMIN",
    }),
  );
});
