// PIP — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as pip from "./sets/pip/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import {
    defineCard,
    PERMANENT_TYPES,
    type GameEvent,
    type PermanentView,
} from "../../types";

// Alpha Deathclaw — {4}{B}{G} 6/6 Lizard Mutant, menace, trample (issue #3217).
//
// CR 701.37a — "{5}{B}{G}: Monstrosity 4." is the `monstrosity` Op on the
// ability's own source: four +1/+1 counters and the monstrous designation,
// only if it isn't monstrous yet. A second activation resolves and does
// nothing.
//
// CR 603.2 — "When this creature enters or becomes monstrous, destroy target
// permanent." is ONE Oracle line, so ONE `TriggeredAbility` listening to both
// events, never two abilities: a creature that somehow did both at once would
// otherwise put two triggers on the stack off one printed line. The second
// event is `PERMANENT_BECAME_MONSTROUS`, which fires only on the transition
// (CR 701.37a), matched on this permanent's own instance id — so the trigger
// fires once per object; a new object after a zone change (CR 400.7) is not
// monstrous and can become so again.
//
// hand-tail: "When this creature enters or becomes monstrous, destroy target permanent." (#3217)
export const alphaDeathclaw = defineCard(() => ({
    id: "ca4c8b04-66af-4cb3-8003-9088d8344b20",
    name: "Alpha Deathclaw",
    rarity: "rare",
    oracleText:
        "Menace, trample\nWhen this creature enters or becomes monstrous, destroy target permanent.\n{5}{B}{G}: Monstrosity 4. (If this creature isn't monstrous, put four +1/+1 counters on it and it becomes monstrous.)",
    manaCost: { X: 4, B: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Lizard", "Mutant"],
    power: 6,
    toughness: 6,
    staticAbilities: ["menace", "trample"],
    triggeredAbilities: [
        {
            id: "alpha-deathclaw-destroy",
            oracleText:
                "When this creature enters or becomes monstrous, destroy target permanent.",
            event: ["PERMANENT_ENTERED", "PERMANENT_BECAME_MONSTROUS"],
            etbAbility: false, // issue #4758
            matches: (event: GameEvent, self: PermanentView): boolean =>
                (event.type === "PERMANENT_ENTERED" ||
                    event.type === "PERMANENT_BECAME_MONSTROUS") &&
                event.instanceId === self.id,
            targetRequirement: { type: [...PERMANENT_TYPES], count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
    activatedAbilities: [
        {
            id: "alpha-deathclaw-monstrosity",
            oracleText:
                "{5}{B}{G}: Monstrosity 4. (If this creature isn't monstrous, put four +1/+1 counters on it and it becomes monstrous.)",
            cost: { mana: { X: 5, B: 1, G: 1 } },
            useStack: true,
            effects: [
                { op: "monstrosity", target: { ref: "$source" }, count: 4 },
            ],
        },
    ],
}));
