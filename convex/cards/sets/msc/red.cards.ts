// MSC — red cards, split by colour per ADR 0043. The registry's
// `import * as msc from "./sets/msc/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Batroc the Leaper — {1}{R} Legendary Creature — Human Villain, 2/2 (Vintage
// Cube, issue #7226). "Multikicker {2}\nBatroc enters with a +1/+1 counter on
// him for each time he was kicked.\nWhen Batroc enters, he deals damage equal
// to his power to each of up to X targets, where X is the number of times he
// was kicked."
//   - Multikicker is ONE `kickers[]` entry with `multi: true` (CR 702.33c, a
//     multikicker cost is a kicker cost).
//   - The counters are a replacement on how he enters (CR 614.1c / 122.1): one
//     `entersWith.counters` row with COUNT "kicker" reads the paid count
//     (CR 702.33d), so he is already 2+N power when the trigger is announced.
//   - The trigger's target bound `{ kickerCount: true }` is fixed at
//     announcement (CR 601.2c via 603.3d); "up to" gives `min: 0`. Damage is
//     his EFFECTIVE power at resolution (CR 613), counters included.
//     "Each of" is a `forEach { set: "targets" }` sweep over "any target"
//     (CR 115.4), the Distorting Wake shape.
// hand-tail: Batroc enters with a +N/+N counter on him for each time he was kicked (#7226)
export const batrocTheLeaper = defineCard(() => ({
    id: "e34e33ea-042e-409c-b304-52644ec5b1f5",
    name: "Batroc the Leaper",
    rarity: "rare",
    oracleText:
        "Multikicker {2} (You may pay an additional {2} any number of times as you cast this spell.)\nBatroc enters with a +1/+1 counter on him for each time he was kicked.\nWhen Batroc enters, he deals damage equal to his power to each of up to X targets, where X is the number of times he was kicked.",
    manaCost: { X: 1, R: 1 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Human", "Villain"],
    power: 2,
    toughness: 2,
    kickers: [
        {
            id: "kicker",
            description: "Multikicker {2}",
            mana: { X: 2 },
            multi: true,
        },
    ],
    entersWith: {
        counters: [{ type: "+1/+1", count: "kicker" }],
    },
    triggeredAbilities: [
        enteredTrigger({
            id: "batroc-the-leaper-etb",
            oracleText:
                "When Batroc enters, he deals damage equal to his power to each of up to X targets, where X is the number of times he was kicked.",
            scope: "self",
            targetRequirement: {
                type: "any",
                count: { min: 0, max: { kickerCount: true } },
            },
            effects: [
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { ref: "$source.power" },
                            to: { ref: "$each" },
                        },
                    ],
                },
            ],
        }),
    ],
}));
