---
title: A delayedTrigger whose captures ALL resolve to nothing still schedules and renders on the stack doing nothing
discoveredBy: 1967
status: draft
confidence: medium
---

**What is wrong.** The `delayedTrigger` Op drops an unresolvable `capture`
entry from the payload and schedules the trigger anyway. When EVERY capture is
unresolvable the scheduled trigger is inert by construction: it fires at its
boundary, goes on the stack (players get priority on it), resolves, and does
nothing. Shallow Grave / Corpse Dance cast with a graveyard holding no creature
card is the shape — the `moveZone` no-ops (CR 608.2b), `$revived` is never
bound, and "Exile it at the beginning of the next end step" is still created
and still shown to both players.

**Evidence.** `convex/gre/effects/interpreter.ts`, `delayedTrigger` executor:
`if (value !== undefined) payload[key] = value;` — an unresolvable scalar
capture is silently skipped, and the only early returns are for an unresolvable
`targetPlayer` and for the instance-scoped watch timings
(`leaves-battlefield` / `leaves-battlefield-indefinite` / `attacks-unblocked`),
which DO `return` when their watch cannot be resolved. Phase-boundary timings
have no equivalent gate. Reproduced in
`convex/cards/sets/tmp/__tests__/black.test.ts` ("is a clean no-op on a
graveyard with no creature card") — the assertion had to be relaxed from
"no delayed trigger scheduled" to "firing it is harmless".

Not new to #1967: Sneak Attack (`convex/cards/sets/usg/red.ts`) has the same
shape whenever the player declines its optional "you may put a creature card
from your hand onto the battlefield" — the capture `{ $captured: { ref:
"$sneak" } }` resolves to nothing and the sacrifice trigger is scheduled
regardless.

**Why it may not deserve its own issue.** It is purely cosmetic — no rules
divergence, no state corruption, just a stack row that resolves to nothing —
and CR 603.7a is arguably satisfied either way (the delayed ability IS created
by the resolving spell; it simply has no object to act on). A fix would need a
policy decision that is not obviously right: "skip scheduling when the payload
is empty" is wrong for bodies that legitimately need no capture (Forth
Eorlingas!'s `becomeMonarch`, Battle Cry's `$event`-reading body), so the gate
would have to be "the Op declared captures and NONE resolved", which is a
narrower rule than it first looks. Plausibly a line on an existing
DSL-ergonomics tracker rather than a ticket.
