---
title: A bestowed cast's restricted-mana eligibility is decided from the card's PRINTED types
discoveredBy: 3354
status: draft
confidence: high
---

**What is wrong.** CR 702.103b — "As a spell cast bestowed is put onto the
stack, it becomes an Aura enchantment and gains enchant creature." A bestowed
cast is an **Aura spell**, not a creature spell. Every cast-commit path decides
restricted-mana eligibility from `cardDef.types`, the card's PRINTED types,
which still say Creature.

**Evidence.** The coverage check (`spendablePoolForSpell(player, cardDef.types,
…)`) and the payment (`payCastManaCost` → `payManaCostForSpell`) both run
BEFORE `applyBestowCharacteristics` rewrites the stack item
(`convex/game.ts:3928`, `:7622`). So mana restricted to creature spells
(Metamorphosis' `creature-spell` `ManaRestriction`) pays for a bestowed Aura
spell, which CR 702.103b forbids.

Issue #3354 hit the same seam from the other side: Arena of Glory's "if that
mana is spent on a creature spell" rider fired on a bestowed cast. That half is
closed at the STAMP (`manaRiderStackStamps`'s `bestowed` option,
`convex/gre/state.ts`) — deliberately narrow, because the eligibility half
needs effective cast types threaded through four coverage checks and four
payment calls.

**Fix shape.** Give `payCastManaCost` an effective-spell-types channel (CR
702.103b types when bestowed, printed types otherwise) and use the same value
for the site's own `spendablePoolForSpell` coverage check, so "can I afford it"
and "what did I pay it with" cannot disagree. Supertypes are unaffected: bestow
changes types, not supertypes, so a Legendary creature cast bestowed is still a
legendary spell (CR 205.4a).

**Why it may not deserve its own issue.** It is unreachable today unless a
player floats `creature-spell`-restricted mana (Metamorphosis) and then casts a
bestow creature — two cards that have never met in a shipped deck. If the
effective-cast-types channel is built for another reason (split cards, MDFC,
adventure all want it), this closes as a side effect.
