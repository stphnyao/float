# Float — Demand validation plan and evidence status

Prepared 2026-09-26 by work package F. Follows PLAN.md §2 ("Product assumptions to validate early") and the project rule that no demand claims may be invented.

**Status: VALIDATION INCOMPLETE — no customer interviews, surveys, signups, or letters of intent exist as of this date. Everything below is hypothesis and method, not evidence. This banner must stay until real interviews are recorded.**

## 1. Customer hypothesis (to be tested, not asserted)

Float's stated target (PLAN §2): **small B2B service businesses that receive identifiable stablecoin payments from their customers.**

Hypothesis, broken into testable parts:

1. **Who:** Small service businesses (agencies, consultancies, dev shops, freelancers/studios, contractors) paid business-to-business in stablecoins, on Tempo or other chains. Tempo is a payments-focused chain whose TIP-20 token standard includes "built-in fee payment, payment lanes, transfer memos, and compliance policies," and its docs describe stablecoin transfers with "optional memos for reconciliation and tracking" ([Tempo developer docs](https://tempo.xyz/developers), reached via redirect from docs.tempo.xyz). This makes "identifiable receipts" technically plausible on Tempo; whether real operators fit this profile is exactly what interviews must establish.
2. **Funding need:** That these businesses sometimes experience a timing gap between doing the work / invoicing and the money being usable (client payment terms, batch payout schedules, or waiting to convert/withdraw), and that the gap occasionally causes costly friction (delayed payroll, contractor payments, or passed opportunities). PLAN §2 names this as a question ("Investigate funding needs"), not a fact.
3. **Attribution:** That they can identify which incoming stablecoin payments are customer sales (via memos, invoices, or accounting records) — a precondition for revenue-linked collections. Tempo's transfer memos are a candidate mechanism; operators' actual record-keeping habits are untested.
4. **Alternatives:** That "do nothing" (hold a cash buffer, delay outgoing payments), asking clients to pay faster, and conventional financing (invoice factoring, revenue-based advances, credit lines) are the realistic alternatives today. See §3 for what these cost per industry sources.
5. **Willingness to authorize automated collections:** That at least some operators would grant a scoped, capped, revocable spending authorization to a financing counterparty for a small advance. Tempo access keys (TIP-1011) support periodic spending limits, destination/function scoping, and expiry, and can be revoked ([TIP-1011](https://github.com/tempoxyz/tempo/blob/main/tips/tip-1011.md); [viem Tempo access-key docs](https://viem.sh/tempo/actions/accessKey.signAuthorization)). Whether operators will actually delegate this is an open behavioral question — arguably the single riskiest assumption in the product.

Disconfirmation is meaningful: if interviews show operators have no timing gap, cannot attribute receipts, or will not authorize automated collection, the hypothesis fails and the submission should say so.

## 2. Target operator profile (for recruiting interviews)

Inclusion criteria:

- Receives B2B payments from business clients in stablecoins at least monthly, OR has done so within the last 6 months.
- Team size roughly 1–20 (small enough that working-capital timing is felt by the owner).
- Service business (time/output-based invoicing), so receipts plausibly map to revenue.
- The person interviewed makes or strongly influences financial decisions.

Exclusion criteria (to keep the sample honest):

- Crypto-native trading/DeFi firms, exchanges, or payment processors whose "receipts" are not customer sales.
- Businesses where the interviewer cannot see actual payment flows.
- Friends/family who would give polite answers rather than real ones (or, if used, labeled as convenience-sample).

Quota guidance: PLAN §2 seeks "at least three operator interviews if accessible." Aim for 5–8 to allow disagreement; record actual counts.

## 3. Current alternatives (context for interviews — sourced where external)

These are the alternatives the interview should explore neutrally (the interview must not present this table as fact):

- **Do nothing / buffer:** hold extra cash or time outgoing payments. Cost: idle capital; no external claims made.
- **Ask clients to change payment behavior:** deposits, shorter terms, paying on receipt.
- **Invoice factoring:** factoring-industry sources report advance rates of roughly 70–95% of invoice value and discount fees of roughly 1–5% per invoice or per month, with effective annualized cost often far above the headline rate for slow-paying customers. Sources are industry marketing pages, not independent verification: [Factor Finders](https://www.factorfinders.com), [ei Funding](https://eifunding.com), [Comcap Factoring](https://www.comcapfactoring.com), [AltLINE](https://altline.sobanco.com). Treat these ranges as background context, and let interviewees state their own numbers.
- **Revenue-based financing / merchant cash advances:** repay as a percentage of future receipts — structurally the closest traditional analog to Float. No specific provider pricing is cited here because none has been verified for this population.
- **Bank/fintech credit lines:** availability for small service businesses varies; not verified in this research pass.

Whether stablecoin-native working-capital products already serve this segment was **not** verified in this research pass; if any exist, they are competitors and should be named in a future revision of this document.

## 4. Interview questions (neutral, non-leading)

Rules used when writing these: past behavior over hypotheticals; no mention of Float's mechanism before Q8; every question can be answered without agreeing with us; no question presumes the pain exists.

1. Walk me through what happens between finishing a piece of client work and that money being usable by the business. Where does time pass?
2. When a client pays you in stablecoins, how do you know it arrived, and how do you record what it was for?
3. How do you currently tell the difference between a customer payment, a refund, and money moving between your own wallets or accounts?
4. Think of the last time a payment you were expecting was late. What did you do about it, and what did it cost you, if anything?
5. Have you ever delayed payroll, a contractor, a supplier, or a personal withdrawal because client money hadn't arrived? What happened?
6. What options have you tried or considered for bridging that kind of gap? What did they cost, and what did you like or dislike?
7. Who keeps the books, and what would your accountant or bookkeeper need to see to be comfortable with a new financial tool?
8. Concept check (shown only here): a service that advances a small amount now and recovers it automatically as a percentage of incoming customer payments, capped per period and revocable by you. What questions would you need answered before deciding? What would make you refuse?
9. Have you ever given another tool or person permission to move money out of your account or wallet automatically? What convinced you, and what limits did you set?
10. If you stopped receiving stablecoin payments from clients tomorrow, what would you have lost, if anything?

Notes for the interviewer: record exact wording of objections; do not pitch, correct, or sell; capture whether the funding gap exists unprompted (Q1/Q4/Q5) versus only after the concept is introduced (Q8) — that distinction is the core signal.

## 5. Outreach plan (owner-run; agents do not contact anyone)

Per PLAN §10: "External outreach, posting, or submission requires user direction." The following is a plan the owner can choose to run.

- **Channels, in order of expected signal quality:**
  1. Warm network: owners the Stephen knows who already invoice clients in stablecoins.
  2. Tempo ecosystem communities (e.g., the Tempo/Colosseum Discord servers used for the hackathon) — ask for operators, not builders.
  3. Freelancer/agency communities where stablecoin payment is discussed (r/freelance, agency Slack/Discord groups, X) — owner posts as a founder doing research, not as a product pitch.
  4. Accounting/bookkeeping professionals who serve crypto-paid clients (they see the record-keeping reality and often broker financial-tool decisions).
- **Sample outreach message (neutral):**
  > Hi [name] — I'm researching how small service businesses that get paid in stablecoins handle the wait between invoicing and using the money. 15–20 minutes, no pitch, I'm not selling anything. Would you be open to a call this week? Happy to share a summary of what I learn.
- **Protocol:** 15–20 minutes; video call; ask for consent to record; use the §4 questions in order; capture verbatim quotes for Q4, Q5, Q8, Q9; do not demo the product.
- **Recording template (one row per interview):** date; operator type; team size; stablecoin share of receipts; attribution method; timing gap exists (Y/N, unprompted?); alternatives tried and cost; automation-authorization reaction; verbatim objection; follow-up consent.
- **Stop condition:** stop after 8 interviews or when responses saturate, whichever comes first; PLAN's minimum is 3.

## 6. Evidence status (honest)

| Evidence type                                                 | Status as of 2026-09-26                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Operator interviews                                           | **None.**                                                                                                                        |
| Surveys or polls                                              | **None.**                                                                                                                        |
| Signups / waitlist / LOIs                                     | **None.**                                                                                                                        |
| Observed merchants receiving stablecoin B2B payments on Tempo | **None.** G1 (Tempo integration) is NOT STARTED per [spike/RESULTS.md](../spike/RESULTS.md); no live receipts of any kind exist. |
| Competitor/alternative pricing verified first-hand            | **None** (§3 ranges are from industry marketing sources).                                                                        |

Consequences for the submission:

- Any portal field asking for "demand validation" must be answered with the hypothesis, the interview plan, and an explicit "no interviews completed yet" statement unless real interviews exist by submission time.
- Judging includes "Traction" per the [Colosseum FAQ](https://colosseum.com/hackathon); Float claims none and must not imply any.
- If even 3 interviews are completed, update §6 with dated, quotable findings (including disconfirming ones) and cite this file from the submission form.

## Sources

- [PLAN.md §2, §7, §10](../PLAN.md) — customer hypothesis, interview minimum, outreach ownership.
- [Tempo developer docs](https://tempo.xyz/developers) — TIP-20 memos for reconciliation; payments focus; Moderato testnet.
- [TIP-1011: Enhanced Access Key Permissions](https://github.com/tempoxyz/tempo/blob/main/tips/tip-1011.md) — periodic limits, scoping, expiry, revocation semantics.
- [viem Tempo access keys](https://viem.sh/tempo/actions/accessKey.signAuthorization) — authorization entry point.
- [Colosseum hackathon FAQ](https://colosseum.com/hackathon) — judging factors incl. Traction; portal field for demand validation.
- Factoring cost context (industry sources, unverified independently): [Factor Finders](https://www.factorfinders.com), [ei Funding](https://eifunding.com), [Comcap Factoring](https://www.comcapfactoring.com), [AltLINE](https://altline.sobanco.com).
