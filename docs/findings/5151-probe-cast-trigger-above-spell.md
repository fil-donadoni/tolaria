---
title: The 1-ply probe spends its one resolution on a cast trigger and leaves the spell itself on the stack
discoveredBy: 5151
status: draft
confidence: high
---

**What is wrong.** `policyProbeState` (`convex/gre/search.ts`) prices a
`cast-spell` move by resolving the top of the stack ONCE, then settling only
when the move's announcement was the whole stack (`announcedDepth === 0`).
When the cast itself puts a trigger above the spell — Enchantress's Presence,
Argothian Enchantress, a prowess creature, any "whenever you cast" trigger —
the stack after `applyMoveInSearch` is `[spell, trigger]`, `announcedDepth`
is 1, the one resolution is spent on the trigger, and the spell stays on the
stack unresolved. The settled state has the card out of the hand and nowhere
on the board: the 1-ply policy, every Eval Pair and the rollout default policy
read the cast as a pure loss of the card's whole hand value.

**Evidence.** Verdict Lock positions `v1-12d586f8…` and `v1-88375533…` (the
Enchantress deck, turn 13): "cast Sylvan Library" settles to `stack: 1`,
`hand −280`, `creatures 0` under Opalescence, so the verdict's right move trails
`pass` by 283 margin points at the prior. Under issue #5151's recurrence
multiplier the Library's hand face is the whole stream (282), which is why the
first refit pulled `latent.recurrence` 6 → 3.78 and `latent.cardAdvantage`
45 → 25.9: the fit was paying for a probe hole with two weights. Measured with
`bun run fit:weights` on the issue #5151 branch before the prior was raised.
The same positions with no cast trigger on the board (`v1-b732bbe0…`, Mirri's
Guile, Enchantress's Presence in the graveyard) settle to `stack: 0` and price
the cast correctly.

**Why it may not deserve its own issue.** It is a Bot search change
(`search.ts`), owes a `must` blade entry and a refit, and the fix shape needs a
decision: resolve down to the move's own announcement (identify the item the
move created rather than guessing `stack.length − 1`), or let the
`announcedDepth === 0` settle cover an announcement with its own triggers
above it. Either moves every Enchantress and prowess position in the corpus.
