import { expect, it } from "vitest";

it("resolves @float/contracts across the workspace", async () => {
  const contracts = await import("@float/contracts");
  const result = contracts.apiOk({ ready: true });
  expect(result.ok).toBe(true);
});
