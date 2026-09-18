# Bot strength is held-out agreement with player Verdicts; the ladder keeps no objective

## Status

accepted — grilled 2026-09-18 (issue #3852, under the roadmap map issue
#3846). Re-charters the bot strength map (issue #1892, "Roadmap v3").
Supersedes the METRIC decision of that map's Roadmap v2 ("Ladder = strength
metric", Environment Rungs climbed in order, a ladder verdict owed by any
change that shifts every decision a little); ADR 0070's admission criterion,
ADR 0124 (Verdicts → fit → report) and ADR 0128 (store, lock, promotion)
stand and are built on.

## Context

Roadmap v2 made the Ladder the Brain's strength metric. Measured since: a
240-game `decision` run holds the machine-wide mutex for hours; the noise
floor equals a placebo run; reward calibration (issue #1929) was fitted and
rejected on its own evidence; more than one attribution turned out to have
moved only noise. Eight of v2's nine attack-order tickets shipped — including
parallel workers and rungs R1/R2 — and the number still bought no decision.

Meanwhile the Verdict loop (ADR 0124/0128) became the way the Evaluation
actually changes, but it has no number of its own: the Weight Fit reports the
pairs it cannot satisfy on the very data it was fitted to, which says nothing
about a position nobody has judged. And the Test Position registry (the former
Blade Scenarios) sat beside the Verdict corpus as a second, hand-kept list
whose predicate entries the fit could not see.

## Decision

- **Strength = Held-out Agreement.** Verdicts outside the tiers are split
  once, deterministically, by a hash of the POSITION's Scenario Spec (20%
  held out — hash mod 5), so every judgement of one board falls on one side.
  The Weight Fit reads only the fit side. Two counts on the unseen side:
  _eval agreement_ (unseen Eval Pairs the Evaluation alone orders as the
  player did — no search, printed by every Promotion) and _pick agreement_
  (unseen Verdicts where the whole Brain, fixed iterations and seed, picks the
  player's move). **Pick agreement is the strength number**; the gap between
  the two is what the search adds or costs. Always printed with `n` and per
  Decision Class; under n = 100 it is indicative, never a claim.
- **The held-out side is immutable and unwatched.** No gate requires it, no
  fix is made by looking at it, a held-out Verdict never migrates to the fit
  side. One the owner admits to `must` anyway leaves it for good and is
  counted as `burned` in every report.
- **One Verdict corpus, two uses.** A Test Position is a Verdict frozen with
  a seed, a budget and a tier. `must` and `stretch` are ALWAYS on the fit
  side — by rule, not by hash — so the fit cannot drift from what the gate
  demands.
- **Admission is curated, and is not Promotion.** Promotion (ADR 0128) stays
  the automatic widening of the Verdict Lock. Admission is a human's decision
  that a Test Position joins `must`, against ADR 0070's forced-loss
  criterion. Tooling proposes Admission Candidates — 2 distinct attestors (1
  when it is the owner), satisfied across 3 consecutive Promotions, never a
  Contested Position, picked correctly on 5 seeds; thresholds are
  configuration — and never admits, and never auto-files a red candidate
  under `stretch`.
- **Telemetry samples agreeing decisions too**, by quota per Decision Class,
  as Verdict Proposals: still questions, a Verdict only on confirmation. A
  player's post-game review of their own plays answers the same queue.
- **The Ladder keeps no objective.** The code stays. No change owes a run, no
  pipeline starts one; by hand, idle machine, large claim only. Environment
  Rungs remain as labels of what a run exercised, not a sequence to climb. A
  strength claim owes a held-out agreement delta and a green `must` tier.
- **Names.** Blade Scenario → Test Position (EPD `bm`/`am` lineage);
  Discriminating Pair → Minimal Pair (BLiMP). Glossary now; the code rename
  (`gre/ai/blade/`, `test:blade`, the receipt field, `BLADE_VARIANT`) is one
  mechanical ticket, after the held-out build. Lineage:
  `docs/research/test-position-lineage.md` on branch
  `docs/test-position-lineage` (issue #3850).

## Consequences

- A deterministic, seconds-to-minutes number replaces an hours-long noisy
  one; it needs no mutex and cannot be argued with by re-running.
- **What is given up:** agreement with players is blind to whole-game
  dynamics no single decision shows (tempo over ten turns, a plan nobody was
  asked about) and is bounded by the players' own skill. The Ladder remains
  the only instrument that sees those — which is why it is kept, unowed,
  rather than deleted.
- The split is hard to reverse: changing the hash or the ratio burns the
  whole held-out side at once.
- Held-out agreement starts small and noisy (few testers); the `n` beside the
  number is the honesty mechanism, and v1's strangers are what grows it.
- **Fog, with a trigger not a date:** learned interactions over the term
  vector (quadratic terms / a small MLP) open as a grilling ticket when eval
  agreement moves under 1 point across 3 consecutive Promotions of ≥ 50 new
  Verdicts each AND the owner cannot name a missing linear term for most of
  the unsatisfied Eval Pairs. A network over the raw board stays out of
  scope (ADR 0074 budget).
- Priorities recorded on the map: Bot-play sweep (issue #3830) inside the v1
  gate; held-out build and the Deck Plan (PRD issue #3602) P1; the loop
  Shortcut (PRD issue #2687) P2 — of the 25 premodern archetypes only Aluren
  loops, and its loop is finite and playable by hand; opponent model (PRD
  issue #2787) P2; a blunder from a tester is always a Verdict, at once.
- `.claude/rules/bot-development.md` and `/bot-slice` still state the ladder
  debt; rewording them is a separate ticket (not a docs-lane change).
