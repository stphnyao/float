# Float — Business assumptions (draft for submission and internal honesty)

Prepared 2026-09-26 by work package F. Mirrors PLAN.md §2 and §3 deliberately: this document exists to state the business narrative that a testnet demo cannot state for itself, and to keep it honest.

**Status banner: everything in §2–§5 is a forward-looking assumption or an options analysis. Nothing here is validated. The current build is a testnet demo with no real capital, no revenue, and no customers.**

## 1. What is real today vs. assumed

Real (as of 2026-09-26, per [PLAN §1, §7](../PLAN.md) and [spike/RESULTS.md](../spike/RESULTS.md)):

- A testnet product design: evaluate eligible stablecoin receipts, offer a small advance, collect revenue-linked repayments within merchant-authorized spending limits, stop at payoff.
- A G0 foundation (workspace, frozen contracts, DB schema with the one-open-advance invariant). The Tempo integration is NOT VERIFIED.

Assumed (unvalidated):

- That a capital source will exist to fund advances (§2).
- That a revenue model can be layered on without breaking the demo's principal-only terms (§3).
- That someone bears credit losses and can survive them (§4).
- That merchants will authorize automated collections (see [demand-validation.md](demand-validation.md) — currently no evidence).

## 2. Capital source narrative (future version; testnet now)

The demo uses a testnet treasury, which requires no capital story. A production version must answer: whose money is advanced? Options considered, with tradeoffs:

| Option | Narrative | Tradeoffs |
| --- | --- | --- |
| **A. Balance-sheet / angel capital** | The operator (or a small group of angels) funds advances from own capital. Simplest to launch; no intermediary approvals; the operator is the direct loss bearer. | Scale is capped by personal capital; concentration risk on one book; no regulatory buffer structure; loses viability beyond small advance sizes. |
| **B. Dedicated credit facility from a regulated lender or stablecoin issuer partner** | A lender provides an advance facility; Float is the software, origination, and servicing layer. Aligns with Tempo's issuer/merchant ecosystem (Tempo is a payments-focused chain whose [developer docs](https://tempo.xyz/developers) describe fee payment in stablecoins and TIP-20 tokens with compliance policies). | Requires underwriting credibility Float does not yet have; partner diligence will demand the receipt-classification and repayment evidence the demo is designed to produce; revenue share or facility cost reduces margin; Float may need to hold first-loss capital. |
| **C. On-chain pooled capital (vault of depositors)** | Depositors fund a pool; advances draw from it; losses reduce depositor returns, possibly via a first-loss tranche. | Most scalable narrative and most thematically native to crypto; hardest legally (pool governance, securities-like questions) and operationally (fair loss allocation). Explicitly out of MVP scope per PLAN §2 ("pooled capital" is deferred). |
| **D. Partner with existing revenue-based-financing providers** | An existing RF/MCA provider bears credit risk; Float supplies Tempo-native origination, receipts, and collections. | Fastest path to real capital; Float becomes distribution tech with thinner economics; provider's existing underwriting may not accept stablecoin receipt data initially. |

**Working narrative for the submission (not a commitment):** Option B — a future version would be funded by a dedicated facility from a lending partner (plausibly a stablecoin issuer or payments company already active on Tempo), with Float as origination/servicing software, because it matches the product's evidence-producing design and avoids starting with the legal weight of Option C. This is a hypothesis to test after the hackathon, not a partnership claim — no partner conversations have occurred.

## 3. Revenue model options (future; demo is principal-only)

PLAN §2 is explicit: "Principal-only repayment for the first demo: obligation equals principal. Future fees require explicit terms and accounting tests." Any revenue model below therefore changes the demo's current terms and needs new tests before implementation.

| Model | Mechanism | Pros | Cons / risks |
| --- | --- | --- | --- |
| **Fixed fee per advance** | Flat fee added to the total obligation (e.g., 2% of principal), disclosed in immutable offer terms. | Simple; transparent; matches how merchants evaluate other advances; trivial to account for. | Reads like interest regardless of label; flat fee is regressive for short horizons; compliance treatment varies by jurisdiction (unexamined — see §6). |
| **Percentage service fee on collections** | Float keeps a small share of each collected amount on top of principal recovery. | Scales with actual collections; Float only earns when the merchant's revenue does. | Slower capital turn; accounting must separate fee from principal in the ledger (new invariant tests); fee rate must still be disclosed in offer terms. |
| **Discounted obligation (fee at origination)** | Obligation = principal + fee, set at acceptance (the classic revenue-based-financing shape). | Single predictable number; matches PLAN's immutable-offer design (principal, total obligation already in the terms hash). | Highest compliance sensitivity (looks most like a loan); PLAN defers this deliberately. |
| **SaaS subscription for the underwriting/dashboard layer** | Merchants or partners pay for the evaluation/monitoring tooling; advances funded by a partner at no markup. | No credit risk to Float; no lending compliance surface. | Weakest link to volume; hard to price for small merchants; weakens the incentive alignment story. |
| **Spread model** | Float borrows at cost X, advances at effective cost Y. | Industry-standard; margin scales with book. | Requires Option-B/C capital from §2; most complex accounting and risk transfer. |

**Working assumption for the submission:** percentage-of-collections service fee or fixed fee, disclosed in the offer terms — but the demo must ship principal-only per PLAN, and the submission must not imply a live fee model.

## 4. Bearer of credit losses

- In the demo: nobody — the treasury is testnet valueless.
- In production, losses fall on whoever funds the advance, unless explicitly transferred:
  - Option A: the operator bears all losses directly.
  - Option B: the facility lender bears losses economically, possibly shared with Float via first-loss capital, reserves, or recourse terms. These terms do not exist yet and are not promised.
  - Option C: depositors bear losses per pool rules; a first-loss tranche could concentrate them.
  - Option D: the RF partner bears losses; Float's exposure is reputational and contractual.
- PLAN §2 requires exactly this identification ("The business narrative must identify a plausible future capital source, revenue model, and bearer of credit losses") — the honest current answer is "per §2 Option B: the facility lender, terms undefined."

## 5. Why access keys do not guarantee repayment (mirror of PLAN §3 — no stronger claims permitted)

Tempo access keys (TIP-1011) give Float a scoped, capped spending authorization. They constrain what Float **may collect**; they do not make the merchant **pay**. Specifically, per [TIP-1011](https://github.com/tempoxyz/tempo/blob/main/tips/tip-1011.md) and [PLAN §3](../PLAN.md):

1. **Revocation:** scope updates and revocation are root-key operations; a missing, revoked, or expired key denies all scoped calls. The merchant can revoke at any time, and payoff in Float's database does not itself revoke the on-chain key (PLAN §3 requires stopping the worker and displaying actual authorization status separately).
2. **Expiry:** authorizations carry an expiry checked before every spend; no collection happens after expiry regardless of outstanding debt.
3. **Empty wallet / no receipts:** the key only permits spending available token balance within the remaining period limit. If the merchant's wallet has no balance, or a period has zero eligible receipts, Float's own policy forbids collection — no repayment occurs.
4. **Redirected future sales:** the key is bound to specific token, function, and recipient scopes (and TIP-1011's recipient scoping checks only the first address argument of a fixed selector list). The merchant can receive future sales into a different wallet or token; the authorization follows the authorized account, not the merchant's future revenue.
5. **No lifetime debt ceiling:** the key enforces a per-period cumulative limit that resets each period. "A recurring key alone does not provide a lifetime debt ceiling" (PLAN §3); outstanding obligation is a Float ledger concept the chain does not enforce.
6. **The chain does not determine genuine revenue, Float's repayment percentage, or outstanding debt** (PLAN §3). Receipt classification happens off-chain and can be wrong; that is why classification carries version, reason, provenance, and review status (PLAN §4).

Consequence for the business case: underwriting quality and loss reserves, not the access key, are the risk controls. The access key improves process honesty (bounded, revocable, auditable collection), not repayment probability. Production credit and legal decisions are outside this MVP (PLAN §2).

## 6. Risks table

| # | Risk | Nature | Current mitigation / status |
| --- | --- | --- | --- |
| 1 | **Demand risk — the target customer or the willingness to authorize collections does not exist at meaningful levels** | Business | [demand-validation.md](demand-validation.md): validation incomplete; no interviews yet. Submission must say so. |
| 2 | **Credit risk — merchants default via revocation, empty wallets, or redirected sales** | Credit | Access keys bound collection but do not prevent the above (§5); conservative sizing (capacity formula, haircut, absolute demo maximum, PLAN §4); production reserves/first-loss undefined. |
| 3 | **Regulatory risk — advancing against future receipts can be lending/MCA-regulated activity; rules vary by jurisdiction** | Legal/compliance | **Unexamined.** No legal review has occurred; demo is testnet with no real money. Production requires counsel; nothing in the submission may assert regulatory compliance. |
| 4 | **Classification risk — false "eligible sale" labels (circular flows, non-sales) inflate advances** | Underwriting | PLAN §4: raw events stored separately from versioned decisions; exclusions for faucet/Float/self-transfer/refunds; conservative labeling; rules verify logic, not predictive accuracy. |
| 5 | **Integration risk — Tempo testnet behavior differs from documentation (G1 unproven)** | Technical | [spike/RESULTS.md](../spike/RESULTS.md): NOT VERIFIED; G1 matrix requires evidence before any live claim. |
| 6 | **Operational risk — worker bugs cause double collection or missed reconciliation** | Technical | PLAN §6 invariants: idempotency keys, reservations, unresolved-transaction handling; G3/G4 failure matrix. |
| 7 | **Revocation racing funding** | Technical/credit | PLAN §6(2): reconcile and pause if authorization disappears mid-flight. |
| 8 | **Stablecoin market risk (depeg, issuer action) affects principal value** | Market | Not mitigated in MVP; single supported token per PLAN §2; flag as production concern. |
| 9 | **Key/custody risk — server or merchant key compromise** | Security | Dedicated delegated keys per authorization, no admin keys, no signing material in Git/logs (PLAN §6(3)); merchant root keys stay in the wallet. |
| 10 | **Concentration risk — few payers dominate a merchant's receipts** | Underwriting | Payer concentration is a versioned policy input (PLAN §4); thresholds frozen before implementation. |
| 11 | **Reputational risk — overclaiming in the submission (fake demand, fake evidence)** | Process | PLAN forbids invented demand claims; evidence-gated milestones; this file and [checklist.md](checklist.md) mark unverified items explicitly. |
| 12 | **Competition — established revenue-based-financing providers adding stablecoin rails** | Business | Not researched in depth (no verified competitor analysis exists); noted as an open item. |

## Sources

- [PLAN.md §1–§4, §6, §7](../PLAN.md) — scope, deferrals, repayment policy, invariants, gates.
- [TIP-1011: Enhanced Access Key Permissions](https://github.com/tempoxyz/tempo/blob/main/tips/tip-1011.md) — periodic limits reset per period, root-key-only scope updates, deny-all on missing/revoked/expired keys, recipient scoping limits.
- [viem Tempo access keys](https://viem.sh/tempo/actions/accessKey.signAuthorization) — authorization entry point used by the planned adapter.
- [Tempo developer docs](https://tempo.xyz/developers) — payments focus, TIP-20 standard, stablecoin fee payment.
- [Colosseum hackathon FAQ](https://colosseum.com/hackathon) — Business Plan and Viability judging factors that this document supports.
