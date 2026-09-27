import test from "node:test";
import assert from "node:assert/strict";
import { containsUnsubscribeRequest } from "@/lib/compliance";

test("detects explicit unsubscribe requests in inbound mail", () => {
  assert.equal(containsUnsubscribeRequest("Re: Follow-up", "Please stop emailing me and remove me from this list."), true);
  assert.equal(containsUnsubscribeRequest("Unsubscribe", "Thanks."), true);
  assert.equal(containsUnsubscribeRequest("Question", "Can you send the pricing page?"), false);
});
