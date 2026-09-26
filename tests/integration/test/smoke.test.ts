import { expect, it } from "vitest";

it("resolves @float/db schema types across the workspace", async () => {
  const db = await import("@float/db");
  expect(typeof db.resolveDatabaseUrl).toBe("function");
});
