# Float — Pitch video outline (presentation video, 2–3 minutes)

Prepared 2026-09-26 by work package F. Requirement source: the Colosseum FAQ describes the submission as "a two-to-three-minute presentation video" and notes it is "one of the first resources judges review" ([FAQ](https://colosseum.com/hackathon)). Target length: **2:30**, leaving buffer inside the 2–3 minute window.

Rules observed throughout: no invented demand claims (PLAN); every on-screen figure comes from the actual demo run or is labeled as hypothetical; all content in English ([rules §12(a)(i)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)).

**Anything marked [RECORD AT G4] requires real recorded evidence (wallet screens, transaction hashes, explorer views) per PLAN gate G4, and must not be fabricated or simulated.**

## Global on-screen elements

- Lower-third: "Float — revenue-linked advances on Tempo" (persistent for first 30 seconds).
- Evidence labels always visible when app screens appear: `SYNTHETIC FIXTURE` (green-bordered) or `OBSERVED TESTNET` (chain-icon), per PLAN §4's two evidence modes.
- Footer chip during any accelerated-time segment: "accelerated demo period — actual duration: Xs" (PLAN §3: labeled with its actual duration).
- No background music with vocals; no third-party assets without license check (disclosure-review open item).

## Shot list

### 0:00–0:20 — Problem (framed as hypothesis, not proven demand)

- **Visuals:** simple animated invoice timeline: work delivered → invoice sent → waiting → payroll due. Calendar pages flip.
- **Narration:** "Service businesses that invoice in stablecoins can face a familiar squeeze: the work is done, but the money lands on someone else's schedule. Payroll and contractors don't wait."
- **On-screen label:** "Hypothesis under validation — see demand-validation.md" (small text; honesty is part of the pitch).

### 0:20–0:50 — Solution

- **Visuals:** three-step diagram animates: 1) Float evaluates eligible stablecoin receipts → 2) merchant gets a small, fixed-term advance → 3) repayment collected automatically as a percentage of future eligible receipts, capped per period, within a merchant-authorized spending limit.
- **Narration:** "Float advances working capital against a merchant's real, verifiable stablecoin receipts — and repays itself from future receipts, inside limits the merchant explicitly authorizes and can revoke at any time."
- **On-screen labels:** "Advance" / "Repay % of eligible receipts" / "Merchant-authorized limit".

### 0:50–1:30 — How it works (demo teaser, labeled evidence)

- **Visuals:** 3–4 quick cuts from the actual dashboard:
  1. Receipt history with evidence label visible [RECORD AT G4].
  2. The reasoned offer: principal, total obligation, collection percentage, period ceiling, authorization expiry [RECORD AT G4].
  3. Wallet authorization screen, then confirmed funding and treasury balance change [RECORD AT G4].
  4. Ledger view: a confirmed repayment reducing outstanding [RECORD AT G4].
- **Narration:** "Every offer is built from classified receipt evidence, with the reason shown. The merchant accepts in their own wallet. Funding is a real on-chain transfer. Repayment collects only against eligible post-funding receipts, and the ledger shows every step."
- **On-screen labels:** evidence mode label; "immutable offer terms"; "confirmed, not pending" on funding.

### 1:30–2:00 — Trust boundaries (the honest middle)

- **Visuals:** split screen: left, the access-key scope card (token, function, recipient, per-period ceiling, expiry); right, three red-flag icons.
- **Narration:** "The Tempo access key bounds what Float can collect — token, recipient, per-period ceiling, expiry. It does not guarantee repayment. The merchant can revoke it, the wallet can be empty, and future sales can go elsewhere. Float's ledger tracks the debt; the chain enforces the limits. Both are shown to the merchant, always."
- **On-screen labels:** "scoped + capped + revocable"; "not a guarantee of repayment" (explicit).
- Also show the cap-rejection moment in one cutaway [RECORD AT G4].

### 2:00–2:30 — Why Tempo, business, and next step

- **Visuals:** Tempo badge; TIP-20 transfer memo field highlighted; one line on the business model; closing card.
- **Narration:** "Float is built on Tempo, where stablecoin transfers carry memos for reconciliation and fees are paid in stablecoins. The demo is testnet-only. In production, advances would be funded by a dedicated lending facility, with losses borne by that facility — the assumptions are published in our repo. Next step: operator interviews to test the funding-gap hypothesis. The full evidence, limits, and business assumptions are open-sourced."
- **On-screen labels:** "Testnet demo"; "Business assumptions + demand status: /submission in repo"; repo URL.
- **End card:** "Float — advances that follow real revenue. MIT-licensed. Evidence over claims."

## Narration constraints

- Total words ≈ 340–380 for 2:30 at a natural pace.
- Forbidden phrases: any user counts, revenue numbers, pilot claims, "our customers", "proven demand". Permitted: "hypothesis", "under validation", "testnet demo".
- If G4 evidence is not ready by G5, cut the affected shots rather than faking them; the video must still stand at 2–3 minutes using labeled synthetic fixtures only, with narration adjusted to say "fixtures" (PLAN §8 fallback).

## Source for requirements

- [Colosseum hackathon FAQ](https://colosseum.com/hackathon) — pitch video length ("two-to-three-minute presentation video").
- [Official rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) — content-in-English rule; judging criteria (Functionality, UX, Business Plan) this outline targets.
- [PLAN.md §9](../PLAN.md) — demo script and honesty constraints this outline mirrors.
