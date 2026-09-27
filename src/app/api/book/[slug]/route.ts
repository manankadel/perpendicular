import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { addActivity, createId, timestamp, type MeetingBooking } from "@/lib/domain";
import { bookingEmailIsValid, bookingSlotForStart, availableBookingSlots, chooseRoundRobinHost } from "@/lib/booking";
import { findWorkspace, listWorkspaceIds, updateWorkspace } from "@/lib/server-store";
import { corsHeadersFor } from "@/lib/cors";
import { consumeApiKeyRateLimitPersistent } from "@/lib/rate-limit";
import { widgetKeyHash } from "@/lib/widget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, init?: ResponseInit, request?: Request) {
  return NextResponse.json(body, { ...init, headers: { ...corsHeadersFor(request), ...init?.headers } });
}

function safeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 72);
}

async function locate(slug: string) {
  const normalizedSlug = safeSlug(slug);
  for (const workspaceId of await listWorkspaceIds()) {
    const state = await findWorkspace(workspaceId);
    if (state?.bookingSettings?.enabled && state.bookingSettings.slug === normalizedSlug) return { workspaceId, state };
  }
  return null;
}

async function rateLimit(workspaceId: string, slug: string) {
  return consumeApiKeyRateLimitPersistent(widgetKeyHash(`booking:${workspaceId}:${slug}`), workspaceId);
}

function publicPage(result: NonNullable<Awaited<ReturnType<typeof locate>>>) {
  const settings = result.state.bookingSettings;
  if (!settings) return null;
  const liveHostIds = settings.hostEmployeeIds.filter((hostId) => result.state.employees.some((employee) => employee.id === hostId && employee.status === "live"));
  const slots = availableBookingSlots({ ...settings, hostEmployeeIds: liveHostIds }, result.state.bookings).map(({ startAt, endAt }) => ({ startAt, endAt }));
  return {
    title: settings.title,
    description: settings.description,
    durationMinutes: settings.durationMinutes,
    timezone: settings.timezone,
    bookingWindowDays: settings.bookingWindowDays,
    slots,
  };
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await locate(slug);
  if (!result) return json({ error: "Booking page not found or is paused." }, { status: 404 }, request);
  const decision = await rateLimit(result.workspaceId, safeSlug(slug));
  if (!decision.allowed) return json({ error: "This booking page is receiving too many requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } }, request);
  return json(publicPage(result), { headers: { "x-rate-limit-limit": String(decision.limit), "x-rate-limit-remaining": String(decision.remaining) } }, request);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await locate(slug);
  if (!result) return json({ error: "Booking page not found or is paused." }, { status: 404 }, request);
  const decision = await rateLimit(result.workspaceId, safeSlug(slug));
  if (!decision.allowed) return json({ error: "This booking page is receiving too many requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } }, request);
  let body: { name?: unknown; email?: unknown; company?: unknown; notes?: unknown; startAt?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: "Request body must be valid JSON." }, { status: 400 }, request);
  }
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const company = String(body.company || "").trim().slice(0, 160);
  const notes = String(body.notes || "").trim().slice(0, 2000);
  const startAt = String(body.startAt || "").trim();
  if (name.length < 2 || name.length > 160) return json({ error: "Add your name." }, { status: 400 }, request);
  if (!bookingEmailIsValid(email)) return json({ error: "Add a valid email address." }, { status: 400 }, request);
  if (!startAt) return json({ error: "Choose an available time." }, { status: 400 }, request);
  const bookingId = createId("booking");
  const confirmationToken = randomUUID();
  let saved;
  try {
    saved = await updateWorkspace(result.workspaceId, (state) => {
      const settings = state.bookingSettings;
      if (!settings?.enabled) throw new Error("Booking is currently paused.");
      const activeSettings = { ...settings, hostEmployeeIds: settings.hostEmployeeIds.filter((hostId) => state.employees.some((employee) => employee.id === hostId && employee.status === "live")) };
      const slot = bookingSlotForStart(activeSettings, state.bookings, startAt);
      if (!slot) throw new Error("That time was just booked. Choose another available slot.");
      const hostEmployeeId = chooseRoundRobinHost(activeSettings, slot.availableHostIds);
      if (!hostEmployeeId) throw new Error("No operator is available for that time.");
      const created: MeetingBooking = {
        id: bookingId,
        confirmationToken,
        name,
        email,
        company,
        notes,
        hostEmployeeId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        timezone: activeSettings.timezone,
        status: "confirmed",
        source: "public",
        createdAt: timestamp(),
        cancelledAt: null,
      };
      state.bookings.unshift(created);
      state.bookings = state.bookings.slice(0, 500);
      state.bookingSettings = { ...settings, roundRobinCursor: activeSettings.hostEmployeeIds.indexOf(hostEmployeeId) + 1, updatedAt: timestamp() };
      const host = state.employees.find((employee) => employee.id === hostEmployeeId);
      addActivity(state, { type: "lead", title: `${name} booked a conversation`, detail: `${new Date(slot.startAt).toLocaleString()} · ${host?.name || "operator"}` });
      return state;
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The booking could not be created." }, { status: 409 }, request);
  }
  const created = saved?.bookings.find((booking) => booking.id === bookingId) || null;
  if (!created) return json({ error: "The booking could not be created." }, { status: 500 }, request);
  return json({ booking: { ...created, confirmationToken: created.confirmationToken }, calendarUrl: `/api/book/${encodeURIComponent(safeSlug(slug))}/calendar?token=${encodeURIComponent(created.confirmationToken)}` }, { status: 201 }, request);
}
