import { NextResponse } from "next/server";
import { consumeOAuthState, recordAuditEvent, recordIntegrationHealth, saveGmailConnection } from "@/lib/integration-store";
import { exchangeGoogleCode, googleProfile, watchGmail } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const destination = process.env.PERPENDICULAR_WEB_ORIGIN || "https://perpendicular.bluebloodstudio.com";
  if (!code || !state) return NextResponse.redirect(`${destination}/?gmail=error`);

  try {
    const oauthState = await consumeOAuthState(state, "google-gmail");
    const token = await exchangeGoogleCode(code, oauthState.codeVerifier);
    const profile = await googleProfile(token.accessToken);
    await saveGmailConnection({
      workspaceId: oauthState.workspaceId,
      accountEmail: profile.email,
      providerAccountId: profile.id,
      refreshToken: token.refresh_token as string,
      scopes: (token.scope || "").split(" ").filter(Boolean),
    });
    if (process.env.GMAIL_PUBSUB_TOPIC) {
      try { await watchGmail(oauthState.workspaceId); }
      catch (error) { await recordIntegrationHealth(oauthState.workspaceId, "gmail", "degraded", "watch_registration_failed", error instanceof Error ? error.message : "Gmail watch registration failed."); }
    }
    let auditWarning = false;
    try {
      await recordAuditEvent({
        workspaceId: oauthState.workspaceId,
        actorId: oauthState.userId,
        action: "integration.connected",
        resourceType: "integration",
        resourceId: "gmail",
        metadata: { provider: "google", accountEmail: profile.email },
      });
    } catch {
      auditWarning = true;
    }
    return NextResponse.redirect(`${destination}/?gmail=connected${auditWarning ? "&audit=warning" : ""}`);
  } catch {
    return NextResponse.redirect(`${destination}/?gmail=error`);
  }
}
