import test from "node:test";
import assert from "node:assert/strict";
import { corsHeadersFor, corsJson, isAllowedWebOrigin } from "../src/lib/cors";

test("allows the canonical and connected Vercel origins without allowing arbitrary sites", () => {
  assert.equal(isAllowedWebOrigin("https://perpendicular.bluebloodstudio.com"), true);
  assert.equal(isAllowedWebOrigin("https://perpendicular-nine.vercel.app"), true);
  assert.equal(isAllowedWebOrigin("https://attacker.example"), false);
});

test("echoes an allowed request origin for credentialed CORS", () => {
  const request = new Request("https://perpendicular-api.bluebloodstudio.com/api/workspace", {
    headers: { origin: "https://perpendicular-nine.vercel.app" },
  });
  assert.equal(corsHeadersFor(request)["access-control-allow-origin"], "https://perpendicular-nine.vercel.app");
  assert.equal(corsJson({ ok: true }, undefined, request).headers.get("access-control-allow-origin"), "https://perpendicular-nine.vercel.app");
});

test("does not reflect an untrusted origin", () => {
  const request = new Request("https://perpendicular-api.bluebloodstudio.com/api/workspace", {
    headers: { origin: "https://attacker.example" },
  });
  assert.notEqual(corsHeadersFor(request)["access-control-allow-origin"], "https://attacker.example");
});
