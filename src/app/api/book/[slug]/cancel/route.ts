import { NextResponse } from "next/server";
import { addActivity, timestamp } from "@/lib/domain";
import { findWorkspace, listWorkspaceIds, updateWorkspace } from "@/lib/server-store";
import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, init?: ResponseInit, request?: Request) {
  return NextResponse.json(body, { ...init, headers: { ...corsHeadersFor(request), ...init?.headers } });
}

async function locate(slug: string) {
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 72);
  for (const workspaceId of await listWorkspaceIds()) {
    const state = await findWorkspace(workspaceId);
    if (state?.bookingSettings?.slug === normalizedSlug) return { workspaceId };
  }
  return null;
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(request) });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await locate(slug);
  if (!result) return json({ error: "Booking page not found." }, { status: 404 }, request);
  let body: { confirmationToken?: unknown };
  try { body = await request.json() as typeof body; } catch { return json({ error: "Request body must be valid JSON." }, { status: 400 }, request); }
  const token = String(body.confirmationToken || "").trim();
  if (!token || token.length > 120) return json({ error: "Confirmation token is required." }, { status: 400 }, request);
  try {
    await updateWorkspace(result.workspaceId, (state) => {
      const booking = state.bookings.find((candidate) => candidate.confirmationToken === token);
      if (!booking) throw new Error("Booking not found.");
      if (booking.status === "cancelled") return state;
      booking.status = "cancelled";
      booking.cancelledAt = timestamp();
      addActivity(state, { type: "lead", title: `${booking.name} cancelled a conversation`, detail: `${booking.email} · ${booking.startAt}` });
      return state;
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "The booking could not be cancelled." }, { status: 404 }, request);
  }
  return json({ ok: true }, undefined, request);
}
