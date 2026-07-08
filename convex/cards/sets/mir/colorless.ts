// mir (Mirage) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { ActivatedAbilityContext, CardDefinition } from "../../types";

// Lion's Eye Diamond — "Discard your hand, Sacrifice this artifact: Add
// three mana of any one color. Activate only as an instant." (CR 605.1a mana
// ability, `useStack: false`.) "Discard your hand" is expressed via the
// existing `discardAtRandom` cost primitive with a count comfortably above
// any reachable hand size — the primitive clamps to the actual hand size
// (CR 118.3), so every card is discarded regardless of hand size and the
// random-order detail is moot once every card is discarded. "Activate only
// as an instant" needs no extra modelling: mana abilities are already
// activatable at instant speed (CR 605.3b — any time the player has
// priority), which is the full content of that clause here. Vintage Cube
// free tranche (issue #675, ADR 0041).
export const lionsEyeDiamond: CardDefinition = {
    id: "63bacc32-d6ba-420c-9b49-299c08e5fb39",
    rarity: "rare",
    name: "Lion's Eye Diamond",
    oracleText:
        "Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.",
    manaCost: {},
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "lions-eye-diamond-mana",
            oracleText:
                "Discard your hand, Sacrifice this artifact: Add three mana of any one color.",
            cost: { sacrifice: true, discardAtRandom: 99 },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => {
                ctx.addMana({ W: 3 });
            },
            manaChoices: [{ W: 3 }, { U: 3 }, { B: 3 }, { R: 3 }, { G: 3 }],
        },
    ],
};

// TODO(issue #977 stub — Phyrexian Dreadnought's ETB "sacrifice it unless you
// sacrifice any number of creatures with total power 12 or greater" needs two
// general Effect Script capabilities the frozen Op grammar lacks: (1) a
// non-mana "may pay" punisher cost — `mayPay` only takes a mana cost, so
// "sacrifice this UNLESS you pay [a sacrifice cost]" is inexpressible; and
// (2) an aggregate-power-threshold selection constraint — `choice.count` is
// cardinal, `EffectCount` counts cardinality, and no `EffectValue`/`if`
// predicate can read the SUMMED power of a picks binding, so "total power 12
// or greater" can't gate the pick. Both are general/orthogonal (many cards
// want "sacrifice creatures with total X N"), so they belong as registry
// additions, NOT a card-shaped resolve() (`.claude/rules/gre-development.md`
// § DSL-first authoring: "the Op I need doesn't exist yet" is stop-and-issue,
// not the escape hatch). Trample + the ETB trigger shape are fine; only the
// cost is blocked. Tracked stub.
// export const phyrexianDreadnought: CardDefinition = {
//     id: "7b8197b9-0cd1-4fa1-9668-d1b5f1759151",
//     rarity: "rare",
//     name: "Phyrexian Dreadnought",
//     oracleText:
//         "Trample\nWhen this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.",
//     manaCost: { X: 1 },
//     types: ["Artifact", "Creature"],
//     subtypes: ["Phyrexian", "Dreadnought"],
//     power: 12,
//     toughness: 12,
//     staticAbilities: ["trample"],
// };
