import { NextResponse } from "next/server";
import { authenticateWidget, widgetCorsHeaders, widgetEmployee } from "@/lib/widget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function keyFromRequest(request: Request) {
  return request.headers.get("x-perpendicular-widget-key") || new URL(request.url).searchParams.get("key") || "";
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(request) });
}

export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const connection = await authenticateWidget(workspaceId, keyFromRequest(request));
  if (!connection) return NextResponse.json({ error: "Widget key is invalid or the widget is disabled." }, { status: 401, headers: widgetCorsHeaders(request) });
  const employee = widgetEmployee(connection.state);
  if (!employee) return NextResponse.json({ error: "This workspace has no live operator." }, { status: 409, headers: widgetCorsHeaders(request) });
  return NextResponse.json({
    workspaceId,
    greeting: connection.state.widget.greeting,
    employee: { id: employee.id, name: employee.name, title: employee.title, avatar: employee.avatar },
  }, { headers: widgetCorsHeaders(request) });
}

