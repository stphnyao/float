# Colosseum Crypto World's Fair — Submission checklist for Float

Prepared 2026-09-26 by work package F (product/submission). Sources were loaded on this date; quote text below is from the loaded pages. Nothing here is invented; anything we could not verify is marked **unverified**.

Sources consulted:

- Event page: <https://colosseum.com/worldsfair> — loaded 2026-09-26.
- Hackathon FAQ: <https://colosseum.com/hackathon> — loaded 2026-09-26.
- Official rules PDF (8 pages): <https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf> — downloaded and read in full 2026-09-26.
- `https://colosseum.com/tempo` — **returned HTTP 404**; no Tempo-track landing page was found at that URL. Tempo track existence is confirmed via the rules PDF instead (see below).

---

## 1. Confirmed deadline and logistics

| Item | Requirement | Source |
| --- | --- | --- |
| Submission deadline | "Submissions due October 12, 2026" (event page). Rules: Contest Period "ends at 11:59pm PT on October 12, 2026." | [worldsfair](https://colosseum.com/worldsfair); [rules §5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) |
| Registration deadline | Each member must register on the colosseum.com platform "before 11:59pm PT on October 12, 2026"; after that "the individual registration form will be disabled" and unregistered members are disqualified. | [rules §6(a)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) |
| Who uploads | "the team leader must upload the Project Submission before the end of the Entry Period." | [rules §6(b)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) |
| Limits | "Entrant may only be a Member of one (1) Team. A Team may only submit one (1) Project Submission at a time." | [rules §7](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) |
| Winners announced | "on or about December 5, 2026" (rules); FAQ says "roughly one month after the submission deadline" — **discrepancy between sources; the rules' Dec 5 date is the binding one.** | [rules §5, §13](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf); [FAQ](https://colosseum.com/hackathon) |
| Platform | Registration and submission happen on colosseum.com. No Devpost is mentioned anywhere in the three sources; no separate Tempo-track form was found (see §7 below). Matches PLAN §9's "Do not assume Devpost or a separate Tempo form." | All three sources |
| Finalist step | Finalists get "a 15-minute Zoom interview." | [FAQ](https://colosseum.com/hackathon) |
| Winner follow-up | Winning requires executing Prize Acceptance Documents and passing due diligence; prizes are paid to the Team Leader, who "may be required to set up a wallet address … to receive the cash component of the prize." | [rules §13, §15(b)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) |
| Confidentiality | "Entrants should not assume any right of confidentiality in any data or information divulged related to … Project Submission and/or Profile Information." Submitting means agreeing to share provided information with judges and sponsors. | [rules §7, §11](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) |
| Content language | "All Content must be in English." | [rules §12(a)(i)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) |

Float-specific logistics status (owner actions):

- [ ] Owner (Stephen Yao, solo team = Team Leader) is registered on colosseum.com with Profile Information complete. Not yet evidenced here; confirm before Oct 12.
- [ ] Owner uploads the single Project Submission before the deadline. PLAN §9 assigns this to the user; agents do not submit.
- [ ] Owner retains the confirmation privately (PLAN §9). Note the rules' no-confidentiality clause above does not prevent this.

## 2. Submission form fields (per FAQ)

The FAQ describes what the portal asks for. The live portal may differ; verify each field when submitting.

| Field | What the FAQ says | Float's material |
| --- | --- | --- |
| Product name and brief description | Portal asks for "product name and brief description." | One-paragraph description: revenue-linked merchant advances on Tempo testnet — evaluate eligible stablecoin receipts, offer a small advance, collect repayments within merchant-authorized spending limits (matches PLAN §1; keep testnet framing explicit). |
| Blockchains/tools integrated | Portal asks for "blockchains/tools integrated." | Tempo (Moderato testnet), TIP-20 stablecoin, viem Tempo integration, Next.js, Postgres, Node worker. Final wording must reflect what actually passed gates G1–G4 by submission time. |
| Teammates with backgrounds | Portal asks for "teammates with backgrounds"; every member needs an account and the team leader adds them at submission. Solo founders are allowed. | Stephen Yao (solo). Background text is the owner's to supply — agents must not draft personal claims. |
| Team location | Portal asks for "team location." | Owner supplies; agents must not invent. |
| Product logo/graphic | Portal asks for "product logo/graphic." **No dimensions, format, or size limits were published on any of the three sources. Mark: unverified — check portal.** PLAN §9's "do not invent logo dimensions" holds; no dimensions exist to cite. | Not yet produced. |
| GitHub repository | Portal asks for a "GitHub repo link." FAQ: open-source repos encouraged; private repos allowed if "access is granted to hackathon@colosseum.com for review." | Repo is public and MIT-licensed (`LICENSE` at repo root). Note: the rules' judging criteria include "Open-source: Is this Project Submission open-source?" ([rules §8(e)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)), which supports PLAN §9's public-MIT choice. |
| Go-to-market strategy with demand validation | Portal asks for a "go-to-market strategy with 'demand validation, and plans for developing distribution.'" | Point to `submission/demand-validation.md`. **Current status must be stated as hypothesis-only; no interviews exist yet.** Per PLAN, invented demand claims are forbidden. |

## 3. Video requirements

| Video | Requirement | Source |
| --- | --- | --- |
| Presentation (pitch) video | "A two-to-three-minute presentation video" — described as "one of the first resources judges review." | [FAQ](https://colosseum.com/hackathon) |
| Demo video | "no more than three minutes explaining how the product works." | [FAQ](https://colosseum.com/hackathon) |
| Recommended (not required) weekly updates | "a concise, one-minute video" per week, described as recommended. PLAN §9's reading ("recommended … not asserted as a requirement") is confirmed. | [FAQ](https://colosseum.com/hackathon) |

Outlines drafted for these: `submission/video-outline-pitch.md` (2–3 min) and `submission/video-outline-demo.md` (≤3 min).

## 4. Judging (two different lists — flagged, not silently reconciled)

The rules and the FAQ publish **different** judging factor lists, with no weights in either source:

- Rules §8 criteria: (a) Functionality ("How well does this Project Submission work? What is the quality of the code?"), (b) Potential Impact (market size; impact on the broader crypto ecosystem), (c) Novelty, (d) UX, (e) Open-source, (f) Business Plan ("Is there a viable business that can be built in the future around this Submission? How adept is the team building the product to execute on the vision?"). Source: [rules §8](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf).
- FAQ judging factors: "Founder + Market Fit; Insight; Product + Execution; Potential Market Size; Founder Communication; Viability; Traction." Source: [FAQ](https://colosseum.com/hackathon).

Implication for Float: the rules' Functionality/UX criteria reward a working, evidenced demo; the Business Plan criterion is answered by `submission/business-assumptions.md` and the honest demand-validation status; the Open-source criterion supports keeping the public MIT repo. The FAQ's "Traction" factor is where we must stay honest: we claim none (see `demand-validation.md` §Evidence status).

## 5. Eligibility (confirm once, then ignore)

- Age of majority or 18+ at contest start ([rules §3(a)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)).
- Sanctions/embargo exclusions and exclusion of employees of Administrator/sponsors ([rules §3(b)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)).
- "Open to startups that haven't 'raised significant outside capital'" ([FAQ](https://colosseum.com/hackathon)).
- Participation must not violate employer policies ([rules §3(c)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)).

Float's work started 2026-09-26 (git history), inside the Contest Period, which "starts at 6:00am PT on September 14, 2026" ([rules §5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)).

## 6. Track and prizes

- **Tempo track confirmed:** "Tempo track: $100,000 will be awarded across 10 of the best products that integrate with the Tempo blockchain" ([rules §14(f)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)). The event page lists Tempo among the ecosystem tracks and its prize section shows the Solana example as "$100,000 Track prize pool / 10 projects receive $10,000 each," with track prizes awarded "in addition to the awards above" ([worldsfair](https://colosseum.com/worldsfair)).
- Overall prizes (rules §14, values before taxes): Grand Champion $30,000 Phantom CASH stablecoin; Public Goods Award $5,000; University Award $5,000; $15,000 CASH to each of the next 20 standout teams. Event page totals: "$840,000 in prizes and $2.5 million in seed funding"; all hackathon winners are interviewed and considered for the accelerator ($250,000 pre-seed; joining is not required) ([rules §14](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf); [worldsfair](https://colosseum.com/worldsfair); [FAQ](https://colosseum.com/hackathon)).
- **No track-specific submission fields were found** in any source, and the Tempo landing page URL 404'd. Treat the Tempo track as a prize category judged through the same submission, not a separate form. **Unverified — check portal for any track selector.**

## 7. Disclosure obligations (drives `DISCLOSURE.md` and `submission/disclosure-review.md`)

- FAQ: "Pre-existing code is permitted but 'teams must disclose all relevant past development work'"; misrepresentation "can mean disqualification, bans, or prize revocation." ([FAQ](https://colosseum.com/hackathon))
- Rules §9: "Entrants agree to inform Administrator of the status and ownership of any open-source or other third party code … related to their Project Submission." ([rules §9](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf))
- Products are "judged only on the work completed between the competition's start and end dates." ([FAQ](https://colosseum.com/hackathon))

`submission/disclosure-review.md` reviews the current `DISCLOSURE.md` against these duties and the actual dependency tree.

## 8. Cross-check against PLAN.md section 9 (discrepancies flagged, not resolved)

| PLAN §9 item | Research finding | Verdict |
| --- | --- | --- |
| "Register and submit through Colosseum. Deadline: October 12, 2026, 11:59 p.m. Pacific. Do not assume Devpost or a separate Tempo form." | Confirmed by rules §5/§6 and FAQ. No Devpost reference found. No separate Tempo form found; `colosseum.com/tempo` 404s. | Confirmed |
| "Recheck portal fields: product, chain/tools, team/background/location, logo/graphic, repository, GTM/distribution, demand evidence." | FAQ lists the same fields ("go-to-market strategy with demand validation, and plans for developing distribution"). Live-portal wording still unverified. | Confirmed (FAQ-level) |
| "Presentation video: 2-3 minutes. Demo video: no more than 3 minutes." | FAQ: pitch "two-to-three-minute"; demo "no more than three minutes." | Confirmed |
| "Review actual work/dependencies against DISCLOSURE.md." | Disclosure is an explicit FAQ + rules §9 obligation, not just internal hygiene. | Confirmed; see disclosure-review.md |
| "Public MIT repository is our choice. The official FAQ also permits private repositories with reviewer access; MIT is not claimed as mandatory." | Confirmed: private repos allowed with access for hackathon@colosseum.com. Additionally, rules §8(e) makes open-source an explicit judging criterion — a new fact that further supports the public-MIT choice. | Confirmed + strengthened |
| "Weekly updates are recommended in the FAQ; two Discord/CommonRoom posts are not asserted as a requirement." | Confirmed: weekly one-minute video updates are "recommended." No required number of Discord/CommonRoom posts found anywhere; Discord is described as the venue for workshops and technical questions. | Confirmed |
| "Verify current track-specific fields; do not invent logo dimensions." | No logo dimensions published in any source; no track-specific fields found. Nothing to verify yet — **unverified, check live portal.** | Partially verified (nothing published) |
| "User reviews/submits final materials and retains confirmation privately." | Rules add that entrants should not assume confidentiality of submission data; retaining one's own confirmation remains fine. | Confirmed with caveat |

### New requirements or facts not in PLAN §9 (flagged for the plan owner)

1. **All submission content must be in English** (rules §12(a)(i)) — Float's materials are, but this becomes a hard rule for videos and text.
2. **Individual registration is a separate disqualifiable step** with the same deadline as submission (rules §6(a)) — for a solo founder this is one action, but it must not be skipped.
3. **Two conflicting judging-factor lists exist** (rules §8 vs FAQ). PLAN §9 did not list judging criteria at all. No weights are published; optimize for both lists rather than picking one.
4. **Contest start is 6:00am PT Sep 14, 2026** per the rules, while the event page shows a kickoff livestream on Sep 15 — a minor source discrepancy. Float's first commit (Sep 26) is inside either window, so this does not affect eligibility.
5. **Finalists face a 15-minute Zoom interview** (FAQ) — the owner should be ready to walk through the repo and evidence live.
6. **Prizes are paid in Phantom CASH stablecoin to the Team Leader's wallet**, after Prize Acceptance Documents and due diligence (rules §13–§15).
7. **"One builder = one product, one team"** and one submission per team (FAQ; rules §7).
8. FAQ lists **Traction** as a judging factor while PLAN forbids invented demand claims — the submission must present validation status honestly (none yet) rather than manufacture traction signals.

## 9. Unverified / could not be loaded

- Live submission-portal field list and any field-level character limits — portal not accessible pre-submission; FAQ description is the best available source. **Check portal.**
- Logo/graphic specifications (dimensions, format, file size) — not published in any of the three sources. **Unverified — check portal.**
- Track-selection mechanics (whether/how a track is chosen at submission) — not described in any source. **Unverified — check portal.**
- `https://colosseum.com/tempo` — HTTP 404 on 2026-09-26. No separate Tempo-track page or form was found.
- Exact weightings of judging criteria — not published anywhere.

## 10. Owner pre-submission checklist (target: submit Oct 11 per PLAN G6)

1. Register/confirm registration on colosseum.com; complete Profile Information.
2. Verify each portal field against §2 of this checklist; capture any discrepancies.
3. Confirm gates G1–G4 status and make the repo's evidence honest before describing it (PLAN §7).
4. Record pitch video (2–3 min) and demo video (≤3 min) per the outlines; [RECORD AT G4] items require real testnet evidence.
5. Produce logo/graphic — check portal for specs first (none published).
6. Finalize `DISCLOSURE.md` per `submission/disclosure-review.md`.
7. Complete at least the owner-run demand interviews in `submission/demand-validation.md`, or leave its "validation incomplete" status untouched — do not soften it.
8. Upload, verify confirmation, retain privately.
