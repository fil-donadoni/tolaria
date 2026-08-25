---
title: limited-list / limited-your-events / draft-pool-stop already fail check:ui, unrelated to any deckbuilder change
discoveredBy: 2670
status: draft
confidence: high
---

**What is wrong.** The full `bun run check:ui` receipt for this PR shows 10
`FAIL` rows outside the deck-builder surface: `limited-list` (4 of 5
viewports), `limited-your-events` (4 of 5) and `draft-pool-stop` (2 of 5) —
`small` ceilings exceeded by 1-2 at several viewports, plus `starved 1 > 0`
at two `limited-list` cells and `cardsOcc 3 > 2` / `ctrlsOcc 3 > 2` at one
`draft-pool-stop` cell.

**Evidence this is unrelated to #2670.** This PR's diff touches only
`docs/findings/`, `scripts/ui-gate/budgets.json` and two files under
`src/components/deckbuilder/` + `src/components/lobby/deck-builder/` — no
Limited or draft code. Confirmed directly: `git stash` (reverting every
change this PR makes) and re-running
`bun scripts/ui-gate/index.ts --surface=limited-list,limited-your-events,draft-pool-stop`
on the untouched, verified-green tree reproduces the SAME failures, byte for
byte (same actual values, same over-budget deltas).

**Likely cause.** This is a shared dev deployment several concurrent agent
sessions use (the same one whose deck-builder walk needed a `cleanup()` pass
in #2671 after 30+ throwaway decks accumulated). `budgets.json`'s own notes
on these three surfaces describe several prior rounds of exactly this
shape — an event/draft list or a pool growing between when a ceiling was
recorded and when it was next measured. The `limited-list`/`limited-your-
events` failures read as one or two more list rows than the ceiling assumed;
`draft-pool-stop`'s `cardsOcc`/`ctrlsOcc` jump reads as pool-state drift on
whatever draft seat the deployment currently has parked.

**Why it may not deserve its own issue.** These three surfaces are `#2659`'s
or a Limited/draft-surface owner's territory, not `#2670`'s (target dirs:
`docs/findings/`, `scripts/ui-gate/`, `src/components/deckbuilder/`,
`src/components/lobby/deck-builder/`, `src/components/ui/`) — fixing them
here would be scope creep into unrelated code on a shared box. Re-recording
the ceilings with `--record --accept=...` would silently paper over
whatever caused the drift rather than diagnose it. Flagging so whoever next
touches `limited-list`/`limited-your-events`/`draft-pool-stop` does not read
a `FAIL` there as their own regression.
