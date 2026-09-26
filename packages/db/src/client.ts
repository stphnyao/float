import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export const DEFAULT_DATABASE_URL =
  "postgres://float:float@localhost:54329/float";

export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function createDb(databaseUrl: string = resolveDatabaseUrl()) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];
