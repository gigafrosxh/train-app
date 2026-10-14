import { Temporal } from "@js-temporal/polyfill";
import { fail } from "../common/errors";
export function localTime(
  day: string,
  seconds: number,
  zone: string,
  choice = "REJECT",
): string {
  const local = Temporal.PlainDate.from(day)
    .add({ days: Math.floor(seconds / 86400) })
    .toPlainDateTime()
    .add({ seconds: seconds % 86400 });
  const fields = {
    timeZone: zone,
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    minute: local.minute,
    second: local.second,
  };
  const early = Temporal.ZonedDateTime.from(fields, {
      disambiguation: "earlier",
    }),
    late = Temporal.ZonedDateTime.from(fields, { disambiguation: "later" });
  if (
    !early.toPlainDateTime().equals(local) ||
    !late.toPlainDateTime().equals(local)
  )
    fail(
      400,
      "SCHEDULE_TIME_NONEXISTENT",
      `Local time ${local} does not exist in ${zone}.`,
    );
  if (early.epochMilliseconds !== late.epochMilliseconds && choice === "REJECT")
    fail(
      400,
      "SCHEDULE_TIME_AMBIGUOUS",
      `Local time ${local} occurs twice in ${zone}. Choose EARLIER or LATER.`,
    );
  return new Date(
    (choice === "LATER" ? late : early).epochMilliseconds,
  ).toISOString();
}
export const localToday = (zone = "Europe/Vienna") =>
  Temporal.Now.plainDateISO(zone).toString();
export const addDays = (d: string, n: number) =>
  Temporal.PlainDate.from(d).add({ days: n }).toString();
export const operates = (s: any, day: string) =>
  s.exceptions.find((e: any) => e.date === day)?.runs ??
  s.weekdays.includes(Temporal.PlainDate.from(day).dayOfWeek);
export function windowFor(zone: string) {
  const today = localToday(zone);
  return {
    from: localTime(today, 0, zone, "EARLIER"),
    to: localTime(addDays(today, 14), 0, zone, "EARLIER"),
  };
}
export function chronological(stops: any[], expected = false) {
  let previous = -Infinity;
  for (const s of stops) {
    for (const kind of ["Arrival", "Departure"]) {
      const value = expected
        ? (s["actual" + kind] ?? s["expected" + kind] ?? s["scheduled" + kind])
        : s["scheduled" + kind];
      if (value) {
        const time = Date.parse(value);
        if (time < previous)
          fail(
            400,
            "SCHEDULE_TIME_ORDER_INVALID",
            "Stop times must be chronological.",
          );
        previous = time;
      }
    }
  }
  if (!stops[0]?.scheduledDeparture || !stops.at(-1)?.scheduledArrival)
    fail(
      400,
      "VALIDATION_FAILED",
      "First departure and final arrival are required.",
    );
}
