# Policy v1 — frozen underwriting rules

- **Version string: `policy-v1`** (replaces the `policy-v1-draft` marker).
- Frozen: 2026-09-26, before implementation, per PLAN.md section 4.
- Owner: work package C (packages/policy/, fixtures/). This document is the
  contract between work package C and the integrator (A) / ledger (D) / UI (E).
- Scope: deterministic rule evaluation for the demo. These rules verify rule
  behavior, not predictive credit accuracy. **No output of this policy may be
  presented as a probability of default.**
- Change policy: thresholds below are integers frozen for v1. A v2 must bump
  the version string and re-freeze a new document. Reason codes are additive:
  additions are allowed, renames are not.

---

## 1. Scope, inputs, and honest-use rules

Policy v1 consumes:

- Raw `TransferEvent`s (packages/contracts/src/revenue.ts) as ingested by the
  adapter, plus a `ClassificationContext` of recognized addresses
  (merchant, treasury, faucet senders, known self-funding sources, identified
  non-sale senders, previously classified event references).
- A scan-coverage declaration (gap-free ingested ranges, in seconds) and an
  `anchorSec` (authorization time) with `periodSeconds` (default 86,400).
- Verified token decimals (from the adapter, never assumed) so whole-unit
  thresholds can be scaled to integer base units.

Every function that consumes events carries and returns an **evidence mode**
(`synthetic_fixture` or `observed_testnet`, packages/contracts/src/evidence.ts).
Combining modes in one evaluation is rejected loudly (thrown), never merged.
Insufficient real history returns `insufficient_evidence` in **both** modes —
never a guess, in real-data mode per PLAN section 4 and also for synthetic
fixtures whose history is too thin.

Outputs are versioned with `policyVersion: "policy-v1"` and every sizing
records its full inputs so any offer can show its work.

## 2. Periods

- Period length: **86,400 seconds** (`DEFAULT_PERIOD_SECONDS`), anchored to a
  provided `anchorSec` (authorization time), never implicitly to midnight.
- Window k is the half-open interval
  `[anchorSec + k*86400, anchorSec + (k+1)*86400)`.
- Window index for a timestamp: `k = floorDiv(timestampSec - anchorSec, 86400)`
  (floor division, correct for timestamps before the anchor).
- Only windows that intersect the declared scan coverage are built. A window is
  **complete** iff every second of it lies inside the (merged) scan coverage.
  Complete windows with zero eligible receipts are real observations
  (zero-sales days) and are included in the baseline.
- Snapshots are frozen per window (contracts `RevenueSnapshot`); late
  corrections are append-only adjustments applied to a **later, unprocessed**
  window (section 6). Settled windows are never rewritten.

## 3. Classification (event-level rules)

Identity of an event is `(chainId, txHash, logIndex)`. Events are processed in
deterministic sort order `(timestampSec, blockNumber, logIndex, txHash)` and
the classification result is independent of input batch order.

Rules are evaluated in this frozen priority order; the first match wins.
Every classification returns `classificationVersion: "policy-v1"`, the
`reasonCode`, and a deterministic `provenance` string naming the matched rule
and address/reference.

| #   | Reason code                           | Match condition                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `policy_excluded_duplicate_event`     | `(chainId, txHash, logIndex)` already classified (context `seenEventRefs`) or seen earlier in this batch. The first occurrence is processed; later copies are duplicates.                                                                                                                                                             |
| 2   | `policy_excluded_untracked_token`     | `event.tokenAddress != context.tokenAddress`.                                                                                                                                                                                                                                                                                         |
| 3   | `policy_excluded_unrelated_transfer`  | Neither `from` nor `to` is the merchant address (the merchant is not a party to the transfer).                                                                                                                                                                                                                                        |
| 4   | `policy_excluded_self_transfer`       | `from == to`.                                                                                                                                                                                                                                                                                                                         |
| 5   | `policy_excluded_faucet_distribution` | `from` in context `faucetSenders`.                                                                                                                                                                                                                                                                                                    |
| 6   | `policy_excluded_float_disbursement`  | `from == context.treasuryAddress` (recognizable Float treasury sender).                                                                                                                                                                                                                                                               |
| 7   | `policy_excluded_known_self_funding`  | `from` in context `knownSelfFundingSources` (addresses declared merchant-controlled).                                                                                                                                                                                                                                                 |
| 8   | `policy_excluded_identified_non_sale` | `from` in context `knownNonSaleSenders`; **or** `amountBaseUnits < 0` without a matching eligible payer (see rule 9).                                                                                                                                                                                                                 |
| 9   | `policy_adjustment_refund`            | `amountBaseUnits < 0` **and** `from` is an eligible payer: listed in context `priorIncludedPayers`, or an event classified `policy_included_eligible_sale` earlier in this batch. Refunds are append-only negative adjustments applied to a later unprocessed window (section 6), never to the window they occur in if it is settled. |
| 10  | `policy_excluded_outgoing_transfer`   | `from == context.merchantAddress` and `to != merchantAddress` (money leaving the merchant is never a receipt in v1).                                                                                                                                                                                                                  |
| 11  | `policy_excluded_suspected_circular`  | `from` is a **suspected circular payer**: any address that received an outgoing transfer from the merchant (rule 10 events) anywhere in this batch. Addresses/patterns alone do not prove fraud; such flows are labeled conservatively and excluded from eligible volume.                                                             |
| 12  | `policy_included_eligible_sale`       | None of the above; a positive-amount transfer into the merchant. Included in eligible volume.                                                                                                                                                                                                                                         |

Notes:

- Rule 11's circular set is a batch-level property (computed over all
  non-duplicate rule-10 events), so classification does not depend on event
  order within the batch.
- Canonical refund representation (v1): a refund is a `TransferEvent` with a
  **negative** `amountBaseUnits` from the payer to the merchant
  (money.ts explicitly permits negative amounts for adjustments). The
  adapter/ingestion layer must normalize on-chain refunds to this shape;
  recorded as a contract note in HANDOFF.md.
- Events with positive amounts from the merchant (rule 9) are excluded, not
  refunds, in v1.

## 4. Snapshots

`buildRevenueSnapshots` groups classified events into anchored windows and
produces contracts `RevenueSnapshot`s plus the evidence-mode passthrough:

- `netEligibleAmount` = sum (BigInt, integer base units) of included event
  amounts for the window **plus** refund adjustments applied to that window
  (section 6). May be negative; consumers clamp at zero (section 5/7).
- `completeness`: `complete` iff the window is fully covered by scan coverage
  and the window's period has ended at or before `nowSec` (a window that ends
  after `nowSec` is not evaluated); otherwise `incomplete` with a
  deterministic `completenessNotes` string naming the uncovered range.
- `evidenceMode` is carried from the build context onto every snapshot —
  synthetic and observed data are never silently combined.
- Snapshot `id` is a deterministic UUID-shaped identifier derived by hashing
  the snapshot contents (pure integer hash; no I/O, no randomness).

## 5. Eligibility (decision rules)

All inputs are integers. `whole units` scale to base units as
`whole * 10^tokenDecimals` (verified decimals). Score direction is listed per
rule: "higher is better" thresholds are minimums; "lower is better" thresholds
are maximums.

### Frozen thresholds

| Dimension            | Metric (integer)                                                                                                 | Threshold                                                                                   | Direction        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------- |
| History completeness | any incomplete window in the evaluated series, or non-contiguous window starts                                   | **0 allowed**                                                                               | lower is better  |
| Complete windows     | count of complete windows in the series                                                                          | **>= 21** (`MIN_COMPLETE_WINDOWS`)                                                          | higher is better |
| Active periods       | complete windows with `netEligibleAmount > 0`                                                                    | **>= 15** (`MIN_ACTIVE_PERIODS`)                                                            | higher is better |
| Eligible volume      | sum over complete windows of `max(0, netEligibleAmount)`, base units                                             | **>= 300 whole units** (`MIN_ELIGIBLE_VOLUME_WHOLE_UNITS`)                                  | higher is better |
| Payer concentration  | top payer share of included eligible volume, in bps: `floor(topPayerVolume * 10000 / totalEligibleVolume)`       | **<= 6000** (`MAX_TOP_PAYER_SHARE_BPS`, i.e. 60%)                                           | lower is better  |
| Volatility           | `floor(maxActiveDay * 10000 / max(1, floor(totalEligibleVolume / activePeriods)))` in bps, over complete windows | **<= 25000** (`MAX_ACTIVE_DAY_VOLATILITY_BPS`, i.e. max active day <= 2.5x mean active day) | lower is better  |
| Suspicious flows     | included volume from suspected circular payers                                                                   | **0** (any excluded suspected-circular volume triggers decline)                             | lower is better  |

Details frozen with the thresholds:

- Volatility is measured over **active** days only (zero-sales days are
  already penalized by the active-period threshold; the baseline separately
  includes them). If `activePeriods == 0`, concentration and volatility are
  skipped (not computed) — the series fails on active periods.
- Payer concentration is computed over **included** eligible sale events
  joined to complete windows, grouped by sender address.
- If `totalEligibleVolume == 0` the reason is `policy_no_eligible_receipts`;
  the volume-minimum check applies only when `0 < total < minimum` (avoiding
  duplicate reasons).
- The evaluation series must be contiguous: consecutive snapshot windows must
  have the same duration and start exactly one period apart; a gap is treated
  as incomplete history. Mixing evidence modes across a series, or snapshots
  of different merchants, is a structural error and is **thrown** (never
  silently combined).

### Decision mapping (frozen precedence)

1. **`insufficient_evidence`** if any of: empty series (`policy_no_snapshots`),
   any incomplete window or non-contiguous series
   (`policy_history_incomplete`), complete windows < 21
   (`policy_insufficient_history_windows`), active periods < 15
   (`policy_insufficient_history_active_periods`), zero eligible receipts
   (`policy_no_eligible_receipts`).
2. Else **`declined`** if any of: `0 < totalVolume < 300 whole units`
   (`policy_eligible_volume_below_minimum`), top-payer share > 6000 bps
   (`policy_payer_concentration_above_cap`), volatility > 25000 bps
   (`policy_volatility_above_cap`), any suspected-circular volume
   (`policy_suspicious_flow_detected`).
3. Else **`eligible`** with `policy_meets_all_thresholds`.

All triggered reason codes are returned (in the frozen order above), not just
the first: the decision takes the highest severity
(`insufficient_evidence` > `declined` > `eligible`), and the reason list shows
every failed check. `policy_mixed_evidence_modes` is used when mode mixing is
detected defensively (it is also thrown as a structural error).

`evaluateEligibility` returns the decision, reason codes, evidence mode,
snapshot ids (evidence references), and the metric values (complete windows,
active periods, total eligible volume, top-payer share bps, volatility bps,
conservative baseline) so every decision can show its work.

## 6. Refunds and settled windows (append-only)

- A refund (rule 9) originating in window w is applied to the **first window
  strictly after w that is not in the settled set** (`settledWindowStartsSec`),
  as a negative adjustment added to that window's `netEligibleAmount`.
- Windows in the settled set are never modified: re-running the builder with a
  larger settled set leaves earlier snapshots byte-identical.
- Refunds with no later unprocessed window remain in
  `deferredAdjustments` (carried forward until offset); they never disappear
  and never rewrite the past.
- Collection budgets consume `max(0, netEligibleAmount)` per window (PLAN
  section 3); negative windows reduce the baseline only to zero.

## 7. Conservative baseline, horizon, haircut, and sizing

- **Baseline (conservative receipts):** the **25th percentile (2500 bps) of
  per-window `max(0, netEligibleAmount)` over complete windows, ascending
  sort, index `floor((n-1) * 2500 / 10000)`, including zero-sales days**
  (`BASELINE_PERCENTILE_BPS = 2500`). Incomplete windows are excluded from the
  baseline entirely.
- **Forecast horizon: 14 periods** (`FORECAST_HORIZON_PERIODS = 14`,
  14 x 86,400 s), matching units to the collection-period duration. Each
  horizon period's conservative receipts are the baseline value (v1 has no
  seasonality model; the per-period array exists so a v2 can vary it).
- **Sizing formula (PLAN section 4, integer math only):**

  ```
  capacity = sum over p in 0..horizon-1 of
               min( floor(rate_bps * conservative_receipts[p] / 10000),
                    period_ceiling_base_units )
  principal <= floor(capacity * haircut_bps / 10000)
  principal <= max_principal_base_units          (absolute demo cap)
  principal  = min of the above (0 if capacity is 0)
  ```

- **Defaults (scaled by verified decimals, integer base units):**

  | Parameter                            | Frozen value                              |
  | ------------------------------------ | ----------------------------------------- |
  | `DEFAULT_COLLECTION_RATE_BPS`        | **1000** (10.00% of eligible receipts)    |
  | `DEFAULT_PERIOD_CEILING_WHOLE_UNITS` | **100** (per-period collection ceiling)   |
  | `SIZING_HAIRCUT_BPS`                 | **5000** (50% haircut on capacity)        |
  | `MAX_PRINCIPAL_WHOLE_UNITS`          | **500** (absolute demo maximum principal) |
  | `FORECAST_HORIZON_PERIODS`           | **14**                                    |
  | `BASELINE_PERCENTILE_BPS`            | **2500**                                  |
  | `DEFAULT_PERIOD_SECONDS`             | **86400**                                 |

- Sizing runs only for `eligible` decisions; any other decision yields no
  principal (`policy_not_sized_non_eligible_decision`). Estimated payoff dates
  are conditional on future receipts; they are never guarantees.
- All basis-point rates are integers 0..10000; amounts are BigInt base units;
  floats never enter an amount (enforced by tests).

## 8. Reason codes (stable, additive)

Classification-level: `policy_included_eligible_sale`,
`policy_excluded_duplicate_event`, `policy_excluded_untracked_token`,
`policy_excluded_unrelated_transfer`, `policy_excluded_self_transfer`,
`policy_excluded_faucet_distribution`, `policy_excluded_float_disbursement`,
`policy_excluded_known_self_funding`, `policy_excluded_identified_non_sale`,
`policy_excluded_outgoing_transfer`, `policy_excluded_suspected_circular`,
`policy_adjustment_refund`.

Decision-level: `policy_no_snapshots`, `policy_history_incomplete`,
`policy_insufficient_history_windows`,
`policy_insufficient_history_active_periods`, `policy_no_eligible_receipts`,
`policy_eligible_volume_below_minimum`,
`policy_payer_concentration_above_cap`, `policy_volatility_above_cap`,
`policy_suspicious_flow_detected`, `policy_meets_all_thresholds`,
`policy_mixed_evidence_modes`, `policy_not_sized_non_eligible_decision`.

These are policy-local codes (packages/policy). They surface verbatim in
`Offer.reasonCodes` (contracts types allow `string` reason codes); they are
not added to the API-level `REASON_CODES` enum in packages/contracts (that
enum covers request/auth/lifecycle failures, and additions there belong to the
integrator).

## 9. Score direction summary

| Signal                           | Good direction | Bad direction                 |
| -------------------------------- | -------------- | ----------------------------- |
| Eligible volume                  | higher         | below 300 whole units         |
| Active periods                   | higher         | below 15                      |
| Complete windows                 | higher         | below 21, any gap             |
| Payer concentration              | lower          | above 6000 bps                |
| Volatility (max/mean active day) | lower          | above 25000 bps               |
| Suspicious flows                 | none           | any suspected-circular volume |

The policy returns only `eligible`, `declined`, or `insufficient_evidence`
with reason codes and evidence references. It does not produce probabilities,
scores presented as probabilities, or credit-performance claims.
