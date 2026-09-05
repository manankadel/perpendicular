import test from "node:test";
import assert from "node:assert/strict";
import { getSetCookieHeaders, safeReturnPath, sanitizeAuthPayload } from "../src/lib/auth-proxy";

test("only accepts same-site relative return paths", () => {
  assert.equal(safeReturnPath("/"), "/");
  assert.equal(safeReturnPath("/settings?tab=auth"), "/settings?tab=auth");
  assert.equal(safeReturnPath("https://evil.example/"), "/");
  assert.equal(safeReturnPath("//evil.example/"), "/");
  assert.equal(safeReturnPath("javascript:alert(1)"), "/");
  assert.equal(safeReturnPath(null), "/");
});

test("removes identity tokens before returning auth responses to the browser", () => {
  assert.deepEqual(sanitizeAuthPayload({ message: "Authentication Passed", token: "secret", user: { id: 11 }, requiresMfa: false }), {
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
