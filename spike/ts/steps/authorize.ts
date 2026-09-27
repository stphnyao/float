import {
  PRIMARY_TOKEN,
  PERIOD_CEILING_UNITS,
  PERIOD_SECONDS_DAILY,
  PERIOD_SECONDS_SHORT,
  FEE_TOKEN,
  units,
  makeClient,
  rootFromPrivateKey,
  newAccessKeyAccount,
} from "../config.js";
import {
  log,
  recordEvidence,
  loadState,
  saveState,
  explorerLink,
  assertChainId,
} from "../util.js";
import { Scopes } from "viem/tempo";
import type { Address } from "viem";

const DAY_SEC = 86_400;
/** Fee-token allowance per key (1 pathUSD unit per matching period). */
const FEE_LIMIT_UNITS = 1n;

type KeySpec = {
  label: string;
  limitUnits: bigint;
  periodSeconds: number | null;
  expirySec: number;
  purpose: string;
};

/**
 * G1 matrix item (b): the merchant root account authorizes dedicated
 * delegated access keys with per-token recurring spend limits and scopes
 * (exactly the token's transfer function restricted to the treasury), with
 * expiry in the future.
 *
 * IMPORTANT (spike-proven 2026-09-26): the chain enforces the access-key
 * spending limit on the transaction FEE as well. If the fee token has no
 * limit entry, fee payment fails with SpendingLimitExceeded and every key
 * spend is rejected. Each key therefore also gets a small fee-token
 * (pathUSD) limit at authorization time.
 *
 * Uses accessKey.authorizeSync (root signs + submits on-chain). Ordinary
 * transferFrom allowances are NOT used — this is the TIP access-key flow.
 */
export async function authorize(): Promise<void> {
  const client = makeClient();
  await assertChainId(client, "authorize");

  const state = loadState();
  const merchant = rootFromPrivateKey(state.merchant.privateKey);
  const treasury: Address = state.treasury.address;
  const nowSec = Math.floor(Date.now() / 1000);

  // Lifecycle hygiene: revoke keys left over from earlier spike runs before
  // authorizing replacements (an authorized-but-unused key should not be
  // left dangling even on a throwaway test account).
  for (const [label, key] of Object.entries(state.keys)) {
    if (!key) continue;
    try {
      const r = await client.accessKey.revokeSync({
        account: merchant,
        accessKey: key.keyIdAddress,
      });
      log(
        "authorize",
        `revoked previous key ${label} (${key.keyIdAddress}) tx=${r.receipt.transactionHash}`,
      );
      state.receipts[`revoke-old-${label}`] = r.receipt.transactionHash;
    } catch (err) {
      log(
        "authorize",
        `could not revoke previous key ${label}: ${(err as Error).message.split("\n")[0]?.slice(0, 160)}`,
      );
    }
  }

  const specs: KeySpec[] = [
    {
      label: "A",
      limitUnits: units(PERIOD_CEILING_UNITS),
      periodSeconds: PERIOD_SECONDS_DAILY,
      expirySec: nowSec + 30 * DAY_SEC,
      purpose: "cumulative ceiling test (20 units / 86400s)",
    },
    {
      label: "B",
      limitUnits: units(PERIOD_CEILING_UNITS),
      periodSeconds: PERIOD_SECONDS_SHORT,
      expirySec: nowSec + DAY_SEC,
      purpose: "short-period (60s) reset observation",
    },
    {
      label: "C",
      limitUnits: units(5n),
      periodSeconds: null,
      expirySec: nowSec + 150,
      purpose: "expiry rejection test (expires ~150s after authorization)",
    },
    {
      label: "D",
      limitUnits: units(5n),
      periodSeconds: null,
      expirySec: nowSec + DAY_SEC,
      purpose: "scope rejection tests, then revocation rejection test",
    },
  ];

  // Scope: exactly the token's transfer function restricted to the treasury.
  const scope = Scopes.tip20(PRIMARY_TOKEN).transfer({
    recipients: [treasury],
  });
  log("authorize", "scope:", JSON.stringify(scope));

  for (const spec of specs) {
    const { account: key, privateKey } = newAccessKeyAccount(merchant);
    log(
      "authorize",
      `authorizing key ${spec.label} keyId=${key.accessKeyAddress} (root ${merchant.address}) limit=${spec.limitUnits} period=${spec.periodSeconds} expiry=${spec.expirySec} (${spec.purpose})`,
    );

    const { receipt, expiry, publicKey } = await client.accessKey.authorizeSync(
      {
        account: merchant,
        accessKey: key,
        limits: [
          // Collection-token recurring ceiling.
          {
            token: PRIMARY_TOKEN,
            limit: spec.limitUnits,
            ...(spec.periodSeconds ? { period: spec.periodSeconds } : {}),
          },
          // Fee-token allowance so fee payment passes limit enforcement.
          {
            token: FEE_TOKEN,
            limit: units(FEE_LIMIT_UNITS),
            ...(spec.periodSeconds ? { period: spec.periodSeconds } : {}),
          },
        ],
        scopes: [scope],
        expiry: spec.expirySec,
      },
    );

    log(
      "authorize",
      `key ${spec.label} authorized tx=${receipt.transactionHash} status=${receipt.status} block=${receipt.blockNumber} feePayer=${receipt.feePayer} feeToken=${receipt.feeToken} gasUsed=${receipt.gasUsed}`,
    );
    log(
      "authorize",
      `  event expiry=${expiry} publicKey=${publicKey} explorer=${explorerLink(receipt.transactionHash)}`,
    );

    // On-chain reads immediately after authorization.
    const meta = await client.accessKey.getMetadata({
      account: merchant.address,
      accessKey: key.accessKeyAddress,
    });
    const remainingPrimary = await client.accessKey.getRemainingLimit({
      account: merchant.address,
      accessKey: key.accessKeyAddress,
      token: PRIMARY_TOKEN,
    });
    const remainingFee = await client.accessKey.getRemainingLimit({
      account: merchant.address,
      accessKey: key.accessKeyAddress,
      token: FEE_TOKEN,
    });
    log(
      "authorize",
      `key ${spec.label} on-chain: keyType=${meta.keyType} expiry=${meta.expiry} spendPolicy=${meta.spendPolicy} isRevoked=${meta.isRevoked} remainingPrimary=${remainingPrimary.remaining} periodEndPrimary=${remainingPrimary.periodEnd} remainingFee=${remainingFee.remaining}`,
    );

    state.keys[spec.label] = {
      label: spec.label,
      keyIdAddress: key.accessKeyAddress,
      privateKey,
      keyType: "p256",
      limitUnits: spec.limitUnits.toString(10),
      periodSeconds: spec.periodSeconds,
      expirySec: spec.expirySec,
      scope: `transfer(${PRIMARY_TOKEN}) -> ${treasury} + fee limit ${FEE_LIMIT_UNITS} pathUSD`,
    };
    state.receipts[`authorize-${spec.label}`] = receipt.transactionHash;

    recordEvidence("03-authorize", {
      step: "authorize",
      mode: "confirmed testnet transaction",
      key: spec.label,
      purpose: spec.purpose,
      merchantRootAddress: merchant.address,
      accessKeyIdAddress: key.accessKeyAddress,
      keyType: meta.keyType,
      authorizationTxHash: receipt.transactionHash,
      explorer: explorerLink(receipt.transactionHash),
      receiptStatus: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      feePayer: receipt.feePayer,
      feeToken: receipt.feeToken,
      gasUsed: receipt.gasUsed?.toString(10),
      limitsConfigured: [
        {
          token: PRIMARY_TOKEN,
          limitBaseUnits: spec.limitUnits.toString(10),
          periodSeconds: spec.periodSeconds,
        },
        {
          token: FEE_TOKEN,
          limitBaseUnits: units(FEE_LIMIT_UNITS).toString(10),
          periodSeconds: spec.periodSeconds,
          reason:
            "fee payment is itself limit-enforced; without this entry every key spend fails SpendingLimitExceeded",
        },
      ],
      expiryConfiguredSec: spec.expirySec,
      expiryOnChain: expiry?.toString(10),
      scopes: [JSON.stringify(scope)],
      onChainRead: {
        spendPolicy: meta.spendPolicy,
        isRevoked: meta.isRevoked,
        remainingPrimaryBaseUnits: remainingPrimary.remaining.toString(10),
        periodEndPrimarySec: remainingPrimary.periodEnd?.toString(10) ?? null,
        remainingFeeTokenBaseUnits: remainingFee.remaining.toString(10),
      },
      notes:
        "Authorization via TIP access-key flow (accountKeychain.authorizeKey), not an ERC-20 allowance. Period anchored to authorization time (periodEnd = authorize_time + period), confirmed by on-chain reads.",
    });
  }

  saveState(state);
  log("authorize", "OK");
}

if (process.argv[1]?.includes("authorize")) {
  authorize().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
