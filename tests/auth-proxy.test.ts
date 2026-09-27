import test from "node:test";
import assert from "node:assert/strict";
import { getSetCookieHeaders, proxyIdentityRequest, safeReturnPath, sanitizeAuthPayload } from "../src/lib/auth-proxy";
import { GET as startGoogle } from "../src/app/api/auth/google/start/route";

test("only accepts same-site relative return paths", () => {
  assert.equal(safeReturnPath("/"), "/");
  assert.equal(safeReturnPath("/settings?tab=auth"), "/settings?tab=auth");
  assert.equal(safeReturnPath("https://evil.example/"), "/");
  assert.equal(safeReturnPath("//evil.example/"), "/");
  assert.equal(safeReturnPath("javascript:alert(1)"), "/");
  assert.equal(safeReturnPath(null), "/");
});

test("removes identity tokens before returning auth responses to the browser", () => {
  assert.deepEqual(sanitizeAuthPayload({ message: "Authentication Passed", token: "secret", productJwt: "secret-too", user: { id: 11 }, requiresMfa: false }), {
    message: "Authentication Passed",
    user: { id: 11 },
    requiresMfa: false,
  });
});

test("forwards every Set-Cookie header from the identity response", () => {
  const headers = new Headers();
  Object.defineProperty(headers, "getSetCookie", { value: () => ["payload-token=one; Path=/", "bb_session=two; Path=/"] });
  assert.deepEqual(getSetCookieHeaders(headers), ["payload-token=one; Path=/", "bb_session=two; Path=/"]);
});

test("turns product login tokens into a browser session cookie", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ productJwt: "signed-product-session", message: "Authentication Passed" }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const response = await proxyIdentityRequest(new Request("https://perpendicular.bluebloodstudio.com/api/auth/login", { method: "POST", body: "{}" }), "/auth-login", ["email", "password"]);
    assert.match(response.headers.get("set-cookie") || "", /bb_session=signed-product-session/);
    assert.doesNotMatch(await response.text(), /signed-product-session/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google OAuth starts at Google without exposing the identity portal hop", async () => {
  const originalFetch = globalThis.fetch;
  const upstreamHeaders = new Headers({ location: "https://accounts.google.com/o/oauth2/v2/auth?state=state" });
  Object.defineProperty(upstreamHeaders, "getSetCookie", { value: () => ["bb_oauth_state=state; Path=/; Secure; HttpOnly; SameSite=lax"] });
  globalThis.fetch = async () => ({
    status: 307,
    headers: upstreamHeaders,
    text: async () => "",
  }) as unknown as Response;
  try {
    const response = await startGoogle(new Request("https://perpendicular-api.bluebloodstudio.com/api/auth/google/start?next=/"));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth?state=state");
    assert.match(response.headers.get("set-cookie") || "", /Domain=\.bluebloodstudio\.com/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
