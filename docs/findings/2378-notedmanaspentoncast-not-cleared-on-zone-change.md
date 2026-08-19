---
title: notedManaSpentOnCast is the one cast-time snapshot with no else-delete and no CR 400.7 clear, so it can survive onto a re-cast object
discoveredBy: 2378
status: draft
confidence: medium
---

**What is wrong.** `finalizeSpellResolution` writes four one-shot cast-time
facts onto the object as it becomes a battlefield permanent. Three of them
(`wasKicked`, `chosenXOnCast`, and the `evoked`/`dashed`/`escaped` trio) are
written with an EXPLICIT else-branch that deletes the field, _and_ are cleared
again by `resetBattlefieldTransientState` on a CR 400.7 zone change. The
fourth, `notedManaSpentOnCast`, has neither. It is the only member of the family
that can be inherited by a later object.

**Evidence.**

- Asymmetric write: `convex/gre/state.ts:6060`
  `if (item.notedManaSpent) { item.notedManaSpentOnCast = {...} }` — no `else
delete`. Contrast `:6078` (`wasKicked`) and `:6092` (`chosenXOnCast`), both of
  which the surrounding comment says are written explicitly _"rather than
  relying on the `resetBattlefieldTransientState` clear alone: this is the write
  that actually reaches the battlefield object, so it must be correct
  standalone."_
- Missing CR 400.7 clear: `resetBattlefieldTransientState`
  (`convex/gre/state.ts:~10300–10483`) deletes `wasKicked` (`:10427`),
  `chosenXOnCast` (`:10438`), `chosenName`, `evoked`/`dashed`/`escaped`
  (`:10474–10476`) and `castOffSorceryTiming` (`:10482`) — but never
  `notedManaSpentOnCast`.
- The inheritance path is the documented one: `convex/game.ts` builds every new
  stack item as `{ ...card, ...(cond ? { field } : {}) }`, a spread that never
  CLEARS an inherited value. That is exactly the mechanism issue #1753
  (`wasKicked`) and issue #2412 round 3 (`evoked`/`dashed`/`escaped`) were filed
  for.
- Consequence: a permanent whose definition sets `noteManaSpent: true`, bounced
  to hand and re-cast for a cost paying no coloured mana (or via a path whose
  cast-commit leaves `notedManaSpent` unset), would enter carrying the PREVIOUS
  cast's colours. Today that would read as "{R}{R} was spent" on a cast where it
  was not — the Vibrance/Deceit/Wistfulness ETB clauses (`ecl/multicolor.ts`)
  are the live consumers.

**Not a Sunburst bug.** Pentad Prism's counter placement reads the EPHEMERAL
`item.notedManaSpent` at `convex/gre/state.ts:6117`, not the persisted twin, so
it is correct on every path; and it re-derives from scratch on each cast.

**Why it may not deserve its own issue.** The reachable blast radius today is
narrow: only three shipped cards (ECL's Vibrance/Deceit/Wistfulness) both set
`noteManaSpent` and read `notedManaSpentOnCast`, none of them is a bounce-and-
recast archetype, and their evoke costs are guild-hybrid so a recast would
usually re-note colours anyway. So this may be better as a one-line entry on
whichever tracker already holds the `wasKicked` / `evoked` transient-leak class
than as a fresh ticket. Against that: the fix is two lines (an `else delete` at
`:6062` plus a `delete card.notedManaSpentOnCast` in the reset function), and it
is the last member of a family whose other three members each shipped as a
production bug.
