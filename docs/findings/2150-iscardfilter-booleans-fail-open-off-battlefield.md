---
title: `isToken` / `enteredThisTurn` validate on every zone but are evaluated by no hidden-zone matcher
discoveredBy: 2150
status: draft
confidence: medium
---

**What is wrong.** `isCardFilter` (`convex/gre/effects/validate.ts`) accepts
`isToken` and `enteredThisTurn` unconditionally — neither rides the
`allowLiveState` opt-in gate that `hasAbility` / `isAttacking` /
`controlledSinceTurnStart` use — while `matchesCardFilter`
(`convex/gre/effects/interpreter.ts`), the matcher every hidden-zone branch
falls back to, evaluates neither. A filter naming only one of them therefore
validates and then matches **every** card in the zone: the fail-OPEN class, not
a merely-imprecise read.

**Evidence.** Both are battlefield facts by rule — a card in hand is never a
token (`CR 111.7`: a token in any other zone ceases to exist) and never entered
(`CR 400.7`). PR #4412 closed the hole **inside the `count` construct only**
(`isCountValue` refuses both off the battlefield), because that is where issue
#2150 made it newly reachable by admitting a hand filter. Every other
`isCardFilter` site — `discard`'s `filter`, `moveZone`'s bulk sweep, the
`forEach { set: "graveyard" }` selector — still accepts them on a hidden zone
and still ignores them.

**Why it may not deserve its own issue.** No shipped card writes the shape, so
nothing is broken today; the fix is either two lines moving both fields behind
`allowLiveState` (which would red any card that does write it — worth running
before deciding) or evaluating them in `matchesCardFilter` as constant `false`.
Either way it is one small change, plausibly a line on an existing filter
tracker rather than a ticket.
