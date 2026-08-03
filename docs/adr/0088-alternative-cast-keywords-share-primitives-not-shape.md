# Alternative-cast keywords share primitives, not shape

## Status

proposed

## Context

Foretell (CR 702.143, issue #925) is the fourth mechanic in this engine that
puts a card into exile and lets its owner cast it later for something other
than its printed mana cost. The three already shipped are:

| Mechanic                  | Module              | How the card gets to exile                 | What the cast pays    |
| ------------------------- | ------------------- | ------------------------------------------ | --------------------- |
| Ice-Cauldron-style grant  | (inline, no module) | an effect exiles it                        | the printed mana cost |
| Madness (CR 702.35)       | `gre/madness.ts`    | a discard replacement                      | the madness cost      |
| Rebound (CR 702.88)       | `gre/rebound.ts`    | a hand-cast spell redirected at resolution | nothing (free)        |
| **Foretell (CR 702.143)** | `gre/foretell.ts`   | a **special action** from hand, face down  | the foretell cost     |

Two more of the same family are open and unstarted: Miracle (#1267) and Warp
(#1268). Issue #925's own triage comment recommends building a shared
"alternative cast from a non-hand zone" seam once, for all three, rather than
letting Foretell add a third sibling module.

Independently, Foretell needs to charge {2} for its special action, with the
project's standard payment UX — an auto-tap proposal the player may override by
tapping lands manually. The engine has two payment rails that already do this
shape:

- the cast rail — `GameState.pendingCast` + `tapForPayment` (`game.ts:7497`) +
  `tryAutoCommitPendingCast`;
- the activation rail — `pendingActivation` + `tapForActivationPayment`.

Both call the SAME per-tap primitive, `tapSourceIntoPayment` (extracted in issue
#1779), and neither shares its wrapper mutation or its auto-commit check. A
third shape, `pendingCompanionPay` (ADR 0064), exists but resolves its {3}
synchronously in one call and has never had a manual-tap UI — its own doc
(`state.ts:3071-3086`) says it exists "to leave room for a future manual-tap UI
on the same rail".

So the same question arrives twice in one mechanic: **when four things look
alike, is the right move to unify them?**

## Decision

**Share the primitive that carries the behaviour; do not share the shape that
merely repeats.**

Concretely, for Foretell:

1. **A per-keyword module** (`convex/gre/foretell.ts`), sibling to
   `madness.ts` / `rebound.ts` — NOT a unified alternative-cast seam covering
   Foretell + Miracle + Warp.
2. **A per-rail payment path** (`pendingForetellPay` + `tapForForetellPayment` +
   `tryAutoCommitPendingForetell` + `cancelForetell`), reusing
   `tapSourceIntoPayment` — NOT a unified `tapForPayment` dispatching over four
   kinds of pending payment.

What IS shared, and stays shared, is every primitive where the behaviour
actually lives:

- `CardInstanceState.castableFromExileBy` — one cast-from-exile permission flag
  for every mechanism (Ice Cauldron, Madness, Rebound, Foretell);
- `castRawManaCost` (`game.ts:2343`) — the ONE place a cast's mana cost is
  decided, which each mechanic extends by a single branch;
- `exileFaceDownCard` / `knownTo` (ADR 0026) — one face-down-exile primitive,
  shared with impulse draw;
- `tapSourceIntoPayment` — one per-tap mana primitive for every payment rail;
- `StackItem.castFromZone` — one cast-provenance fact (this ADR's companion
  decision: it REPLACES the per-mechanism `castFromGraveyard` boolean).

## Consequences

**What the sibling modules genuinely share is already factored out.** Strip the
shared primitives above and what remains per mechanic is: how the card reaches
exile, when the cast window opens, and what the cast pays. Those three are
different for every member — a discard replacement, a resolution redirect, a
special action, a draw-reveal window. A "shared seam" over them would be a
switch on the mechanic wearing an abstraction's clothes.

**The same test applied to the payment rails gives the same answer.** The tap
step — mana abilities, colour choice, restrictions, tap bonuses — is behaviour,
and it is already one function. What repeats per rail is the shell: validate the
pending record, auto-commit, apply the effect. Those shells are genuinely
different (the cast rail produces a stack item, the activation rail an ability,
foretell an exile-face-down with no stack), so unifying them yields a four-armed
switch: the same amount of distinct code, plus one level of indirection, inside
the most delicate area of the engine.

**Accepted cost: four modules and three rails that look alike at a glance.** A
future reader will see near-identical structure and reasonably suspect
unnoticed duplication. This ADR is the answer to that suspicion, and issue
#925's triage comment is the recorded argument for the other side.

**This sets the path for Miracle (#1267) and Warp (#1268).** Both should land as
their own modules reusing the same primitives. If a genuine third shared
behaviour appears — not a third repetition of the shape — the extraction is
cheap precisely because each mechanic's distinct part is already isolated in its
own module. The trigger to revisit is a shared BEHAVIOUR, never a third
occurrence of a shape.

**When this decision would be wrong.** If a later member needed the cast window,
the cost substitution AND the zone entry to behave identically to an existing
member, it should extend that member's module rather than clone it — the rule is
"share the behaviour", and that cuts both ways.
