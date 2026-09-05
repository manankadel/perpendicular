import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let unavailable = false;

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export async function getDatabase() {
  if (!process.env.DATABASE_URL || unavailable) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 10000,
      application_name: "perpendicular-api",
    });
  }

  try {
    await pool.query("select 1");
    return pool;
  } catch {
    unavailable = true;
    await pool.end().catch(() => undefined);
    pool = null;
    return null;
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  const database = await getDatabase();
  if (!database) throw new Error("Production database is not configured or unavailable.");
  return database.query<T>(text, values);
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const database = await getDatabase();
  if (!database) throw new Error("Production database is not configured or unavailable.");
  const client = await database.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
