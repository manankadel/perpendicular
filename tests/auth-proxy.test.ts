import test from "node:test";
import assert from "node:assert/strict";
import { getSetCookieHeaders, proxyIdentityRequest, safeReturnPath, sanitizeAuthPayload } from "../src/lib/auth-proxy";

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
