import test from "node:test";
import assert from "node:assert/strict";
import { claimJob, completeJob, resetJobStoreForTests } from "../src/lib/job-store";

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
