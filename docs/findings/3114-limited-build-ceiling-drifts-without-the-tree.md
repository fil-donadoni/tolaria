---
title: check:ui's limited-build row drifts with deployment state the #2822 fixture does not pin
discoveredBy: 3114
status: draft
confidence: high
---

**What is wrong.** `scripts/ui-gate/budgets.json`'s `limited-build @ 844x390x3`
cell has now been re-recorded a third time with no `src/` change behind the move
(issue #2825, `docs/findings/2671-limited-list-budgets-drifted.md`, and issue
#3114). Issue #2822 was meant to end that by pinning the SUBJECT — a seeded,
label-addressed event and a fixed seat (`convex/limitedFixtures.ts`) — but the
builder's reading is not a function of the event and the seat alone. The seat's
saved deck row sits on top of them and the lane never touches it:
`savedWorkingDeck` (`src/components/deckbuilder/pool-deck-builder-form.tsx:129-146`)
rehydrates that row — split AND `layout` columns — in place of the continuous
default the fixture's raw pool arrangement implies, and `seedUiGateFixtures`
replaces the event rows without clearing it.

**Evidence.** Measured 2026-09-07 for issue #3114, all against the same seeded
24-card Pool: commit `495234d1a` — the exact tip whose PR #2926 recorded
`PASS … occ13` on 2026-08-29 — measures `occ15 reach8` today, and measures the
same `occ15` under the previous Chromium headless shell (rev 1194) as under the
current one (rev 1234). So neither the tree nor the browser build moved the
number, which leaves deployment-side state. The per-user grouping/ordering prefs
are NOT a candidate: `recordGroupingChange` / `recordOrderingChange` write to
`localStorage` (`src/lib/deckViewPrefs.ts:142-166`) and the lane opens a fresh
browser context per viewport, so they start empty on every walk. Whether the
saved deck row is in fact what moved was not pinned — that needs a reading of
the seat's row against a freshly-seeded one, which issue #3114 did not run
because a re-seed would have disturbed the other six `limited-*` / `draft-*`
rows it was scoped out of.

**Why it may not deserve its own issue.** The reading it produces is not WRONG —
the count of fully visible cards has been 1 throughout and `cardsStranded` has
stayed 0 — so the cost is only that a UI PR periodically pays a red it did not
cause and someone re-records it. Containment is cheap (the lane clearing the
fixture seat's saved deck before the walk, the way it already re-seeds the
event), but it is lane hygiene, not a defect a user can see; it may equally be a
line on the ui-gate maintenance backlog rather than a ticket.
