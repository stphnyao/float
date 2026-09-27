import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@float/db/schema";

/**
 * Per-test-file Postgres schema. Every test file gets its OWN schema
 * (created from the frozen drizzle migration SQL), so vitest may run files
 * in parallel against the shared docker Postgres without truncation races.
 * The schema is dropped at cleanup; nothing outside it is touched.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://float:float@localhost:54329/float";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db/drizzle",
);

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  pool: Pool;
  schemaName: string;
  cleanup(): Promise<void>;
}

export async function databaseAvailable(): Promise<boolean> {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

export async function createTestDb(fileLabel: string): Promise<TestDb> {
  const schemaName = `float_test_${fileLabel.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const admin = new Pool({ connectionString: DATABASE_URL, max: 2 });
  await admin.query(`drop schema if exists ${schemaName} cascade`);
  await admin.query(`create schema ${schemaName}`);

  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    // Every connection lands in the file's schema first.
    options: `-c search_path=${schemaName},public`,
  });

  // Apply the frozen migration SQL. Statement names are unqualified and land
  // in the file's schema via search_path — EXCEPT the drizzle-kit FK clauses,
  // which qualify `REFERENCES "public".<table>`; those are rewritten to the
  // test schema so foreign keys check the schema's own tables.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const raw = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of raw.split("--> statement-breakpoint")) {
      const trimmed = statement
        .trim()
        .replaceAll(`"public".`, `"${schemaName}".`);
      if (trimmed.length > 0) await pool.query(trimmed);
    }
  }

  // Sanity: the schema isolation actually took effect.
  const check = await pool.query(
    "select current_schema() as cur, count(*)::int as tables from information_schema.tables where table_schema = current_schema()",
  );
  if ((check.rows[0]?.tables ?? 0) < 13) {
    throw new Error(
      `test schema ${schemaName} was not populated (tables=${check.rows[0]?.tables})`,
    );
  }

  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    schemaName,
    async cleanup() {
      await pool.end();
      await admin.query(`drop schema if exists ${schemaName} cascade`);
      await admin.end();
    },
  };
}
