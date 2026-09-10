import { identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";
import { watchGmail } from "@/lib/gmail";
import { corsHeadersFor, corsJson } from "@/lib/cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  try {
    const result = await watchGmail(identity.context.workspaceId);
    return corsJson({ ok: true, ...result }, undefined, request);
  } catch (error) {
    return corsJson({ error: error instanceof Error ? error.message : "Gmail watch registration failed." }, { status: 400 }, request);
  }
}

export function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: corsHeadersFor(request) }); }
