# Disclosure review — DISCLOSURE.md against hackathon duties and the actual dependency tree

Prepared 2026-09-26 by work package F. Scope: compare [DISCLOSURE.md](../DISCLOSURE.md) with (a) the hackathon's disclosure obligations and (b) the third-party code actually present in this repository, and list open items to re-verify before submission. Package F owns drafting; final sign-off is the owner's (PLAN §9).

## 1. What the hackathon requires

- FAQ: "Pre-existing code is permitted but 'teams must disclose all relevant past development work'"; misrepresentation "can mean disqualification, bans, or prize revocation." ([FAQ](https://colosseum.com/hackathon))
- Rules §9: "Entrants agree to inform Administrator of the status and ownership of any open-source or other third party code, intellectual property filings, or searches related to their Project Submission." Entrants must also ensure third parties hold no rights or claims on included software. ([rules §9](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf))
- Rules: products are judged only on work completed between the contest start (6:00am PT Sep 14, 2026) and end dates; all content must be in English and must not infringe others' rights ([rules §5, §12](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)).
- FAQ judging note: reviewers look for "significant work during the hackathon done by the team itself" in the GitHub repo. ([FAQ](https://colosseum.com/hackathon))

## 2. What DISCLOSURE.md currently says

Quoted in full (it is short):

> All source code in this repository was written **starting 26 Sep 2026** exclusively for the Colosseum Crypto World's Fair hackathon. No prior proprietary code or work product has been included.
>
> Third-party open-source libraries are used under their respective licenses and referenced in the code's import statements or requirements files.
>
> _Signed: Stephen Yao (GitHub **@stphnyao**)_

Assessment of the current draft: the core claims (authorship date, no prior proprietary code, third-party libraries under their licenses) are the right shape for the FAQ/rules duties above, and it lives at the repo root where reviewers will see it. The gaps are specificity (no dependency inventory) and one wording ambiguity in `spike/` (§4 below).

## 3. Verified third-party dependencies (from the repository itself)

Declared in `package.json` files (ranges) and verified against the installed tree (`pnpm-lock.yaml` / `node_modules/.pnpm`, installed 2026-09-26). Licenses were read from each installed package's own LICENSE file or package.json `license` field — not from memory.

| Package                                                | Declared | Installed (2026-09-26) | License (verified from installed package)                                    | Used by                        |
| ------------------------------------------------------ | -------- | ---------------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| next                                                   | ^15.3.0  | 15.5.26                | MIT                                                                          | apps/web                       |
| react                                                  | ^19.0.0  | 19.3.0                 | MIT                                                                          | apps/web                       |
| react-dom                                              | ^19.0.0  | 19.3.0                 | MIT                                                                          | apps/web                       |
| viem                                                   | ^2.38.0  | 2.56.9                 | MIT                                                                          | packages/chain (Tempo adapter) |
| zod                                                    | ^4.0.0   | 4.6.5                  | MIT                                                                          | packages/contracts             |
| drizzle-orm                                            | ^0.44.0  | 0.44.7                 | Apache-2.0                                                                   | packages/db                    |
| drizzle-kit                                            | ^0.31.0  | 0.31.11                | MIT (per package.json `license` field; no LICENSE file ships in the package) | packages/db                    |
| pg                                                     | ^8.13.0  | 8.23.0                 | MIT                                                                          | packages/db                    |
| tsx                                                    | ^4.19.0  | 4.23.15                | MIT                                                                          | apps/worker, packages/db       |
| vitest                                                 | ^3.0.0   | 3.2.7                  | MIT                                                                          | all packages (dev)             |
| prettier                                               | ^3.4.2   | 3.9.9                  | MIT                                                                          | root (dev)                     |
| typescript                                             | ^5.6.3   | 5.9.3                  | Apache-2.0                                                                   | all packages (dev)             |
| @types/react, @types/react-dom, @types/node, @types/pg | various  | various                | MIT (DefinitelyTyped)                                                        | type definitions (dev)         |

Infrastructure and tooling (not distributed code, listed for completeness): pnpm@10.18.2 (package manager, per root `package.json`), Node ≥ 20.19 (engines), PostgreSQL 16 via `docker-compose.yml`, GitHub Actions CI workflow (`.github/`). Workspace packages (`@float/contracts`, `@float/chain`, `@float/policy`, `@float/db`, `@float/web`, `@float/worker`, tests) are first-party.

The project license is MIT (`LICENSE`, "Copyright (c) 2026 Stephen Yao"), matching the public-MIT repository choice in PLAN §9 and the rules' Open-source judging criterion ([rules §8(e)](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)).

**Recommendation:** replace DISCLOSURE.md's generic second paragraph with this table (or a link to it) before submission, re-verified at G5 freeze. Caret ranges mean future installs can differ from the versions verified above; pin or re-verify at freeze time.

## 4. Gap: the `spike/` wording ambiguity (owner decision required)

**RESOLVED 2026-09-26 (owner confirmation):** `spike/pull_test.py` was authored **25 Sep 2026** — inside the Contest Period (began 6:00am PT Sep 14, 2026), so it is judged work, not pre-hackathon "prior work"; no pre-existing-code disclosure duty attaches to it. [DISCLOSURE.md](../DISCLOSURE.md) now states the 25 Sep sketch date explicitly and links to this inventory, removing the "starting 26 Sep 2026" inaccuracy. The "legacy" wording in README/PLAN/RESULTS refers to the sketch being a superseded design, not to pre-contest origin. Original analysis follows.

- `spike/` contains `RESULTS.md` and `pull_test.py`. [spike/RESULTS.md](../spike/RESULTS.md) describes "The Python sketch in this directory" as a "legacy hypothetical sketch" using "hypothetical SDK calls," and PLAN §1 calls it "a legacy hypothetical Python sketch."
- DISCLOSURE.md asserted "All source code in this repository was written **starting 26 Sep 2026** exclusively for the hackathon," and git history shows the spike was committed 2026-09-26 (commit `4ddbaff`).
- "Legacy" (in the docs) and "written starting 26 Sep 2026 exclusively for the hackathon" (in DISCLOSURE.md) cannot both be precisely true: if `pull_test.py` was written before the contest window opened (6:00am PT Sep 14, 2026, per [rules §5](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)), the FAQ's "disclose all relevant past development work" duty applies to it and DISCLOSURE.md must name it as prior work; if it was in fact written Sep 26 for the hackathon, the "legacy" wording in README/RESULTS/PLAN is what needs correcting.

## 5. Open items to re-verify before submission (G5)

1. **Dependency re-verification at freeze** — re-run the §3 inventory against the final lockfile; ranges may have pulled newer versions.
2. ~~**`spike/` authorship date**~~ — **CLOSED 2026-09-26**: owner confirmed 25 Sep 2026 authorship (inside Contest Period); DISCLOSURE.md corrected (see §4).
3. ~~**CI green run observed**~~ — **CLOSED 2026-09-26**: CI green on main observed (GitHub Actions run 36269865227, commit `880a23f`); PLAN G0 updated.
4. **Vendored or copied code** — confirm no tutorial snippets, design assets, fonts, icons, or generated code beyond the standard framework scaffolding were added by any agent; if any were, list them in DISCLOSURE.md.
5. **Video assets licensing** — rules §12 prohibits content infringing others' rights: check music, stock footage, fonts, and any third-party screenshots appearing in the pitch/demo videos.
6. **Agent-assisted development** — the workflow uses coding agents (PLAN §10). The FAQ does not require disclosing AI tooling and notes some accepted founders built MVPs with AI tools, but its GitHub-review guidance emphasizes work "done by the team itself." Owner should be ready to explain the workflow honestly (e.g., in the finalist interview); optionally add one sentence to DISCLOSURE.md.
7. **Name/IP check** — rules §9 references IP filings and searches. No trademark search for the name "Float" has been performed. A quick, documented search is cheap insurance; result to be noted by the owner if done.
8. **Administrator information duty** — rules §9 requires informing the Administrator of the status/ownership of third-party code. If the submission portal has no disclosure field, keep DISCLOSURE.md at repo root (already the case) and mention it in the submission notes if a free-text field exists.
9. **G1–G4 evidence status wording** — any submission text describing the system must match [spike/RESULTS.md](../spike/RESULTS.md) and PLAN gate statuses (Tempo integration currently NOT VERIFIED); disclosure of _code_ is separate from honesty about _capability_.

## 6. Bottom line

DISCLOSURE.md is directionally correct and satisfies the minimum claim structure, but before submission it should (a) name the actual third-party dependencies with verified licenses (§3), (b) resolve the `spike/` authorship wording (§4), and (c) be re-verified against the frozen lockfile at G5 (§5). Nothing in this review constitutes legal advice.

## Sources

- [Colosseum hackathon FAQ](https://colosseum.com/hackathon) — pre-existing-code disclosure duty; GitHub review expectations.
- [Official rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf) — §5 timing, §8(e) open-source criterion, §9 third-party code duty, §12 content restrictions.
- Repository files: [DISCLOSURE.md](../DISCLOSURE.md), `package.json` files in the worktree, `pnpm-lock.yaml`, `LICENSE`, [spike/RESULTS.md](../spike/RESULTS.md), [PLAN.md §9–§10](../PLAN.md).
