# Fixtures

Deterministic, labeled merchant histories and expected results. Owned by work
package C. Rules (PLAN.md sections 2 and 4):

- Every fixture carries an evidence label (`synthetic_fixture`) in the fixture
  file itself, in every score computed from it, and on every dashboard render.
- Fixtures are deterministic: same input, same classification, same offer.
- Include the demo profiles (eligible, suspicious, insufficient history) with
  ~30 simulated days where useful, plus the edge-case suite (concentrated
  legitimate revenue, volatility, self-funding, refunds, incomplete history,
  inactivity) kept separate from demo fixtures.
- Never silently combine synthetic and observed totals.
