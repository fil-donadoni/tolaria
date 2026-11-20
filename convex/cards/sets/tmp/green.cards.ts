// TMP — green cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";

// Earthcraft — {1}{G} Enchantment. "Tap an untapped creature you control:
// Untap target basic land." Authored DSL-first (ADR 0045). The ability lives
// on the enchantment (no `tap` on the source — the enchantment does not tap
// itself); its whole cost is the `tapOtherFilter` pick (CR 602.1 / 118.8) of
// ONE untapped creature the activator controls, the same cost primitive
// Hand of Justice / Vodalian War Machine use. Because the ability has a
// target it is never a mana ability (CR 605.1a requires "no target"), so it
// uses the stack normally. The effect is the `tapUntap` Op in untap mode
// (CR 701.26b) on the announced basic-land slot; the target is any basic land
// (`supertypeFilter: "Basic"`, CR 205.4a — oracle says "target basic land",
// not restricted to lands you control).
export const earthcraft = defineCard(() => ({
    id: "9dda7531-82a1-4f49-8858-601ddbc6e2bc",
    name: "Earthcraft",
    rarity: "rare",
    oracleText:
        "Tap an untapped creature you control: Untap target basic land.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "earthcraft-untap-land",
            oracleText:
                "Tap an untapped creature you control: Untap target basic land.",
            cost: {
                tapOtherFilter: {
                    filter: { types: "Creature", controllerRelation: "you" },
                    count: 1,
                },
            },
            useStack: true,
            targetRequirement: {
                type: "Land",
                count: 1,
                supertypeFilter: "Basic",
            },
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
            ],
        },
    ],
}));
