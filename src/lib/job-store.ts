import crypto from "node:crypto";
import { databaseConfigured, query, transaction } from "@/lib/database";

const leaseMs = 10 * 60_000;
const memoryJobs = new Map<string, {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  runAt: number;
  lockedAt: number | null;
}>();

export type JobClaim = { id: string; attempts: number; idempotencyKey: string };

export type DeadLetterJob = {
  id: string;
  kind: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobInput = {
  workspaceId: string;
  kind: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
};

function available(runAt: number, now: number) {
  return runAt <= now;
}

export async function claimJob(input: JobInput): Promise<JobClaim | null> {
  const now = Date.now();
  const maxAttempts = input.maxAttempts || 5;
  if (!databaseConfigured()) {
    const existing = memoryJobs.get(input.idempotencyKey);
    if (existing) {
      if (existing.status === "completed" || existing.status === "dead_letter") return null;
      if (!available(existing.runAt, now)) return null;
      if (existing.status === "running" && existing.lockedAt && now - existing.lockedAt < leaseMs) return null;
      if (existing.attempts >= existing.maxAttempts) return null;
      existing.status = "running";
      existing.attempts += 1;
      existing.lockedAt = now;
      return { id: existing.id, attempts: existing.attempts, idempotencyKey: input.idempotencyKey };
    }
    const job = { id: `job-${crypto.randomUUID()}`, status: "running" as const, attempts: 1, maxAttempts, runAt: input.runAt?.getTime() || now, lockedAt: now };
    if (!available(job.runAt, now)) {
      memoryJobs.set(input.idempotencyKey, { ...job, status: "queued" });
      return null;
    }
    memoryJobs.set(input.idempotencyKey, job);
    return { id: job.id, attempts: job.attempts, idempotencyKey: input.idempotencyKey };
  }

  return transaction(async (client) => {
    await client.query(
      `insert into perpendicular_jobs (id, workspace_id, kind, payload, idempotency_key, run_at, max_attempts)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7)
       on conflict (idempotency_key) do nothing`,
      [`job-${crypto.randomUUID()}`, input.workspaceId, input.kind, JSON.stringify(input.payload || {}), input.idempotencyKey, input.runAt || new Date(), maxAttempts],
    );
    const result = await client.query<{
      id: string;
      status: "queued" | "running" | "completed" | "failed" | "dead_letter";
      attempts: number;
      max_attempts: number;
      run_at: Date;
      locked_at: Date | null;
    }>(
      `select id, status, attempts, max_attempts, run_at, locked_at
       from perpendicular_jobs where idempotency_key = $1 for update`,
      [input.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row || row.status === "completed" || row.status === "dead_letter" || row.attempts >= row.max_attempts || !available(row.run_at.getTime(), now)) return null;
    if (row.status === "running" && row.locked_at && now - row.locked_at.getTime() < leaseMs) return null;
    const claimed = await client.query<{ id: string; attempts: number }>(
      `update perpendicular_jobs
       set status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = $2, updated_at = now()
       where id = $1
       returning id, attempts`,
      [row.id, `heartbeat-${process.pid}`],
    );
    const updated = claimed.rows[0];
    return updated ? { id: updated.id, attempts: updated.attempts, idempotencyKey: input.idempotencyKey } : null;
  });
}

export async function completeJob(claim: JobClaim) {
  if (!databaseConfigured()) {
    const job = memoryJobs.get(claim.idempotencyKey);
    if (job && job.id === claim.id) {
      job.status = "completed";
      job.lockedAt = null;
    }
    return;
  }
  await transaction(async (client) => {
    await client.query(
      `update perpendicular_jobs set status = 'completed', locked_at = null, locked_by = null, updated_at = now()
       where id = $1 and status = 'running'`,
      [claim.id],
    );
  });
}

export async function failJob(claim: JobClaim, error: unknown) {
  const message = error instanceof Error ? error.message : "Heartbeat job failed.";
  if (!databaseConfigured()) {
    const job = memoryJobs.get(claim.idempotencyKey);
    if (job && job.id === claim.id) {
      job.status = job.attempts >= job.maxAttempts ? "dead_letter" : "failed";
      job.runAt = Date.now() + 60_000;
      job.lockedAt = null;
    }
    return;
  }
  await transaction(async (client) => {
    await client.query(
      `update perpendicular_jobs
       set status = case when attempts >= max_attempts then 'dead_letter' else 'failed' end,
           run_at = case when attempts >= max_attempts then run_at else now() + interval '1 minute' end,
           last_error = $2, locked_at = null, locked_by = null, updated_at = now()
       where id = $1 and status = 'running'`,
      [claim.id, message.slice(0, 2000)],
    );
  });
}

export async function listDeadLetterJobs(workspaceId: string, limit = 30): Promise<DeadLetterJob[]> {
  const result = await query<{
    id: string;
    kind: string;
    attempts: number;
    max_attempts: number;
    last_error: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `select id, kind, attempts, max_attempts, last_error, created_at, updated_at
     from perpendicular_jobs
     where workspace_id = $1 and status = 'dead_letter'
     order by updated_at desc limit $2`,
    [workspaceId, Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function retryDeadLetterJob(workspaceId: string, id: string) {
  const result = await query<{ id: string }>(
    `update perpendicular_jobs
     set status = 'failed', attempts = 0, run_at = now(), last_error = null, locked_at = null, locked_by = null, updated_at = now()
     where id = $1 and workspace_id = $2 and status = 'dead_letter'
     returning id`,
    [id, workspaceId],
  );
  return Boolean(result.rows[0]);
}

export function resetJobStoreForTests() {
  memoryJobs.clear();
}
