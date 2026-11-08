---
title: The Bot's search cast emits SPELL_CAST without manaSpentToCast
discoveredBy: 8591
status: draft
confidence: high
---

**What is wrong.** `commitCastInSearch` (`convex/gre/applyMove.ts`) and the
dominance probe (`convex/gre/ai/dominance.ts`) call
`emitSpellCastEvent(state, stackItem)` with no mana count, so the
`no-mana-spent-to-cast` cast-trigger condition (`convex/cards/compiledTriggers.ts`)
fails closed in the search tree: the Bot never sees Vexing Bauble (or any later
"if no mana was spent to cast it" card) counter a free or zero-cost spell, and
casts one into it as if nothing happened.

**Evidence.** The server Cast Commit (`convex/gre/castCommit.ts`) stamps
`SpellCastEvent.manaSpentToCast` from its priced mana leg; the search path has
no priced leg — its tap plan is the coarse mana model `searchCastManaSpent`
describes — so issue #8591 left it absent on purpose rather than guess a zero.

**Shape of a fix.** Derive the count in `commitCastInSearch` from the Move's
own announced cost (zero-cost card, an alternative cost with no mana leg, an
empty tap plan with nothing drawn from the pool), and pass it to
`emitSpellCastEvent`. Proof: a `*.bot.test.ts` where the Bot, facing an opposing
Bauble, prefers a paid line over casting Ornithopter.
