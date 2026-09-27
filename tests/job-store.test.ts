import test from "node:test";
import assert from "node:assert/strict";
import { claimJob, completeJob, enqueueJob, resetJobStoreForTests } from "../src/lib/job-store";

test("queued jobs can be enqueued once and claimed by the heartbeat", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  resetJobStoreForTests();
  const input = { workspaceId: "workspace-a", kind: "onboarding-content-draft", idempotencyKey: "onboarding-content:workspace-a:content-1", payload: { contentId: "content-1" } };
  await enqueueJob(input);
  await enqueueJob(input);
  const claim = await claimJob(input);
  assert.ok(claim);
  assert.equal(await claimJob(input), null);
  await completeJob(claim);
  assert.equal(await claimJob(input), null);
  resetJobStoreForTests();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
});

test("heartbeat job claims are idempotent in the local fallback", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  resetJobStoreForTests();
  const input = { workspaceId: "workspace-a", kind: "employee-heartbeat", idempotencyKey: "heartbeat:workspace-a:employee-a:slot-1" };
  const first = await claimJob(input);
  const duplicate = await claimJob(input);
  assert.ok(first);
  assert.equal(duplicate, null);
  await completeJob(first);
  assert.equal(await claimJob(input), null);
  resetJobStoreForTests();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
});
