// C18 (Commander 2018) — colorless cards, split by colour per ADR 0043. The
// registry's `import * as c18 from "./sets/c18"` resolves through c18/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

// Retrofitter Foundry — {1} Artifact (Vintage Cube token maker, issue #678).
// A colorless token engine of four activated abilities (CR 602). Every token
// is a plain spec-driven `createToken` (CR 111 / 707.1); the "untap this
// artifact" mode is a `tapUntap` (action "untap") of `$source`; the upgrade
// modes pay their token cost via `sacrificeFilter` on a controlled Servo /
// Thopter (CR 118.5). All four are authored DSL-first as `effects` (ADR 0045)
// — none inspects a firing event, so no `resolve()` closure is required.
const RETROFITTER_FOUNDRY_ID = "5da578b8-19e6-4068-9336-e7cd33c585f1";

export const retrofitterFoundry: CardDefinition = {
    id: RETROFITTER_FOUNDRY_ID,
    name: "Retrofitter Foundry",
    rarity: "rare",
    oracleText:
        "{3}: Untap this artifact.\n{2}, {T}: Create a 1/1 colorless Servo artifact creature token.\n{1}, {T}, Sacrifice a Servo: Create a 1/1 colorless Thopter artifact creature token with flying.\n{T}, Sacrifice a Thopter: Create a 4/4 colorless Construct artifact creature token.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "retrofitter-foundry-untap",
            oracleText: "{3}: Untap this artifact.",
            cost: { mana: { X: 3 } },
            useStack: true,
            effects: [
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        },
        {
            id: "retrofitter-foundry-servo",
            oracleText:
                "{2}, {T}: Create a 1/1 colorless Servo artifact creature token.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Servo",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Servo"],
                        power: 1,
                        toughness: 1,
                        imagePrintId: tokenPrintIdFor(
                            RETROFITTER_FOUNDRY_ID,
                            "Servo"
                        ),
                    },
                    controller: "controller",
                },
            ],
        },
        {
            id: "retrofitter-foundry-thopter",
            oracleText:
                "{1}, {T}, Sacrifice a Servo: Create a 1/1 colorless Thopter artifact creature token with flying.",
            cost: {
                mana: { X: 1 },
                tap: true,
                sacrificeFilter: { subtypes: "Servo" },
            },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Thopter",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Thopter"],
                        power: 1,
                        toughness: 1,
                        staticAbilities: ["flying"],
                        imagePrintId: tokenPrintIdFor(
                            RETROFITTER_FOUNDRY_ID,
                            "Thopter"
                        ),
                    },
                    controller: "controller",
                },
            ],
        },
        {
            id: "retrofitter-foundry-construct",
            oracleText:
                "{T}, Sacrifice a Thopter: Create a 4/4 colorless Construct artifact creature token.",
            cost: { tap: true, sacrificeFilter: { subtypes: "Thopter" } },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Construct",
                        types: ["Artifact", "Creature"],
                        subtypes: ["Construct"],
                        power: 4,
                        toughness: 4,
                        imagePrintId: tokenPrintIdFor(
                            RETROFITTER_FOUNDRY_ID,
                            "Construct"
                        ),
                    },
                    controller: "controller",
                },
            ],
        },
    ],
};
