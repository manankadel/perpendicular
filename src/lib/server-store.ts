import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { createInitialState, type WorkspaceState } from "@/lib/domain";

const dataDirectory = path.join(process.cwd(), "data");
const dataFile = path.join(dataDirectory, "workspace-state.json");
const defaultCompanyId = process.env.DEFAULT_COMPANY_ID || "blueblood-demo";

let pool: Pool | null = null;
let postgresDisabled = false;
let mutationQueue = Promise.resolve();

async function getPool() {
  if (!process.env.DATABASE_URL || postgresDisabled) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 10000,
    });
  }

  try {
    await pool.query(`
      create table if not exists perpendicular_workspace_state (
        company_id text primary key,
        state jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    return pool;
  } catch {
    postgresDisabled = true;
    await pool.end().catch(() => undefined);
    pool = null;
    return null;
  }
}

async function readFileState(companyId: string) {
  try {
    const raw = await readFile(dataFile, "utf8");
    const all = JSON.parse(raw) as Record<string, WorkspaceState>;
    return all[companyId] ?? null;
  } catch {
    return null;
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
    if (result.rows[0]?.state) return result.rows[0].state;
    const initial = createInitialState(companyId);
    await saveWorkspace(companyId, initial);
    return initial;
  }

  const existing = await readFileState(companyId);
  if (existing) return existing;
  const initial = createInitialState(companyId);
  await writeFileState(companyId, initial);
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

  await writeFileState(companyId, state);
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
