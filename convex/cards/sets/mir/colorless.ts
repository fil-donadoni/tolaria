// mir (Mirage) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { ActivatedAbilityContext, CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

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

// Phyrexian Dreadnought — {1} 12/12 Artifact Creature with trample and a
// self-ETB punisher (CR 603.6a trigger; CR 118 / 701.16 sacrifice cost). Modern
// Scryfall oracle (ADR 0004): "Trample\nWhen this creature enters, sacrifice it
// unless you sacrifice any number of creatures with total power 12 or greater."
// Expressed as an Effect Script (ADR 0045, DSL-first): a `mayPay` whose cost is
// a THRESHOLD-mode sacrifice leg (`count: { minTotalPower: 12 }`, issue #977 —
// "sacrifice any number of creatures with total power ≥ 12") followed by an
// `if !$paid` that sacrifices the source. The threshold rides the mayPay cost
// leg rather than a generic choice rider (see MayPayCost doc in cards/types.ts).
// The candidate filter is "creatures you control" — INCLUDING the Dreadnought
// itself, per the official ruling that you may (pointlessly) sacrifice it to pay
// its own ability. Reuses only already-exercised Ops (mayPay/if/sacrifice), but
// the threshold count is a new sacrifice-leg shape, so it earns a hand-written
// test (mir/__tests__/colorless.test.ts).
export const phyrexianDreadnought: CardDefinition = {
    id: "7b8197b9-0cd1-4fa1-9668-d1b5f1759151",
    rarity: "rare",
    name: "Phyrexian Dreadnought",
    oracleText:
        "Trample\nWhen this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.",
    manaCost: { X: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Phyrexian", "Dreadnought"],
    power: 12,
    toughness: 12,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        enteredTrigger({
            id: "phyrexian-dreadnought-etb-sacrifice",
            oracleText:
                "When this creature enters, sacrifice it unless you sacrifice any number of creatures with total power 12 or greater.",
            scope: "self",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: {
                        permanent: {
                            action: "sacrifice",
                            filter: { types: "Creature" },
                            count: { minTotalPower: 12 },
                        },
                    },
                    prompt: "Sacrifice creatures with total power 12 or greater, or sacrifice Phyrexian Dreadnought?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    // CR 118 — if the punisher cost is NOT paid, the source is
                    // sacrificed ("sacrifice it unless …").
                    predicate: { not: { binding: "$paid" } },
                    then: [{ op: "sacrifice", target: { ref: "$source" } }],
                },
            ],
        }),
    ],
};
