import test from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret, sha256 } from "../src/lib/security";

test("hashes API secrets deterministically without exposing the secret", () => {
  assert.equal(sha256("pp_live_test"), sha256("pp_live_test"));
  assert.notEqual(sha256("pp_live_test"), "pp_live_test");
});

test("encrypts integration secrets with authenticated encryption", () => {
  const previous = process.env.INTEGRATION_ENCRYPTION_KEY;
  process.env.INTEGRATION_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const encrypted = encryptSecret("refresh-token");
  assert.notEqual(encrypted, "refresh-token");
  assert.equal(decryptSecret(encrypted), "refresh-token");
  if (previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previous;
});

