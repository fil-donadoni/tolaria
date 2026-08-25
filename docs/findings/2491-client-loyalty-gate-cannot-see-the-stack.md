---
title: The human UI offers a loyalty ability while a spell is on the stack — the client gate cannot see stack length or priority
discoveredBy: 2491
status: draft
confidence: medium
---

## What I saw

Issue #2491 moved the CR 606 loyalty rules into one pure authority
(`convex/gre/loyalty.ts`) and routed the server wrapper, the bot's move
enumerator and the search's cost payer through it. The client's UI hint
(`getStackAbilities`, `src/lib/card-utils.ts:2029-2050`) now reads the two
STATE-ONLY clauses from that authority — the CR 606.3 once-per-turn lock and
the CR 606.6 negative-cost floor — but **not** the timing clause.

It cannot: the full predicate calls `isSorceryTimingFor(state, controllerId)`
(`convex/gre/phases.ts:3774`), which needs `state.stack.length` and
`state.priorityPlayerId`. `TriggerStateView` (`src/lib/card-utils.ts`, census
at `:3504`) carries neither. So the client narrows the clause to
"the controller is the active player AND the phase is a main phase", which is
strictly wider than the rule.

The observable consequence: during your own main phase, **with a spell or
ability on the stack**, the walker's loyalty abilities still appear in the
activation menu. Clicking one throws
`"A loyalty ability can only be activated at sorcery speed on your turn"` from
`assertLoyaltyActivationLegal` (`convex/game.ts:6161`). Same for a main phase in
which you do not hold priority.

The asymmetry is new and worth naming: the BOT never offers that move any more
(it enumerates from the full `GameState` and gets the exact clause), so the two
seats of a solo game now disagree about what is offered — the human sees an
affordance the bot correctly does not.

## Evidence

- `src/lib/card-utils.ts:2029-2050` — the narrowed gate and its own comment
  admitting the narrowing.
- `convex/gre/loyalty.ts:136-146` — the full predicate the server and the
  enumerator use.
- `convex/gre/phases.ts:3774` — `isSorceryTimingFor`, whose empty-stack and
  priority-holder clauses are the missing half.
- `convex/gre/moves.ts:1702` — the enumerator's call, with the full state.

## Why it might NOT deserve a ticket

1. **It predates #2491** and is already documented in place, so it is not a
   regression — the same narrowing shipped with the loyalty framework (ADR 0058) and nobody has reported it.
2. **The server is authoritative and rejects the click**, so nothing illegal
   can be applied; the cost is one confusing error toast, not a rules bug.
3. **The fix is not local.** Widening `TriggerStateView` with `stack.length` +
   `priorityPlayerId` touches `buildTriggerStateView`, its census
   (`TRIGGER_STATE_VIEW_CENSUS`) and every other consumer of the view; the same
   narrowing is applied to `sorcerySpeedOnly` abilities a few lines above
   (`src/lib/card-utils.ts:~1990`), so a fix that only helped loyalty would be
   a second, inconsistent rule rather than one authority — which is the thing
   #2491 was closing. Any ticket here should be scoped as "carry the sorcery
   window into `TriggerStateView` once", covering both.

## Related

- #2606 — instant-speed loyalty activation (Teferi, Temporal Archmage). When
  that lands it belongs in the SAME gate as an escape from this narrowing, so
  the two are worth sequencing together.
- `docs/findings/2360-resolvable-but-wrong-cr-citations-discard-and-loyalty.md`
  — the CR 606.4/606.5/606.6 citation rot. #2491 corrected the sites its own
  diff touched (`convex/game.ts`, `convex/gre/moves.ts`,
  `convex/gre/applyMove.ts`, `src/lib/card-utils.ts`); the ~20 remaining sites
  that finding lists are untouched.
