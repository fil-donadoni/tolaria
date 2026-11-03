// EOC — green cards, split by colour per ADR 0043. The registry's
// `import * as eoc from "./sets/eoc/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import {
    leftTrigger,
    wasSacrificed,
} from "../../abilities/triggers/leftTrigger";

/** Counter name of the CR 122.1d stun counter (`STUN_COUNTER` in
 *  `gre/replacements.ts`, which a card module does not import). */
const STUN = "stun";

// Baloth Prime — {3}{G} Creature — Beast 10/10 (EOC 13, Vintage Cube).
// "This creature enters tapped with six stun counters on it. (If a permanent
// with a stun counter would become untapped, remove one from it instead.)
// Whenever you sacrifice a land, create a tapped 4/4 green Beast creature
// token and untap this creature. {4}, Sacrifice a land: You gain 2 life."
//
// All three clauses are declarative:
//  - the entry rider is the self-replacement pair `entersTapped` +
//    `entersWith.counters` (CR 614.1c, the Mercadian depletion-land shape);
//    the stun counters themselves are engine rules, not card text
//    (CR 122.1d, `applyUntapReplacements` at the `untapPermanent` choke point);
//  - the sacrifice trigger is `leftTrigger` + `wasSacrificed` scoped to YOUR
//    lands (CR 701.21a, the Tireless Tracker shape the compiled
//    "whenever you sacrifice a <type>" head lowers to, issue #7216); its
//    `tapUntap` untap goes through `untapPermanent`, so while stunned it
//    removes a stun counter instead (CR 122.1d);
//  - the life ability pays a land sacrifice through `sacrificeFilter`
//    (CR 602.1a, the Dwarven Armory shape) — and that sacrifice fires the
//    trigger above.
// hand-tail: Whenever you sacrifice a land, create a tapped 4/4 green Beast creature token and untap this creature. (#7803)
export const balothPrime = defineCard(() => ({
    id: "2c723fc9-d5c9-4126-a9a6-f80c247a4b6b",
    name: "Baloth Prime",
    rarity: "rare",
    oracleText:
        "This creature enters tapped with six stun counters on it. (If a permanent with a stun counter would become untapped, remove one from it instead.)\nWhenever you sacrifice a land, create a tapped 4/4 green Beast creature token and untap this creature.\n{4}, Sacrifice a land: You gain 2 life.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 10,
    toughness: 10,
    entersTapped: true,
    entersWith: { counters: [{ type: STUN, count: 6 }] },
    triggeredAbilities: [
        leftTrigger({
            id: "baloth-prime-sac-land",
            oracleText:
                "Whenever you sacrifice a land, create a tapped 4/4 green Beast creature token and untap this creature.",
            scope: "yours",
            toZone: "graveyard",
            filter: { types: "Land" },
            condition: (event) => wasSacrificed(event),
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Beast",
                        types: ["Creature"],
                        subtypes: ["Beast"],
                        power: 4,
                        toughness: 4,
                        colors: ["G"],
                        entersTapped: true,
                    },
                    controller: "controller",
                    count: 1,
                },
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "baloth-prime-gain-life",
            oracleText: "{4}, Sacrifice a land: You gain 2 life.",
            cost: { mana: { X: 4 }, sacrificeFilter: { types: "Land" } },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        },
    ],
}));
