---
title: The human board offers no clickable candidates for any colour-filtered cost picker — useBattlefieldVisualState matches the raw projected instance, not a layered view
discoveredBy: 1209
status: draft
confidence: high
---

**What is wrong.** The third and largest limb of the raw-instance filter class
that #1209 swept on the bot/server side is still open on the HUMAN side. A
player who activates Hand of Justice gets the tap-other picker and then **no
clickable, no ringed candidates at all** — the same dead-end the bot had, on the
surface a person actually uses. Every colour-filtered sacrifice / additional-cost
/ pending-choice filter behaves the same way.

**Evidence.** `src/hooks/useBattlefieldVisualState.ts` passes the raw projected
`CardInstance` to `matchesPermanentFilter` at **six** sites — 161
(`matchesSacrificePick`), 197 (`matchesActivationCostPick`, the Hand of Justice
one), 334 (pending-choice `filter`), 356 (`additionalCost.filter`), 562, 709 —
and `convex/gameProjections.ts` never adds a `colors` field. `colors`
(CR 202.2 / 613.1d), `power`/`toughness` (CR 613) and
`enteredThisTurn`/`controlledSinceTurnStart` (CR 400.7) are all DERIVED, so every
clause over them fails CLOSED: the hook returns an empty candidate set, silently,
and the affordance simply is not there. The server-side twin
(`convex/game.ts`'s `selectTapOtherCost`, `selectAdditionalCost`) has always
built a layered view first, so the client and the server disagree about which
permanents are legal picks — the client is strictly stricter, which is why this
reads as "the card does nothing" rather than as an error.

The shape and the fix are already settled: `#1209` introduced
`effectivePermanentView` (`convex/gre/permanentView.ts`) for the server path and
`projectedPermanentView` (`src/lib/ai/bot-view.ts`) for the wire projection —
the latter is exactly the helper this hook needs, since it works off the same
slim projected instance. `scripts/__tests__/permanent-filter-view.test.ts` guards
the cost/payment path; extending its `GUARDED_FILES` to this hook is the
mechanical half of the fix.

**Why it may deserve its own issue.** It is defensible without #1209: it is a
live, user-facing bug on a shipped card (Hand of Justice, FEM) reachable by
clicking, it is not a bot concern, and the fix touches a client hook plus a
frontend test rather than anything the payment seam owns. The counter-argument is
that it is one hook and six call sites of an already-solved shape, so it could
ride an existing UI tracker instead of a ticket of its own. It should NOT stay a
finding either way — the class has now been proven to bite on three separate
surfaces.
