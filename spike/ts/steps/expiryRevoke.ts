import { PRIMARY_TOKEN, makeClient, units } from "../config.js";
import {
  jsonSafe,
  log,
  recordEvidence,
  loadState,
  saveState,
  explorerLink,
  assertChainId,
  expectRejection,
  accessKeyAccountFromState,
  wait,
} from "../util.js";
import { rootFromPrivateKey } from "../config.js";

/**
 * G1 matrix items (f): expiry and revocation, as INDEPENDENT tests.
 *
 * Expiry: key C was authorized with expiry ~150s after authorization
 * (authorize step). This step waits until after expiry, then attempts a
 * transfer — it must be rejected.
 *
 * Revocation: key D is revoked on-chain via accessKey.revoke (root signs the
 * revoke tx), then a transfer via key D must be rejected. The witness burn
 * path (TIP-1053) applies to unused signed authorizations; here the key was
 * already authorized on-chain, so revokeKey is the correct invalidation.
 */
export async function expiryRevoke(): Promise<void> {
  const client = makeClient();
  await assertChainId(client, "expiry-revoke");

  const state = loadState();
  const merchant = rootFromPrivateKey(state.merchant.privateKey);
  const treasury = state.treasury.address;
  const keyC = accessKeyAccountFromState(state, merchant, "C");
  const keyD = accessKeyAccountFromState(state, merchant, "D");

  const results: Record<string, unknown> = {};

  /* ---------------- Expiry (independent test) ---------------- */
  const metaC = await client.accessKey.getMetadata({
    account: merchant.address,
    accessKey: keyC.accessKeyAddress,
  });
  const expirySec = Number(metaC.expiry);
  const nowSec = Math.floor(Date.now() / 1000);
  const waitSec = expirySec - nowSec + 5;
  log(
    "expiry-revoke",
    `key C on-chain expiry=${expirySec} (configured ${state.keys.C?.expirySec}); waiting ${Math.max(waitSec, 0)}s until after expiry`,
  );
  if (waitSec > 0) await wait(waitSec * 1000);

  const postExpiryNow = Math.floor(Date.now() / 1000);
  const metaCAfter = await client.accessKey.getMetadata({
    account: merchant.address,
    accessKey: keyC.accessKeyAddress,
  });
  results.expiry = {
    keyLabel: "C",
    expiryOnChainSec: expirySec,
    attemptedAtSec: postExpiryNow,
    attemptedAfterExpiry: postExpiryNow >= expirySec,
    keyMetadataAfterExpiry: metaCAfter,
    rejection: await expectRejection(
      "expiry-revoke",
      "post-expiry transfer",
      () =>
        client.token.transferSync({
          account: keyC,
          token: PRIMARY_TOKEN,
          to: treasury,
          amount: units(1n),
        }),
    ),
  };
  log(
    "expiry-revoke",
    "post-expiry transfer rejected:",
    (results.expiry as { rejection: { kind: string } }).rejection.kind,
  );

  /* ---------------- Revocation (independent test) ---------------- */
  const metaDBefore = await client.accessKey.getMetadata({
    account: merchant.address,
    accessKey: keyD.accessKeyAddress,
  });
  let revokeTxHash: string;
  if (!metaDBefore.isRevoked && !state.receipts["revoke-D"]) {
    const revoke = await client.accessKey.revokeSync({
      account: merchant,
      accessKey: keyD.accessKeyAddress,
    });
    log(
      "expiry-revoke",
      `revocation confirmed tx=${revoke.receipt.transactionHash} status=${revoke.receipt.status}`,
    );
    revokeTxHash = revoke.receipt.transactionHash;
    state.receipts["revoke-D"] = revokeTxHash;
    saveState(state);
  } else {
    revokeTxHash = state.receipts["revoke-D"] ?? "";
    log(
      "expiry-revoke",
      "key D already revoked in an earlier run:",
      revokeTxHash,
    );
  }

  const metaDAfter = await client.accessKey.getMetadata({
    account: merchant.address,
    accessKey: keyD.accessKeyAddress,
  });
  results.revocation = {
    keyLabel: "D",
    keyMetadataBeforeRevocation: metaDBefore,
    revokeTxHash,
    revokeExplorer: explorerLink(revokeTxHash),
    keyMetadataAfterRevocation: metaDAfter,
    isRevokedOnChain: metaDAfter.isRevoked,
    rejection: await expectRejection(
      "expiry-revoke",
      "post-revocation transfer",
      () =>
        client.token.transferSync({
          account: keyD,
          token: PRIMARY_TOKEN,
          to: treasury,
          amount: units(1n),
        }),
    ),
  };
  log(
    "expiry-revoke",
    "post-revocation transfer rejected:",
    (results.revocation as { rejection: { kind: string } }).rejection.kind,
  );
  saveState(state);

  const evidence = {
    step: "expiry-revoke",
    mode: "confirmed testnet transaction",
    results,
    notes:
      "Expiry enforced by the chain before spending/scope checks (TIP-1011). Revocation confirmed on-chain via accountKeychain.revokeKey before the rejected transfer. Independent tests: separate keys C and D.",
  };
  console.log(JSON.stringify(jsonSafe(evidence), null, 2));
  recordEvidence("06-expiry-revoke", evidence);
  log("expiry-revoke", "OK");
}

if (process.argv[1]?.includes("expiryRevoke")) {
  expiryRevoke().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
