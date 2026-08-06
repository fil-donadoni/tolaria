---
title: A card moved from the stack to a graveyard emits no event, so "from anywhere" triggers cannot see it
discoveredBy: 2319
status: draft
confidence: medium
---

**What is wrong.** The engine has four choke points that put a card into a
graveyard, and only three of them emit a trigger-visible event. The fourth —
`sendStackItemToGraveyard` — pushes the card straight into `owner.graveyard`
with no `pendingEvents` push at all. Every "when this is put into a graveyard
from anywhere" trigger is therefore blind to a stack origin, which is the one
zone the phrase names that the engine cannot observe.

**Evidence.** Emitting paths (`convex/gre/state.ts`):

| choke point                                          | event                     |
| ---------------------------------------------------- | ------------------------- |
| `removePermanentTo` (`state.ts:8188`)                | `CREATURE_DIED`           |
| `discardToGraveyard` (`state.ts:8807`)               | `CARD_DISCARDED`          |
| `millCards` (`state.ts:8832`)                        | `CARD_MILLED`             |
| `moveCardWithGraveyardReplacement` (`state.ts:8863`) | `CARD_PUT_INTO_GRAVEYARD` |
| **`sendStackItemToGraveyard` (`state.ts:5374`)**     | **none**                  |

`sendStackItemToGraveyard` is not a rare path: besides countering
(`SpellContext.counter`, `state.ts:12140`) and the target-illegality auto-fizzle
(`state.ts:4704`), it is how **every ordinary instant/sorcery finishes
resolution** (`finalizeSpellResolution`, `state.ts:5726`), plus the
land-can't-enter redirect (`state.ts:5426`) and the illegal-Aura-host path
(`state.ts:5501`). There is no `SPELL_RESOLVED` / `SPELL_COUNTERED` member in
`GameEventType` either, so nothing else covers it.

Affects all three cards in the from-anywhere family (Worldspine Wurm,
Blightsteel Colossus, Emrakul). It is already acknowledged as out of scope in
`convex/cards/sets/rtr/green.ts:49-51`.

**Why it may not deserve its own issue.** Practically unreachable for the three
cards that care: Emrakul has `cantBeCountered`, and the Wurm and the Colossus
are creature spells, so their stack→graveyard route is essentially only a
counterspell. The general fix (a fifth emit, or folding the stack path into
`CARD_PUT_INTO_GRAVEYARD`) touches the resolution path of every instant and
sorcery in the catalogue — a large blast radius for an edge case, and one that
would want its own design pass on whether a resolving spell's own trip to the
graveyard should be trigger-visible at all (it should not, per CR 608.2m vs. a
countered spell's CR 701.5a). Filing it is defensible; deferring it is too.
