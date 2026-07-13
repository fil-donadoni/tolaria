// NEM — green cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

// Blastoderm — "Shroud (This creature can't be the target of spells or
// abilities.) Fading 3 (This creature enters with three fade counters on it.
// At the beginning of your upkeep, remove a fade counter from it. If you can't,
// sacrifice it.)" (CR 702.18 Shroud; CR 702.32 Fading.)
//
// Fading is expanded implicitly at the getDefinition seam (ADR 0054): the
// `"fading 3"` string injects `entersWith` three fade counters plus the upkeep
// remove-or-sacrifice trigger — no per-card boilerplate. Shroud follows the
// established per-card pattern (Blurred Mongoose `inv/green.ts`): the
// `staticAbilities: ["shroud"]` string is decorative reminder data, and an
// unconditional self-scoped `permanent-guard` static effect enforces CR 702.18.
export const blastoderm: CardDefinition = {
    id: "9db5d6c2-b11f-442a-b172-c0c99c9bec07",
    rarity: "common",
    name: "Blastoderm",
    oracleText:
        "Shroud (This creature can't be the target of spells or abilities.)\nFading 3 (This creature enters with three fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 5,
    toughness: 5,
    staticAbilities: ["shroud", "fading 3"],
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "blastoderm-shroud",
            cantBeTargeted: true,
            applies: (target, source) => target.id === source.id,
        },
    ],
};

// Deep Forest Hermit — "Vanishing 3 (…) When this creature enters, create four
// 1/1 green Squirrel creature tokens. Squirrels you control get +1/+1."
// (CR 702.63 Vanishing; CR 111/701.7 Create; CR 613/611 anthem.)
//
// Vanishing is expanded implicitly at the getDefinition seam (ADR 0054): the
// `"vanishing 3"` string injects `entersWith` three time counters plus the
// upkeep remove-a-time-counter trigger AND the COUNTER_REMOVED-driven
// sacrifice trigger — no per-card boilerplate. It is the first shipped card
// exercising Vanishing end-to-end. The ETB Squirrel factory is a DSL
// `enteredTrigger` (`scope: "self"`) whose `effects` run the `createToken` Op
// (Icatian Town shape). The anthem is a controller-scoped `pt-buff` static
// effect (Angelic Shield shape) narrowed to the Squirrel subtype; it buffs the
// four tokens (and any other Squirrels the controller owns) but not the Hermit
// itself, an Elf Druid.
const DEEP_FOREST_HERMIT_ID = "3287775f-7bec-4e8f-bb8d-daf5ce92e4a8";
export const deepForestHermit: CardDefinition = {
    id: DEEP_FOREST_HERMIT_ID,
    rarity: "rare",
    name: "Deep Forest Hermit",
    oracleText:
        "Vanishing 3 (This creature enters with three time counters on it. At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it.)\nWhen this creature enters, create four 1/1 green Squirrel creature tokens.\nSquirrels you control get +1/+1.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    staticAbilities: ["vanishing 3"],
    triggeredAbilities: [
        enteredTrigger({
            id: "deep-forest-hermit-squirrels",
            oracleText:
                "When this creature enters, create four 1/1 green Squirrel creature tokens.",
            scope: "self",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Squirrel",
                        types: ["Creature"],
                        subtypes: ["Squirrel"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                        imagePrintId: tokenPrintIdFor(
                            DEEP_FOREST_HERMIT_ID,
                            "Squirrel"
                        ),
                    },
                    controller: "controller",
                    count: 4,
                },
            ],
        }),
    ],
    staticEffects: [
        {
            // CR 613.4c anthem — Squirrels the controller owns get +1/+1.
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Squirrel"),
            power: 1,
            toughness: 1,
        },
    ],
};
