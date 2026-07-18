// C18 (Commander 2018) — colorless cards, split by colour per ADR 0043. The
// registry's `import * as c18 from "./sets/c18"` resolves through c18/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";
import { tokenPrintIdFor } from "../../tokenPrintLookup";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

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

// Coveted Jewel — {6} Artifact (Cube FREE residue, issue #1308). Three
// clauses, all DSL-first (ADR 0045):
//   • "When this artifact enters, draw three cards." — a self-scoped
//     `enteredTrigger` (CR 603.6a) running a single `draw` Op, the Tsabo's
//     Web / Elvish Visionary shape.
//   • "{T}: Add three mana of any one color." — a plain `manaChoices` mana
//     ability (CR 605.1a, `useStack: false`), the Implements of Sacrifice
//     shape scaled from two to three mana per colour; no `effect` closure
//     needed, the engine adds the chosen colour's map directly.
//   • "Whenever one or more creatures an opponent controls attack you and
//     aren't blocked, that player draws three cards and gains control of
//     this artifact. Untap it." — an `ATTACKER_UNBLOCKED`-keyed trigger
//     (CR 509.1h) filtered to attackers NOT controlled by this artifact's
//     controller (in a 2-player game "attacks you" is automatic — there is
//     only one opponent to attack); `oncePerEventBatch` collapses several
//     simultaneous unblocked attackers into ONE trigger (CR 603.3b "whenever
//     one or more ... attack"). The effect never reads the firing event
//     (only the ability's own controller/opponent and `$source`), so it's a
//     pure `effects` script: `draw` (the "opponent" ref resolves to the
//     attacking player, since `matches` already filtered to a controller
//     different from this ability's controller and there are only two
//     players), `gainControl` (indefinite reassignment, CR 613.1b — no
//     duration, matching "gains control of this artifact" with no revert
//     condition printed), then `tapUntap` (untap) of `$source`.
export const covetedJewel: CardDefinition = {
    id: "f83ed433-fae3-4fa5-acad-bb8a5b535ce3", // C18 54
    rarity: "rare",
    name: "Coveted Jewel",
    oracleText:
        "When this artifact enters, draw three cards.\n{T}: Add three mana of any one color.\nWhenever one or more creatures an opponent controls attack you and aren't blocked, that player draws three cards and gains control of this artifact. Untap it.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    triggeredAbilities: [
        enteredTrigger({
            id: "coveted-jewel-etb-draw",
            oracleText: "When this artifact enters, draw three cards.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 3 }],
        }),
        {
            id: "coveted-jewel-steal",
            oracleText:
                "Whenever one or more creatures an opponent controls attack you and aren't blocked, that player draws three cards and gains control of this artifact. Untap it.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerControllerId !== self.controllerId,
            oncePerEventBatch: true,
            effects: [
                { op: "draw", player: "opponent", count: 3 },
                {
                    op: "gainControl",
                    target: { ref: "$source" },
                    controller: "opponent",
                },
                { op: "tapUntap", action: "untap", target: { ref: "$source" } },
            ],
        },
    ],
    activatedAbilities: [
        {
            id: "coveted-jewel-mana",
            oracleText: "{T}: Add three mana of any one color.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ W: 3 }, { U: 3 }, { B: 3 }, { R: 3 }, { G: 3 }],
        },
    ],
};
