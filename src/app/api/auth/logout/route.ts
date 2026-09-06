import { corsHeadersFor } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = new Headers(corsHeadersFor(request));
  headers.append("set-cookie", "payload-token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=.bluebloodstudio.com; Secure; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "bb_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=.bluebloodstudio.com; Secure; HttpOnly; SameSite=Lax");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
}
