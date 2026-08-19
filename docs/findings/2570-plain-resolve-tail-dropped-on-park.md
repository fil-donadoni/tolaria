---
title: A plain resolve() body's clauses after a reanimation are silently dropped when the permanent parks on an as-enters choice
discoveredBy: 2570
status: draft
confidence: high
---

**What is wrong.** `SpellContext.returnToBattlefield` returns a boolean meaning
"the card is on the battlefield now", and every shipped caller correctly gates
its trailing clauses on it. On an as-enters park that boolean is **`false`** —
the permanent is held off every zone until its controller answers (CR 614.12a:
"If a replacement effect that modifies how a permanent enters the battlefield
requires a choice, that choice is made before the permanent enters the
battlefield") — so those callers early-return. The permanent then enters
normally once the answer lands, but the clauses **never run**: a plain
imperative `resolve()` has no checkpoint, the entry tail the as-enters finalize
runs is the ENGINE's (`finishReanimatedEntry`), not the card's, and nothing
re-enters the body. The card's own rider is lost with no error and no log line.

The board state is wrong in the player-visible direction: the creature comes
back, and the bonus it was supposed to come back with does not.

**Mechanism.** `returnToBattlefield` (`convex/gre/state.ts:13552`) splices the
card out of the graveyard/exile pile, then calls `putReanimatedOnBattlefield`
(`:10857`), which returns the result of `stageReanimatedOnBattlefield`
(`:10663`). That function's `typeof enterDestination === "object"` branch —
CR 614.12a, the as-enters park — calls `stageAsEntersEntry` and **`return
false`** (`:10717-10725`). So the boolean the card reads is `false`, and the
card is in NO zone at that moment.

Removing the guard would not help: a clause written against the parked instance
id is a no-op, because `addCounter` / the grant helpers resolve their host
through the battlefield and the parked object is not there. Measured with a
scratch spell holding an UNGATED `addCounter` after the return: the staged
entry's card carried `counters: undefined` at park time, and `counters: null`
after the answer, with the permanent on the battlefield. So the clause is lost
either way — this is a dropped effect, not a mis-applied one.

**Evidence.** Measured at this branch's HEAD with a synthetic probe spell
(plain `resolve()`, `returnToBattlefield` on a graveyard Voice of All, whose
`entersWith.asEnters` is a `mode` declaration):

- `returnToBattlefield` returned `[false]`, once — the body ran exactly once,
  before and after the answer.
- One staged entry, one stackless `option-pick` pending choice carrying
  `asEntersCardId: "gy-voice"`.
- After the answer: the permanent is on the battlefield, the stack is empty,
  and the ungated trailing `addCounter` left no counter.

Three shipped bodies lose a clause this way:

- `convex/cards/sets/fem/black.ts:602` (Soul Exchange) — `if (!returned)
return;` guards the Thrull `+2/+2` counter. Reanimating a Voice of All /
  Meddling Mage / Primal Clay with a Thrull exiled to the additional cost
  returns the creature **without** its counter.
- `convex/cards/sets/ice/blue.ts:562` (Dreams of the Dead) — `if (!ok) return;`
  guards BOTH `grantTriggeredAbilityPermanent` (the CR 702.24 cumulative upkeep
  the card exists to attach) and `setExileOnLeave` (CR 614.1c). Its target
  filter is "white or black creature card", which Voice of All and Meddling
  Mage both satisfy, so the drop is reachable with shipped cards: the creature
  comes back with no upkeep to pay and no exile-on-leave — strictly better than
  the card allows.
- `convex/cards/sets/mh3/white.ts:221` (Phelia, Iron Wind's delayed return) —
  `if (!entered) return;` guards the `+1/+1` counter on Phelia. Same shape, via
  the delayed-trigger site.

The guards themselves are correct and predate this branch (CR 608.2b — a card
that is no longer in its source zone must not be operated on); the diff for
#2570 does not touch any of the three files. What is missing is a way for a
completed body to say "run this once the entry finishes".

**Why it may not deserve its own issue.** The structural answer is already
policy: ADR 0045 makes the Effect Script the mandatory default, and the
interpreter suspends between Ops, so a script's clauses after `moveZone` do run
after the entry (`convex/gre/__tests__/asEnters.test.ts` — "Ops AFTER the
parking Op do not run before the permanent enters"). On that reading this is
three lines on the `resolve()`→`effects` migration tracker rather than an
engine ticket. Against that: Soul Exchange and Dreams of the Dead each carry an
explicit in-file "NOT DSL-migratable" justification naming the missing Ops, so
neither can be migrated as things stand, and Dreams of the Dead's dropped
cumulative upkeep is a wrong-board-state bug in the player's favour — the kind
that gets reported. The narrow alternative, an engine-side "entry continuation"
a completed body can register with the staged entry, is a real seam and would
need its own design.

**Not the same as `2570-stepped-resolve-token-replay.md`**, which is the
opposite failure at a different shape: a stepped body's parking step re-runs.
This one is a completed body's tail never running.
