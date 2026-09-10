import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createOAuthState } from "@/lib/integration-store";
import { googleAuthorizeUrl } from "@/lib/gmail";
import { hasPermission, identityOrResponse, rejectCrossOrigin } from "@/lib/route-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function codeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

function codeChallenge(value: string) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

export async function GET(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const identity = await identityOrResponse(request);
  if ("response" in identity) return identity.response;
  if (!hasPermission(identity.context, "settings:write")) return NextResponse.json({ error: "You do not have permission to connect Gmail." }, { status: 403 });
  try {
    const verifier = codeVerifier();
    const state = await createOAuthState(identity.context.workspaceId, identity.context.userId, "google-gmail", verifier);
    return NextResponse.redirect(googleAuthorizeUrl(state, codeChallenge(verifier)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Google connection is not configured." }, { status: 503 });
  }
}
