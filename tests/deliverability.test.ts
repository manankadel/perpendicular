import test from "node:test";
import assert from "node:assert/strict";
import { bouncedAddresses, looksLikeBounce, normalizeDeliverabilityDomain } from "../src/lib/deliverability";

test("deliverability input normalizes a website domain", () => {
  assert.equal(normalizeDeliverabilityDomain("https://Example.com/path"), "example.com");
});

test("bounce detection extracts recipient addresses for quarantine", () => {
  const input = { from: "MAILER-DAEMON@gmail.com", subject: "Delivery Status Notification (Failure)", bodyText: "The message to founder@acme.example could not be delivered." };
  assert.equal(looksLikeBounce(input), true);
  assert.deepEqual(bouncedAddresses(input), ["founder@acme.example"]);
});

test("normal inbound mail is not treated as a bounce", () => {
  const input = { from: "person@example.com", subject: "Re: Proposal", bodyText: "Thanks, this looks useful." };
  assert.equal(looksLikeBounce(input), false);
});
