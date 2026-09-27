import { NextResponse } from "next/server";
import { findWorkspace, listWorkspaceIds } from "@/lib/server-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function escapeIcs(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function icsDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = new URL(request.url).searchParams.get("token") || "";
  const normalizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 72);
  for (const workspaceId of await listWorkspaceIds()) {
    const state = await findWorkspace(workspaceId);
    const settings = state?.bookingSettings;
    const booking = state?.bookings.find((candidate) => candidate.confirmationToken === token && candidate.status === "confirmed");
    if (!settings || settings.slug !== normalizedSlug || !booking) continue;
    const host = state?.employees.find((employee) => employee.id === booking.hostEmployeeId)?.name || "Perpendicular operator";
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Perpendicular//Open source scheduler//EN",
      "BEGIN:VEVENT",
      `UID:${booking.id}@perpendicular`,
      `DTSTAMP:${icsDate(booking.createdAt)}`,
      `DTSTART:${icsDate(booking.startAt)}`,
      `DTEND:${icsDate(booking.endAt)}`,
      `SUMMARY:${escapeIcs(settings.title)}`,
      `DESCRIPTION:${escapeIcs(`${settings.description} Host: ${host}. Notes: ${booking.notes || "None"}`)}`,
      `ATTENDEE;CN=${escapeIcs(booking.name)}:mailto:${booking.email}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    return new NextResponse(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="perpendicular-${booking.id}.ics"` } });
  }
  return NextResponse.json({ error: "Confirmed booking not found." }, { status: 404 });
}
