---
title: the may-pay pending choice is documented as CR 117.3a / 118.4 at ~18 sites, and neither rule is about a "you may pay" choice
discoveredBy: 2982
status: draft
confidence: high
---

**What is wrong.** `bun run cr 117.3a` prints "The active player receives
priority at the beginning of most steps and phases, after any turn-based
actions … have been dealt with" — a priority rule. `bun run cr 118.4` prints
"Some costs include an {X} or an X. See rule 107.3." — a variable-cost rule.
Neither says anything about the thing they are cited for: the engine's
`may-pay` pending choice, the yes/no "you may pay <cost>" question raised
during a resolution and answered through `submitMayPay`.

Both ids RESOLVE, and both sit outside the 701/702 blocks, so
`bun run cr:lint` is blind to them — the same shape #2982 was opened to
correct in four other families.

**Evidence.** The `117.3a` half, ~18 sites, all making the same claim (a yes/no
may-pay choice and the cost union it pays):
`convex/gre/state.ts:3009`, `:22626`, `:23147`, `convex/game.ts:13060`,
`convex/gre/legalActions.ts:117`, `:273`,
`convex/gre/pendingChoiceSubmit.ts:122`, `:144`, `convex/gre/moves.ts:206`,
`convex/gre/ai/choiceCandidates.ts:29`, `:183`, `:194`,
`convex/gre/ai/choicePriors.ts:167`, plus four test titles
(`legalActions.test.ts:290`, `choice-nodes.bot.test.ts:253`,
`opValuers.bot.test.ts:259`) and two sites where it rides `608.2`
(`state.ts:6066`, `:6249`, where the `608.2` half is right).

The printed rule for the claim is **`CR 608.2d`** ("If an effect of a spell or
ability offers any choices other than choices already made as part of casting
the spell … the player announces these while applying the effect", with the
worked example "A spell's instruction reads, 'You may sacrifice a creature. If
you don't, you lose 4 life.'"), and for the mana leg specifically
**`CR 608.2g`** ("If an effect gives a player the option to pay mana, they may
activate mana abilities before taking that action"). #2982 already moved the
six sites making the narrower "mana abilities stay legal during the may-pay
window" claim from `117.3a` to `608.2g`.

The `118.4` half is a second, overlapping question. `scripts/check-cr-citations.ts`
already carries a bespoke 118.4 scanner (it reds when 118.4 is attached to a
claim about paying LIFE), which suggests the id's use here was looked at once
and left — so this half needs the history read before it is swept, not a
rewrite. Sites where it appears without `117.3a`: `convex/gre/state.ts:3009`,
`convex/gre/legalActions.ts:117`.

**Why it may not deserve its own issue.** It is one more slice of the same
"resolvable but wrong" audit #2982 declared out of scope, and it is bigger than
it looks: three distinct claims share the two ids (the CHOICE, the COST UNION,
and the variable cost), so it is a per-claim decision, not a sweep — the exact
shape that made #2982's families 2 and 3 worth splitting out. If the
citation audit gets one standing ticket rather than one per family, this is a
line on it. See [[2972-cast-permission-siblings-still-miscited]].
