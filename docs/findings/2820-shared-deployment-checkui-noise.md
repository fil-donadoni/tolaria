---
title: check:ui full lane fails on lobby/limited-list/limited-your-events, unrelated to any single diff
discoveredBy: 2820
status: draft
confidence: medium
---

**What is wrong.** Three full `bun run check:ui` runs during this issue's
verification consistently failed `lobby`, `limited-list` and
`limited-your-events` on `small`/`starved` overages
(`scripts/ui-gate/budgets.json`), with byte-identical numbers across all
three runs. `git diff --name-only main` for this PR touches none of those
components — the overages are a property of the shared dev deployment's
CURRENT data (how many Limited events currently exist across every
concurrent session using this machine), not of any code change.

**Evidence.** Run 2 and run 3 of `bun run check:ui` (~40 min apart)
recorded, e.g., `lobby @ 390x844x3: small 11 > 10` and
`limited-list @ 1440x900x2: starved 1 > 0, small 27 > 25` both times, with
`ctrls n279` (lobby) constant across runs — the event list rendered by
`/limited` has grown past what these ceilings were calibrated against, and
is not shrinking back between runs (unlike a load-timing flake, which would
vary run to run).

**Why it may not deserve its own issue (yet).** It is the same underlying
mechanism issue #2822 already tracks for the Draft Room's own seat
selection (`reachDraftRoom` picks by unpinned list position) — just showing
up on the LIST pages themselves instead of a specific event's room. #2822's
remedy (pin the walk to a seeded fixture) would likely fix this too if
extended to `limited-list`/`limited-your-events`/`lobby`'s own event-count
assumptions. Worth folding into #2822's scope, or filing as a sibling once
someone confirms it reproduces on a QUIET deployment (a single session, no
concurrent Limited-event churn) rather than only on this heavily shared
machine.
