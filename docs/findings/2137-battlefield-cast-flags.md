---
title: evoked/dashed/escaped still leak through the PERMANENT-side CR 400.7 gate (resetBattlefieldTransientState) — the stack-side leak is fixed
discoveredBy: 2137
status: draft
confidence: medium
---

**Correction (PR #2412 fixup round 2).** An earlier version of this finding
claimed `evoked` / `dashed` / `escaped` are declared on `CardInstanceState`
and "never on `StackItem`", and used that premise to argue the leak these
three fields carry is a DIFFERENT chokepoint from the one issue #2137 fixed
(`resetStackTransientState`) — genuinely out of scope for that PR. That
premise was wrong: `convex/game.ts` stamps all three straight onto the
`StackItem` literal at cast commit, at the exact same seam as `buybackPaid`
(`finalizeTargetSelection`/`tryAutoCommitPendingCast`:
`...(isEvokeCost ? { evoked: true } : {})` / `...(isDashCost ? { dashed:
true } : {})`, `escaped` via `graveyardCastStackFlags`) — a stack item IS its
`CardInstanceState`, the same object. A COUNTERED evoked/dashed/escaped
spell rode the flag into the graveyard/exile/library/hand untouched, exactly
like the `buybackPaid` bug, and PR #2412's round-2 fixup closed it by adding
`evoked`/`dashed`/`escaped` deletes to `resetStackTransientState` alongside
`buybackPaid`. See its regression test in `convex/gre/__tests__/evoke.test.ts`
("countered → graveyard → Regrowth → HARD recast").

**What is STILL wrong.** The PERMANENT-side half of the same leak shape is
real and remains open: `evoked` / `dashed` / `escaped` are never cleared by
`resetBattlefieldTransientState` (`convex/gre/state.ts`), the CR 400.7 gate
for a permanent leaving the BATTLEFIELD (as opposed to the stack) for a
non-graveyard/non-exile zone (hand, library) — reanimation-preserve zones
aside. A permanent that entered evoked/dashed/escaped and is later bounced
DIRECTLY off the battlefield (never re-entering the stack in between — a
bounce spell, not a counter-then-regrowth round trip) still carries the flag
on the object that lands in hand/library, and a later HARD recast of that
same object inherits it via the identical `{ ...card, ...(isEvokeCost ? {}
: {}) }` spread `resetStackTransientState`'s fix does not touch (that
function is reached only from STACK exits, not from a battlefield-to-hand
bounce).

**Evidence.**

- `convex/gre/state.ts` (`resetBattlefieldTransientState`) has no
  `delete card.evoked`, `delete card.dashed`, or `delete card.escaped` line —
  confirmed by grep across the whole function body. Contrast with the
  adjacent, already-fixed `wasKicked`/`kickerPayments`/`chosenXOnCast`
  deletes in the same function, each with its own CR-referenced docstring
  explaining exactly this leak shape for a different field.
- `convex/game.ts` — the same `evoked`/`dashed` cast-commit stamps cited
  above; `escaped` via `graveyardCastStackFlags`.
- `convex/gre/serialize.ts` — all three fields round-trip through
  compact/expand, so they persist to the DB exactly like `buybackPaid` did.

**Reproduction shape (untested, not yet confirmed with a shipped card).** A
creature with Evoke is cast paying its evoke alt-cost (`evoked: true` set),
resolves onto the battlefield, is bounced DIRECTLY to hand by a bounce spell
(never re-entering the stack as a spell in between — `resetBattlefieldTransientState`
runs, `resetStackTransientState` does not) WITHOUT `resetBattlefieldTransientState`
clearing `evoked` (it currently doesn't), and is recast normally (full cost,
not evoked). If `evoked: true` still reads `true` on the new stack item
(`{ ...card, ... }` never overrides it when the new cast isn't evoke), its
ETB-sacrifice-if-evoked clause (CR 702.74a) would incorrectly fire a second
time on a creature nobody evoked.

**Why it may not deserve its own issue yet.** No shipped card was found with
Evoke/Dash/Escape _and_ a "bounce this permanent directly off the
battlefield" interaction confirmed reachable in this pass — the leak is real
by code inspection but its reachability with the current card pool wasn't
verified end-to-end (unlike the stack-side half, which PR #2412 reproduced
and fixed with a real shipped-card scenario: evoke → counter → Regrowth →
recast). Distinct call sites and test surface from the now-fixed
`resetStackTransientState` (`resetBattlefieldTransientState`'s own callers
and `convex/gre/__tests__/` coverage for evoke/dash/escape specifically).
Worth a `bun run findings`-triaged look before the first Evoke/Dash/Escape
card that also has a "bounce this permanent" interaction ships.
