import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { resolveDatabaseUrl } from "./client.js";

const pool = new Pool({ connectionString: resolveDatabaseUrl() });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  console.log("migrations applied");
} finally {
  await pool.end();
}
