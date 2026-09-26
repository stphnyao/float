import { z } from "zod";

/**
 * Money is carried as integer token base units everywhere internal to the
 * system. In JSON (API payloads, stored documents) an amount is a signed
 * decimal integer string: "-1250000". Floating point must never touch an
 * amount. Negative amounts exist only for append-only adjustments
 * (refunds/corrections); disbursements and repayments are non-negative.
 */
export const moneyAmountSchema = z
  .string()
  .regex(/^-?\d+$/, "must be a signed decimal integer string of base units");

export type MoneyAmount = z.infer<typeof moneyAmountSchema>;

export const hexAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 20-byte hex address");

export type HexAddress = z.infer<typeof hexAddressSchema>;

/** Identity of the token an amount is denominated in. Decimals must be the value verified on-chain (adapter), never assumed. */
export const tokenRefSchema = z.object({
  chainId: z.number().int().positive(),
  address: hexAddressSchema,
  decimals: z.number().int().nonnegative(),
});

export type TokenRef = z.infer<typeof tokenRefSchema>;

export const hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex string");

export function parseMoneyAmount(amount: MoneyAmount): bigint {
  return BigInt(amount);
}

export function formatMoneyAmount(value: bigint): MoneyAmount {
  return value.toString(10);
}

export function assertNonNegative(amount: MoneyAmount, context: string): void {
  if (amount.startsWith("-")) {
    throw new Error(
      `${context}: negative amounts are not allowed here (got ${amount})`,
    );
  }
}

/** Basis-point rate as an integer (e.g. 1500 = 15.00%). Never a float. */
export const basisPointsSchema = z.number().int().min(0).max(10000);

/**
 * Applies a basis-point rate to an integer base-unit amount, truncating
 * toward zero. floor(rate * amount / 10000) using BigInt only.
 */
export function applyBasisPoints(amount: bigint, rateBps: number): bigint {
  if (!Number.isInteger(rateBps)) throw new Error("rateBps must be an integer");
  return (amount * BigInt(rateBps)) / 10000n;
}
