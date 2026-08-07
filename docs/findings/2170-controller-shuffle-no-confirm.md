---
title: The controller's quick-action "Shuffle" button never confirmed, and still doesn't
discoveredBy: 2170
status: draft
confidence: low
---

**What is wrong.** Issue #2170 gave the library pile's own "Shuffle" verb an
anchored confirm popover (`manual-pile-actions.ts`'s `shuffle` action). The
Manual Board's CONTROLLER also carries its own top-level "Shuffle" quick
action (`manual-controller-actions.ts`, key `manual-shuffle`,
`MANUAL_CONTROLLER_KEYS`), which dispatches `dispatch.shuffle(...)` directly
— no confirmation at all, before or after this issue.

**Evidence.** `src/lib/manual-controller-actions.ts` — the `manual-shuffle`
descriptor's `onClick` is `() => dispatch.shuffle({ playerId: viewerId })`,
with no gate. Contrast the pile verb at `src/lib/manual-pile-actions.ts`'s
`shuffle` key, which now opens a `kind: "confirm"` popover.

**Why it may not deserve its own issue.** This asymmetry pre-dates #2170 (the
controller button never had a `window.confirm` either — it was never in this
issue's "Covered" list, and the AC's blanket dialog ban is satisfied either
way since there was never a native call here). It may be entirely
intentional: the controller's quick action is one click by design (End Turn,
Untap all and Draw are all single-click with no confirm too), and only the
PILE's "Shuffle" — reached via a menu, not a persistent button — historically
asked for confirmation. If that's the intended split, this is a non-issue;
if not, it's a one-line fix (reuse the same `requestVerbInput`/`kind:
"confirm"` shape this PR added to the pile verb).
