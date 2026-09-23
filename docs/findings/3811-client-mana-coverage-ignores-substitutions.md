---
title: The client's isManaCostCovered ignores CR 609.4b substitutions — may-pay prompts grey out, and the Bot declines, costs the server would accept
discoveredBy: 3811
status: draft
confidence: high
---

**What is wrong.** `isManaCostCovered` in `src/lib/card-utils.ts` (~3392) checks a
pool against a cost with **no substitution list**. The server-side twin
(`convex/gre/state.ts`) takes `getManaSubstitutions(state, playerId)`. That list
covers Sunglasses of Urza, North Star, Robber of the Rich and, since issue
#3811, False Dawn's until-end-of-turn "spend white as though it were any colour".

**Consumers.**

- `mayPayAffordable` (~3717).
- The payment banner (`src/components/board/payment-banner.tsx` 99 / 155).
- The Bot's `mayPayIsAffordable` (`src/lib/ai/bot-view.ts` ~521).

**Scenario.** Under False Dawn every land makes {W}. A "you may pay {U}" prompt
shows Pay disabled for the human, and the Bot declines it, although the server
would accept {W} for {U}. It fails closed: nothing freezes, but a legal payment
is withheld.

**Fix direction.** Project the viewing player's substitution pairs (or the
inputs of `getManaSubstitutions`) into the public state. Then pass them to the
client helper, which should delegate to the engine's coverage exactly as it
already does for hybrid pips.
