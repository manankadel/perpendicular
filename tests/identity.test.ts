import test from "node:test";
import assert from "node:assert/strict";
import { getAccessToken, normalizeMemberships } from "../src/lib/identity";

test("reads bearer tokens before cookies", () => {
  const request = new Request("https://perpendicular.test/api/workspace", {
    headers: {
      authorization: "Bearer bearer-token",
      cookie: "bb_session=cookie-token",
    },
  });
  assert.equal(getAccessToken(request), "bearer-token");
});

test("normalizes only complete product memberships", () => {
  assert.deepEqual(normalizeMemberships([
    { productSlug: "perpendicular", organizationId: 1, organizationSlug: "blueblood-studio", role: "owner", permissions: ["employee:write", 4] },
    { productSlug: "", organizationSlug: "missing-product" },
    { productSlug: "perpendicular", organizationSlug: "missing-role" },
  ]), [
    { productSlug: "perpendicular", organizationId: "1", organizationSlug: "blueblood-studio", role: "owner", permissions: ["employee:write"] },
    { productSlug: "perpendicular", organizationId: "", organizationSlug: "missing-role", role: "member", permissions: [] },
  ]);
});

test("accepts an API key header as a distinct credential path", () => {
  const request = new Request("https://perpendicular.test/api/workspace", { headers: { "x-api-key": "pp_live_secret" } });
  assert.equal(request.headers.get("x-api-key"), "pp_live_secret");
});
