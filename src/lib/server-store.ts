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
      const normalized = normalizeWorkspaceState(result.rows[0].state, companyId);
      if (!result.rows[0].state.workspace.onboarding) await saveWorkspace(companyId, normalized);
      return normalized;
    }
    const initial = createInitialState(companyId);
    await saveWorkspace(companyId, initial);
    return initial;
  }

  if (!allowFileFallback()) throw new Error("Production database is not configured or unavailable.");

  const existing = await readFileState(companyId);
  if (existing) return normalizeWorkspaceState(existing, companyId);
  const initial = createInitialState(companyId);
  try {
    await writeFileState(companyId, initial);
  } catch {
    transientStates.set(companyId, initial);
  }
  return initial;
}

export async function saveWorkspace(companyId: string, state: WorkspaceState) {
  const database = await getPool();
  if (database) {
    await database.query(
      `insert into perpendicular_workspace_state (company_id, state, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (company_id) do update set state = excluded.state, updated_at = now()`,
      [companyId, JSON.stringify(state)],
    );
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

export async function updateWorkspace(
  companyId: string,
  update: (state: WorkspaceState) => WorkspaceState | Promise<WorkspaceState>,
) {
  const operation = mutationQueue.then(async () => {
    const current = await getWorkspace(companyId);
    const next = await update(current);
    return saveWorkspace(companyId, next);
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
