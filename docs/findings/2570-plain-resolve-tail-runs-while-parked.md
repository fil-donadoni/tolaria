---
title: A plain resolve() body's statements after its entry primitive run while the permanent is parked
discoveredBy: 2570
status: draft
confidence: high
---

**What is wrong.** CR 614.12a puts the as-enters choice **before** the permanent
enters, and ADR 0100 D5 holds the permanent off every zone until it is answered.
An Effect Script honours that: the interpreter suspends between Ops, so nothing
after the parking Op runs until the entry completes
(`convex/gre/__tests__/asEnters.test.ts` — "Ops AFTER the parking Op do not run
before the permanent enters"). A plain imperative `resolve()` closure cannot be
suspended mid-function, so its trailing statements run **immediately**, against
an instance that is in no zone. Issue #2570 fixed the RE-run; this is the
first run being wrong, and it is untouched by that fix.

**Evidence.** Three shipped bodies read or write the entered permanent after the
entry call:

- `convex/cards/sets/fem/black.ts:598` (Soul Exchange) —
  `ctx.addCounter({ type: "permanent", id: t.id }, "+2/+2", 1)` runs while `t.id`
  is parked, so the Thrull bonus counter is applied to a permanent that is not on
  the battlefield.
- `convex/cards/sets/ice/blue.ts:551` (Dreams of the Dead) —
  `grantTriggeredAbilityPermanent` (`:565`) and `setExileOnLeave` (`:571`) both
  land on the parked instance. `runStagedEntryTail`'s CR 400.7 reset then calls
  `resetBattlefieldTransientState`, which deletes `grantedTriggeredAbilities` —
  so the "when this creature leaves, exile it" clause is silently dropped
  whenever the reanimated card owes an as-enters choice (Voice of All and
  Meddling Mage both qualify for its "white or black creature card" filter).
- `convex/cards/sets/mh3/white.ts:214` (Phelia, Iron Wind's delayed return) —
  `getController(payload.cardId)` is read after the return to gate the +1/+1
  counter; a parked card has no controller-bearing zone, so the comparison
  cannot be right.

Reproduce by giving any of the three a graveyard/exile target that declares
`entersWith.asEnters` (the 21 wired sites are listed in PR #2570's census).

**Why it may not deserve its own issue.** The structural answer already exists
and is already policy: ADR 0045 makes the Effect Script the mandatory default,
and an Effect Script suspends between Ops for free. So this may be three
migration tickets (or three lines on the resolve()→effects migration tracker)
rather than an engine issue. Against that: Soul Exchange and Dreams of the Dead
each carry an explicit in-file "NOT DSL-migratable" justification, so at least
two of the three cannot be migrated as things stand, and the counter/grant loss
is a wrong-board-state bug a player would report.
