import { describe, expect, it } from "vitest";
import {
  applyBasisPoints,
  canonicalJson,
  formatMoneyAmount,
  moneyAmountSchema,
  parseMoneyAmount,
} from "../src/index.js";

describe("money", () => {
  it("round-trips integer base units", () => {
    const value = 123456789012345678n;
    const formatted = formatMoneyAmount(value);
    expect(moneyAmountSchema.safeParse(formatted).success).toBe(true);
    expect(parseMoneyAmount(formatted)).toBe(value);
  });

  it("rejects float-looking and empty amounts", () => {
    expect(moneyAmountSchema.safeParse("1.5").success).toBe(false);
    expect(moneyAmountSchema.safeParse("").success).toBe(false);
    expect(moneyAmountSchema.safeParse("1e6").success).toBe(false);
    expect(moneyAmountSchema.safeParse("0x10").success).toBe(false);
    expect(moneyAmountSchema.safeParse("-42").success).toBe(true);
  });

  it("applies basis points with BigInt truncation", () => {
    expect(applyBasisPoints(10_000_000n, 1500)).toBe(1_500_000n);
    expect(applyBasisPoints(999n, 5000)).toBe(499n);
    expect(applyBasisPoints(0n, 1500)).toBe(0n);
  });

  it("canonical JSON is key-order independent and float-hostile", () => {
    expect(canonicalJson({ b: 1, a: "x" })).toBe('{"a":"x","b":1}');
    expect(canonicalJson({ a: [2, 1] })).toBe('{"a":[2,1]}');
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
  });
});
