---
title: Bot material scoring sees a duration-animated artifact as a 0/0 creature
discoveredBy: 3726
status: draft
confidence: medium
---

**What is wrong.** `computeEffectivePT` drops every layer-7 entry whose expiry
is a `duration` when called with `includeTemporary: false`
(`convex/gre/layers.ts:823`), which is how `getPermanentEffectivePower` /
`getPermanentEffectiveToughness` call it (ADR 0020 §2). Layer 4 has no matching
filter, so the same permanent is a CREATURE to the caller with its P/T
contribution removed. `convex/gre/evaluate.ts` scores material through those two
functions, so the Bot values it as a 0/0.

**Evidence.** After Titania's Song leaves the battlefield (issue #3726), the
animated Sol Ring's entries are frozen with `expiry.kind === "duration"`. The
layer-4 `type-change` still makes it a Creature; the sublayer-7a `pt-set` is
filtered out. `getEffectivePower` correctly reads 1/1 and gameplay, SBAs and
combat are all unaffected — only the evaluator's number is wrong.

**Not introduced by issue #3726.** Every existing until-end-of-turn animation
already gets this treatment: an `animation` with a `duration`, a duration-scoped
`pt-set`, a "gain control and it becomes a creature until end of turn". The
lingering snapshot just adds one more producer of the same shape. That is why
this is a finding and not a regression.

**The question it raises.** `includeTemporary: false` exists so the evaluator
does not price a bonus that expires this turn. Dropping the P/T of a permanent
whose CREATURE-NESS is equally temporary is a different thing: it prices a 0/0
that will die to the CR 704.5f SBA as if it were on the board, rather than
pricing a 1/1 that stops being a creature at cleanup. Either layer 4 should
apply the same filter — the permanent is then not a creature at all, which is
the honest end state — or layer 7 should not apply it to an entry that another
layer's duration-scoped entry made a creature in the first place.

**Why it may not deserve its own issue.** It needs a measurement before it
needs a fix: whether the mispricing ever changes a decision is an open question,
and the `blade` corpus is where that is answered. `area:game-bot`, and it owes
a discriminating `must` pair if it becomes a ticket.
