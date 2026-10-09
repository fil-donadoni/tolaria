---
title: A restriction Aura in hand (Pacifism) is still priced at base + MV — the attach Op is not how Auras attach
discoveredBy: 5154
status: draft
confidence: high
---

**What is wrong.** Issue #5154 priced attack/block/untap restrictions on the
board: the restricted creature loses its share and the source (a Moat, a
Pacifism) earns it back, on both the board term and `permanentRealisedValue`.
The HAND side is untouched: a Pacifism in hand is still `NONCREATURE_BASE +
MV × W_NC_MV` = 28, whatever it would take from the best host on the board.
The issue's key-interfaces list named the `attach` valuer for this, but an
Aura does not resolve through an `attach` Op — it enters attached by CR 303.4
(`opsUsed: []` on the compiled Pacifism), so the valuer has nothing to read.
`attach` is the equip/reconfigure-style self-attach (`ATTACH_VALUE`) and was
left as is.

**Evidence.** `convex/gre/cardValue.ts` `latentValue` — a non-creature with no
script takes the `base + MV` floor; `convex/gre/ai/opValuers.ts:1347` (`attach`)
is reached only by a script that carries the Op. The compiled Pacifism row in
`data/oracle-compiled.json` has `compiledStaticEffects` and no `effects`.

**What it would take.** A latent-lens extension (`ai/grounding.ts`
`LatentLens`, `ai/latentBoard.ts`): for an Aura whose statics are restriction
kinds, price its hand worth at the best legal host's restriction discount
(`creatureRestrictionDiscount` against a hypothetical attachment), the way
`victimUnits` prices a removal spell at its best victim. One lens method, one
`latentValue` branch keyed on `subtypes: ["Aura"]` + restriction statics.

**Why it may not deserve its own issue.** 138 Auras are mis-priced in hand,
but the search already sees the cast's result one ply later (the board term
prices the attached Aura correctly), so the hand floor only mis-orders a
Pacifism against other 2-drops in the `hand` term and the cast-vs-hold
margin. It may be a line on the Brain's valuation tracker rather than a
ticket — unless a blade entry shows the Bot holding a Pacifism it should cast.
