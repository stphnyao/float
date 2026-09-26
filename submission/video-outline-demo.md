# Float — Demo video outline (≤ 3 minutes)

Prepared 2026-09-26 by work package F. Requirement source: the Colosseum FAQ requires "no more than three minutes explaining how the product works" ([FAQ](https://colosseum.com/hackathon)). Target length: **2:50** hard stop.

This outline follows [PLAN.md §9's demo script](../PLAN.md) beat for beat: eligible history + evidence label → reasoned offer → accept + authorize → confirmed funding → post-funding receipts + repayment + ledger → cap rejection + revocation → suspicious/insufficient decisions → problem + next step.

**Anything marked [RECORD AT G4] requires real recorded evidence captured at gate G4 (wallet screens, transaction hashes, explorer views, balance changes) and must not be simulated or faked. Where a live capture is impossible, use labeled synthetic fixtures and say so in narration (PLAN §8).**

## Global on-screen elements

- Persistent evidence-mode chip top-right on every app shot: `SYNTHETIC FIXTURE` or `OBSERVED TESTNET` (PLAN §4's two modes; never mixed silently).
- Persistent accelerated-time chip whenever periods advance faster than real time: "accelerated demo period — actual duration: Xs" (PLAN §3: labeled with actual duration; a short reset test must not be narrated as a 24-hour rollover).
- Explorer badge bottom-left on any on-chain event; clicking is not required but the explorer must be reachable (PLAN §9: "Keep explorer evidence accessible without making a terminal the primary product interface").
- Cursor zoom + slow-down on every transaction confirmation.

## Shot list

### Beat 1 — Eligible history, evidence label, reasoned offer (0:00–0:35)

- **Visuals:** merchant dashboard opens on the receipt history. Evidence chip `SYNTHETIC FIXTURE` (or `OBSERVED TESTNET` if the profile is real ingestion) is clearly visible. Scroll through a 30-day history; click one receipt open to show classification reason, provenance, and version. Navigate to the offer.
- **Narration:** "This merchant's receipts are classified into eligible and excluded — faucet transfers, self-transfers, and refunds are filtered out, and every classification carries a reason and version. The evidence mode is labeled on screen at all times."
- **On-screen labels:** evidence chip; `classification v1 · reason: customer_payment · provenance: tx …` (truncated hash) [RECORD AT G4 for any real hash].

### Beat 2 — Offer terms: application-versus-chain guarantees (0:35–1:00)

- **Visuals:** full offer card, zoomed section by section: principal; total obligation (= principal for this demo); collection percentage; per-period ceiling; authorization expiry; estimated collection horizon marked "conditional".
- **Narration:** "The offer is immutable once accepted. Two layers enforce it: Float's ledger decides what is owed and what counts as eligible revenue. The Tempo access key enforces the spending ceiling, the token, the recipient, and the expiry. The app cannot spend outside the key, and the key cannot decide what is owed."
- **On-screen labels:** `application: what is owed` / `chain: what may be collected`; `principal-only demo — no fees` (PLAN §2).

### Beat 3 — Accept + authorize in wallet; confirmed funding (1:00–1:35)

- **Visuals:** merchant clicks Accept; wallet opens showing the access-key authorization request with scopes and period limit visible; merchant confirms. Dashboard shows authorization state moving to valid, then the funding transaction submitting → confirmed, with balance change on both sides. Show the full tx hash and explorer link.
- **Narration:** "Acceptance binds the frozen terms hash. The merchant authorizes a dedicated delegated key in their own wallet — scoped to one token, one recipient, a per-period limit. Funding is a real testnet transfer, and the dashboard only switches to active on confirmation — a broadcast is not a confirmation."
- **On-screen labels:** [RECORD AT G4: wallet authorization screen, funding tx hash, before/after balances]; `confirmed funding` state chip.

### Beat 4 — Post-funding receipts, confirmed repayment, ledger (1:35–2:05)

- **Visuals:** accelerated-period chip appears: "accelerated demo period — actual duration: Xs" [RECORD AT G4: the deployed chain's actual short-period support]. New receipts arrive post-funding, labeled eligible. The worker's collection budget is shown: percentage of prior-period eligible receipts, capped by ceiling and outstanding. The repayment transaction submits → confirmed; outstanding decreases in the ledger.
- **Narration:** "Repayment collects only against eligible receipts from completed periods after funding. The budget is the minimum of the percentage, the agreed ceiling, and the outstanding balance — then it's capped again by the live on-chain allowance. Every collection is a confirmed transaction in the ledger."
- **On-screen labels:** accelerated-period chip [RECORD AT G4]; budget math overlay: `min(rate × eligible, ceiling, outstanding, on-chain remaining)`; [RECORD AT G4: repayment tx hash].

### Beat 5 — Cap rejection and merchant revocation (2:05–2:35)

- **Visuals:** a collection attempt larger than the remaining per-period allowance is rejected; show the decoded protocol error and the unchanged balances — fund the demo so the cap error is isolated, not a balance failure (G1 matrix). Then the merchant revokes the key in the wallet; dashboard authorization state flips to `revoked — confirmed`, and the worker pauses with the accurate reason.
- **Narration:** "If a collection exceeds the period ceiling, the chain rejects it — nothing moves. And the merchant is always in control: revoking the key stops all future collection. Float shows the revocation as confirmed on-chain before it changes the dashboard state."
- **On-screen labels:** `SpendingLimitExceeded` (exact decoded error) [RECORD AT G4]; `revoked — confirmed on-chain` [RECORD AT G4].

### Beat 6 — Suspicious and insufficient decisions; problem + next step (2:35–2:50)

- **Visuals:** two quick decision cards: a suspicious profile declined with reason codes (circular-flow suspicion labeled conservatively), and a real-data mode profile returning `insufficient_evidence`. Close on the problem/next-step card.
- **Narration:** "Not everyone gets funded. Concentrated or suspicious flows are declined with reasons, and thin history returns 'insufficient evidence' rather than a guess. The open question isn't the rails — it's whether operators want this and will authorize it. That's our next validation step: real operator interviews. The results, and all limits, are in the open repo."
- **On-screen labels:** `declined · reason codes …`; `insufficient_evidence`; `validation incomplete — interviews pending` (link to submission/demand-validation.md).

## Recording checklist (G4)

- [ ] Wallet authorization screen with visible scopes/limit (Beat 3).
- [ ] Funding tx: full hash, explorer view, before/after balances (Beat 3).
- [ ] Accelerated period actually supported by the deployed chain; its real duration on screen (Beat 4).
- [ ] Repayment tx: full hash, ledger delta (Beat 4).
- [ ] Exact decoded cap-rejection error with unchanged balances (Beat 5).
- [ ] Revocation confirmed on-chain; dashboard state flips only after confirmation (Beat 5).
- [ ] Explorer reachable from the dashboard for every hash shown (global).
- If any item is unavailable at recording time: use labeled fixtures and adjust narration per PLAN §8; do not fake.

## Source for requirements

- [Colosseum hackathon FAQ](https://colosseum.com/hackathon) — demo video "no more than three minutes."
- [PLAN.md §9](../PLAN.md) — demo beats, labeling duties (evidence modes, accelerated periods), explorer accessibility.
- [PLAN.md §7 G1/G3-G4 matrices](../PLAN.md) — what each captured rejection/confirmation must actually prove.
- [Official rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) — all content in English; Functionality/UX judging criteria.
