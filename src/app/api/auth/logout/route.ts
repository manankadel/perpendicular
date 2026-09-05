import { corsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const headers = new Headers(corsHeaders);
  headers.append("set-cookie", "payload-token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=.bluebloodstudio.com; Secure; HttpOnly; SameSite=Lax");
  headers.append("set-cookie", "bb_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Domain=.bluebloodstudio.com; Secure; HttpOnly; SameSite=Lax");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
