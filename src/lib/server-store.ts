import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInitialState, normalizeWorkspaceState, type WorkspaceState } from "@/lib/domain";
import { getDatabase } from "@/lib/database";

const dataDirectory = path.join(process.cwd(), "data");
const dataFile = path.join(dataDirectory, "workspace-state.json");
const defaultCompanyId = process.env.DEFAULT_COMPANY_ID || "blueblood-demo";

let mutationQueue = Promise.resolve();
const transientStates = new Map<string, WorkspaceState>();

function needsWorkspaceMigration(state: WorkspaceState) {
  const candidate = state as Partial<WorkspaceState>;
  const needsEmployeeScoreMigration = Array.isArray(candidate.employees) && candidate.employees.some((employee) => {
    const trend = Array.isArray(employee.scoreTrend) ? employee.scoreTrend : [];
    const lastPositive = [...trend].reverse().find((value) => Number.isFinite(value) && value > 0);
    return trend[0] === 0 && lastPositive !== undefined && employee.score !== lastPositive;
  });
  const onboarding = candidate.workspace?.onboarding;
  const needsStarterSequence = Array.isArray(candidate.sequences)
    && candidate.sequences.length === 0
    && Array.isArray(candidate.employees)
    && candidate.employees.length > 0
    && Array.isArray(candidate.documents)
    && candidate.documents.length > 0
    && Boolean(onboarding?.discoveredAt);
  const needsLaunchSurfaces = Boolean(onboarding?.discoveredAt)
    && Array.isArray(candidate.employees)
    && candidate.employees.length > 0
    && Array.isArray(candidate.documents)
    && candidate.documents.length > 0
    && ((!Array.isArray(candidate.lists) || candidate.lists.length === 0)
      || (!Array.isArray(candidate.inboundAgents) || candidate.inboundAgents.length === 0)
      || (!Array.isArray(candidate.sites) || candidate.sites.length === 0));
  return needsEmployeeScoreMigration
    || !candidate.profile
    || !Array.isArray(candidate.missions)
    || !Array.isArray(candidate.content)
    || !Array.isArray(candidate.playbooks)
    || !Array.isArray(candidate.members)
    || !Array.isArray(candidate.schedules)
    || !Array.isArray(candidate.people)
    || !Array.isArray(candidate.leadSources)
    || !Array.isArray(candidate.campaigns)
    || !Array.isArray(candidate.keywordMonitors)
    || !Array.isArray(candidate.inboundAgents)
    || !Array.isArray(candidate.sites)
    || !Array.isArray(candidate.apps)
    || !Array.isArray(state.workspace.onboarding?.employeeIds)
    || !Array.isArray(state.workspace.onboarding?.missionIds)
    || !Array.isArray(state.workspace.onboarding?.contentIds)
    || needsStarterSequence
    || needsLaunchSurfaces;
}

async function getPool() {
  const database = await getDatabase();
  if (database) {
    if (process.env.NODE_ENV === "production") return database;
    try {
      await database.query(`
      create table if not exists perpendicular_workspace_state (
        company_id text primary key,
        state jsonb not null,
        updated_at timestamptz not null default now()
      )
      `);
      return database;
    } catch {
      return null;
    }
  }
  return null;
}

export async function listWorkspaceIds() {
  const database = await getPool();
  if (database) {
    const result = await database.query<{ company_id: string }>("select company_id from perpendicular_workspace_state order by company_id");
    return result.rows.map((row) => row.company_id);
  }
  if (!allowFileFallback()) throw new Error("Production database is not configured or unavailable.");
  try {
    const raw = await readFile(dataFile, "utf8");
    const all = JSON.parse(raw) as Record<string, WorkspaceState>;
    const ids = Object.keys(all).filter(Boolean).sort();
    return ids.length > 0 ? ids : [defaultCompanyId];
  } catch {
    const ids = [...transientStates.keys()].filter(Boolean).sort();
    return ids.length > 0 ? ids : [defaultCompanyId];
  }
}

function allowFileFallback() {
  return process.env.NODE_ENV !== "production";
}

async function readFileState(companyId: string) {
  try {
    const raw = await readFile(dataFile, "utf8");
    const all = JSON.parse(raw) as Record<string, WorkspaceState>;
    return all[companyId] ?? null;
  } catch {
    return transientStates.get(companyId) ?? null;
  }
}

async function writeFileState(companyId: string, state: WorkspaceState) {
  await mkdir(dataDirectory, { recursive: true });
  let all: Record<string, WorkspaceState> = {};
  try {
    all = JSON.parse(await readFile(dataFile, "utf8")) as Record<string, WorkspaceState>;
  } catch {
    all = {};
  }
  all[companyId] = state;
  const temporaryFile = path.join(dataDirectory, "workspace-state.tmp");
  await writeFile(temporaryFile, JSON.stringify(all, null, 2), "utf8");
  await rename(temporaryFile, dataFile);
}

export async function getWorkspace(companyId = defaultCompanyId): Promise<WorkspaceState> {
  const database = await getPool();
  if (database) {
    const result = await database.query<{ state: WorkspaceState }>(
      "select state from perpendicular_workspace_state where company_id = $1",
      [companyId],
    );
    if (result.rows[0]?.state) {
      const raw = result.rows[0].state;
      const normalized = normalizeWorkspaceState(raw, companyId);
      if (needsWorkspaceMigration(raw)) await saveWorkspace(companyId, normalized);
      return normalized;
    }
    const initial = createInitialState(companyId);
    await saveWorkspace(companyId, initial);
    return initial;
  }

  if (!allowFileFallback()) throw new Error("Production database is not configured or unavailable.");

  const existing = await readFileState(companyId);
  if (existing) {
    const normalized = normalizeWorkspaceState(existing, companyId);
    if (needsWorkspaceMigration(existing)) await writeFileState(companyId, normalized).catch(() => transientStates.set(companyId, normalized));
    return normalized;
  }
  const initial = createInitialState(companyId);
  try {
    await writeFileState(companyId, initial);
  } catch {
    transientStates.set(companyId, initial);
  }
  return initial;
}

export async function findWorkspace(companyId: string): Promise<WorkspaceState | null> {
  const database = await getPool();
  if (database) {
    const result = await database.query<{ state: WorkspaceState }>(
      "select state from perpendicular_workspace_state where company_id = $1",
      [companyId],
    );
    const raw = result.rows[0]?.state;
    return raw ? normalizeWorkspaceState(raw, companyId) : null;
  }

  if (!allowFileFallback()) return null;
  const existing = await readFileState(companyId);
  return existing ? normalizeWorkspaceState(existing, companyId) : null;
}

export async function saveWorkspace(companyId: string, state: WorkspaceState) {
  const database = await getPool();
  if (database) {
    await saveWorkspaceWithClient(database, companyId, state);
    return state;
  }

  if (!allowFileFallback()) throw new Error("Production database is not configured or unavailable.");

  try {
    await writeFileState(companyId, state);
  } catch {
    transientStates.set(companyId, state);
  }
  return state;
}

async function saveWorkspaceWithClient(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, companyId: string, state: WorkspaceState) {
  await client.query(
    `insert into perpendicular_workspace_state (company_id, state, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (company_id) do update set state = excluded.state, updated_at = now()`,
    [companyId, JSON.stringify(state)],
  );
}

export async function updateWorkspace(
  companyId: string,
  update: (state: WorkspaceState) => WorkspaceState | Promise<WorkspaceState>,
) {
  const database = await getPool();
  if (database) {
    const client = await database.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [companyId]);
      const result = await client.query<{ state: WorkspaceState }>(
        "select state from perpendicular_workspace_state where company_id = $1",
        [companyId],
      );
      const current = result.rows[0]?.state
        ? normalizeWorkspaceState(result.rows[0].state, companyId)
        : createInitialState(companyId);
      const next = await update(current);
      await saveWorkspaceWithClient(client, companyId, next);
      await client.query("commit");
      return next;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const operation = mutationQueue.then(async () => {
    const current = await getWorkspace(companyId);
    const next = await update(current);
    return saveWorkspace(companyId, next);
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
