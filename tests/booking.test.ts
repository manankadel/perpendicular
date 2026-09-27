import test from "node:test";
import assert from "node:assert/strict";
import { availableBookingSlots, bookingEmailIsValid, chooseRoundRobinHost, defaultBookingSettings, normalizeBookingSettings } from "../src/lib/booking";
import type { MeetingBooking } from "../src/lib/domain";

function settings() {
  return normalizeBookingSettings({
    ...defaultBookingSettings("UTC"),
    enabled: true,
    slug: "meet",
    hostEmployeeIds: ["emp-a", "emp-b"],
    roundRobinCursor: 0,
    availability: { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "11:00" },
    durationMinutes: 30,
    bufferMinutes: 10,
    bookingWindowDays: 5,
  })!;
}

test("booking slots honor timezone, working days, duration, and buffer", () => {
  const slots = availableBookingSlots(settings(), [], Date.parse("2026-09-27T08:00:00.000Z"));
  assert.equal(slots[0]?.startAt, "2026-09-28T09:00:00.000Z");
  assert.equal(slots[1]?.startAt, "2026-09-28T09:40:00.000Z");
  assert.ok(slots.every((slot) => new Date(slot.endAt).getTime() - new Date(slot.startAt).getTime() === 30 * 60_000));
  assert.ok(slots.every((slot) => new Date(slot.startAt).getUTCDay() !== 0 && new Date(slot.startAt).getUTCDay() !== 6));
});

test("booking slots remove a conflicted host but keep a slot when another host is free", () => {
  const booking: MeetingBooking = {
    id: "booking-1", confirmationToken: "token", name: "A", email: "a@example.com", company: "", notes: "", hostEmployeeId: "emp-a", startAt: "2026-09-28T09:00:00.000Z", endAt: "2026-09-28T09:30:00.000Z", timezone: "UTC", status: "confirmed", source: "public", createdAt: "2026-09-27T08:00:00.000Z", cancelledAt: null,
  };
  const slots = availableBookingSlots(settings(), [booking], Date.parse("2026-09-27T08:00:00.000Z"));
  assert.deepEqual(slots.find((slot) => slot.startAt === booking.startAt)?.availableHostIds, ["emp-b"]);
  assert.equal(chooseRoundRobinHost({ ...settings(), roundRobinCursor: 1 }, ["emp-a", "emp-b"]), "emp-b");
});

test("booking settings normalize unsafe values and email validation stays strict", () => {
  const normalized = normalizeBookingSettings({ ...defaultBookingSettings(), slug: "  Demo booking!! ", durationMinutes: 999, bufferMinutes: 999, bookingWindowDays: 999, availability: { weekdays: [1, 1, 9], start: "10:00", end: "09:00" }, hostEmployeeIds: ["emp-a", "emp-a"] });
  assert.equal(normalized?.slug, "demo-booking");
  assert.equal(normalized?.durationMinutes, 30);
  assert.equal(normalized?.bookingWindowDays, 60);
  assert.deepEqual(normalized?.hostEmployeeIds, ["emp-a"]);
  assert.equal(bookingEmailIsValid("operator@example.com"), true);
  assert.equal(bookingEmailIsValid("operator@example"), false);
});
