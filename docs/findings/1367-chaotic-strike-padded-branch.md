---
title: Chaotic Strike's unconditional draw still rides in both coinFlip branches
discoveredBy: 1367
status: draft
confidence: high
---

**What is wrong.** `chaoticStrike` (`convex/cards/sets/inv/red.ts:332-372`)
implements "Flip a coin. If you win the flip, target creature gets +1/+1
until end of turn. Draw a card." by duplicating the unconditional `draw` Op
into BOTH the `win` and `loss` branches, with a comment explaining that
`isCoinFlipBranch` required a non-empty `effects` list and "there is no
card-shaped no-op Op to pad an otherwise-empty loss branch with." Issue
#1367 relaxed `isCoinFlipBranch` (`convex/gre/effects/validate.ts`) to accept
`effects: []`, so the workaround is no longer necessary — the card could be
rewritten as a `coinFlip` with an empty `win` addition and the `draw`
unconditional (outside the coinFlip entirely, sequenced before or after it).

**Evidence.** `convex/cards/sets/inv/red.ts:347-372` — the comment at
347-350 explicitly names the constraint this issue removed; both `win.effects`
(358-366) and `loss.effects` (369-372) currently duplicate `{ op: "draw",
player: "controller", count: 1 }`.

**Why it may not deserve its own issue.** It's a pure behavior-preserving
cleanup (the duplicated draw already produces the correct oracle behavior —
removing the duplication doesn't change what the card does, only how it's
expressed) with no user-visible bug. It's a one-card, few-line diff — likely
cheaper as a line item on a future catalogue-hygiene pass than a standalone
ticket. Flagging here mainly so the "no card-shaped no-op Op" comment doesn't
mislead a future reader into thinking the constraint still exists.
