// MSC — red cards, split by colour per ADR 0043. The registry's
// `import * as msc from "./sets/msc/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Batroc the Leaper — {1}{R} Legendary Creature — Human Villain 2/2 (MSC 49,
// Vintage Cube). "Multikicker {2} (You may pay an additional {2} any number of
// times as you cast this spell.)
// Batroc enters with a +1/+1 counter on him for each time he was kicked.
// When Batroc enters, he deals damage equal to his power to each of up to X
// targets, where X is the number of times he was kicked."
//
// - Multikicker is a `kickers[]` entry with `multi: true` (CR 702.33c, ADR
//   0079); the payment tally is the kick count.
// - The counters are an ETB replacement (CR 614.1c + 122.1): `entersWith`
//   `count: "kicker"` sums the paid count of the family (CR 702.33e), so the
//   permanent never exists without them (a trigger would leave a window, issue
//   #1693).
// - The trigger's target bound reads the same count: `{ min: 0, max: {
//   kickerCount: true } }` (CR 601.2c via CR 603.3d, issue #7210); unkicked it
//   is 0 and the trigger announces nothing. "Any target" (CR 115.4) admits
//   creatures, players, planeswalkers and battles. `forEach { set: "targets" }`
//   deals the damage to every announced target (CR 120.3), the amount being
//   Batroc's EFFECTIVE power (CR 613, counters included). The damage source
//   is the resolving trigger, i.e. Batroc (CR 120.1); no `source` key needed.
//
// DIVERGENCE (tracked-by: #1417): `{ ref: "$source.power" }` reads the LIVE
// binding with no last-known-information fallback, so if Batroc leaves the
// battlefield in response to his trigger it deals 0 instead of his last known
// power (CR 608.2h). Same gap as Gau, Feral Youth (`fic/red.cards.ts`).
// hand-tail: Batroc enters with a +N/+N counter on him for each time he was kicked (#7226)
// hand-tail: When Batroc enters (#7226)
export const batrocTheLeaper = defineCard(() => ({
    id: "e34e33ea-042e-409c-b304-52644ec5b1f5",
    name: "Batroc the Leaper",
    rarity: "rare",
    oracleText:
        "Multikicker {2} (You may pay an additional {2} any number of times as you cast this spell.)\nBatroc enters with a +1/+1 counter on him for each time he was kicked.\nWhen Batroc enters, he deals damage equal to his power to each of up to X targets, where X is the number of times he was kicked.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Villain"],
    supertypes: ["Legendary"],
    power: 2,
    toughness: 2,
    kickers: [
        {
            id: "multikicker",
            description: "Multikicker {2}",
            mana: { X: 2 },
            multi: true,
        },
    ],
    entersWith: { counters: [{ type: "+1/+1", count: "kicker" }] },
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
