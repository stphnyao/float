import { verifyNetwork } from "./steps/verifyNetwork.js";
import { fund } from "./steps/fund.js";
import { authorize } from "./steps/authorize.js";
import { ceiling } from "./steps/ceiling.js";
import { scopes } from "./steps/scopes.js";
import { expiryRevoke } from "./steps/expiryRevoke.js";
import { reset } from "./steps/reset.js";
import { fees } from "./steps/fees.js";
import { ingest } from "./steps/ingest.js";

const USAGE = `Usage: tsx ts/run.ts [step]

Steps:
  verify-network  Verify chain ID/RPC/explorer/tokens (read-only)
  fund            Generate dev wallets + faucet fund (faucet -> merchant)
  authorize       Merchant root authorizes delegated access keys A-D
  ceiling         20-unit/86400s cumulative ceiling: 15 OK, 6 rejected, 5 OK
  scopes          Wrong token/recipient/selector rejections (no token moves)
  expiry-revoke   Expiry and revocation as independent tests
  reset           60s short-period reset observation (+86400s config check)
  fees            Fee token/payer identification and balance effects
  all             Run every step in dependency order (expiry/revoke waits ~150s, reset ~70s)
`;

async function main(): Promise<void> {
  const step = process.argv[2] ?? "usage";
  switch (step) {
    case "verify-network":
      return verifyNetwork();
    case "fund":
      return fund();
    case "authorize":
      return authorize();
    case "ceiling":
      return ceiling();
    case "scopes":
      return scopes();
    case "expiry-revoke":
      return expiryRevoke();
    case "reset":
      return reset();
    case "fees":
      return fees();
    case "ingest":
      return ingest();
    case "all": {
      await verifyNetwork();
      await fund();
      await authorize();
      await ceiling();
      await scopes();
      await expiryRevoke();
      await reset();
      await fees();
      return;
    }
    default:
      console.log(USAGE);
      if (step !== "usage") process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
