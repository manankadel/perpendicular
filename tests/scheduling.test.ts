import test from "node:test";
import assert from "node:assert/strict";
import { nextScheduleAt, scheduleWindowAllows } from "@/lib/scheduling";
import type { ScheduledWork } from "@/lib/domain";

const schedule: ScheduledWork = {
  id: "schedule-test",
  name: "Test",
  description: "Test",
  employeeId: null,
  cadence: "daily",
  nextRunAt: "2026-09-28T09:00:00.000Z",
  active: true,
  lastRunAt: null,
  runCount: 0,
  createdAt: "2026-09-27T00:00:00.000Z",
  activeHours: { start: "09:00", end: "17:00" },
  weekdays: [1, 2, 3, 4, 5],
};

test("scheduled work respects active hours and weekdays", () => {
  assert.equal(scheduleWindowAllows(schedule, "UTC", new Date("2026-09-28T10:00:00.000Z")), true);
  assert.equal(scheduleWindowAllows(schedule, "UTC", new Date("2026-09-28T18:00:00.000Z")), false);
  assert.equal(scheduleWindowAllows(schedule, "UTC", new Date("2026-09-27T10:00:00.000Z")), false);
});

test("scheduled cadence advances from the completed run", () => {
  assert.equal(nextScheduleAt("hourly", Date.parse("2026-09-27T10:00:00.000Z")), "2026-09-27T11:00:00.000Z");
});
