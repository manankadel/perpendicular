import test from "node:test";
import assert from "node:assert/strict";
import { creditForecast } from "@/lib/usage-forecast";

test("credit forecast projects the 90 percent and exhaustion dates from ledger burn", () => {
  const now = Date.parse("2026-09-27T00:00:00.000Z");
  const forecast = creditForecast({ limit: 100, remaining: 70, used: 30, periodStart: "2026-09-17T00:00:00.000Z", now });
  assert.equal(forecast.dailyBurn, 3);
  assert.equal(forecast.ninetyPercentAt, "2026-10-17T00:00:00.000Z");
  assert.equal(forecast.exhaustedAt, "2026-10-20T08:00:00.000Z");
});

test("credit forecast stays empty until there is measurable burn", () => {
  assert.deepEqual(creditForecast({ limit: 100, remaining: 100, used: 0, periodStart: "2026-09-27T00:00:00.000Z", now: Date.parse("2026-09-27T00:00:00.000Z") }), { dailyBurn: 0, ninetyPercentAt: null, exhaustedAt: null });
});
