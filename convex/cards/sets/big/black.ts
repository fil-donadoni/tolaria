// BIG — black cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big"` resolves through big/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Harvester of Misery — {3}{B}{B} Creature — Spirit, 5/4, Menace (Vintage
// Cube residue, issue #1305, parent PRD #620). "When this creature enters,
// other creatures get -2/-2 until end of turn. {1}{B}, Discard this card:
// Target creature gets -2/-2 until end of turn." UNBLOCKED since the earlier
// #676 stub note's two gaps:
//  (1) "OTHER creatures get -2/-2" is COMPOSED, not a new exclude-self
//      primitive: `forEach { set: "permanents", zone: "battlefield", filter:
//      { type: "Creature" } }` (no `controller` — a whole-board sweep, CR
//      109.5) applies `pump` -2/-2 to EVERY creature including the source,
//      then a trailing `pump` +2/+2 on `$source` cancels the self-hit.
//      `addTemporaryPTBuff` (`convex/gre/state.ts`) stores each buff as an
//      independent additive entry in `temporaryPTMods` — summed at read time
//      (CR 613.4c layer 7c) — so two same-turn buffs on the same permanent
//      net out exactly to "no change" regardless of order. The resulting
//      state (every OTHER creature -2/-2, the source unaffected) is
//      bit-for-bit what an exclude-self primitive would produce (ADR 0045
//      primitive reuse — decompose, don't add a new primitive).
//  (2) The discard-this-from-hand activation cost is `cost.discardThis` +
//      `activateFromHand: true` — the exact Cycling shape
//      (`convex/cards/abilities/cycling.ts`, CR 702.29a) already engine
//      infra, reused directly here with a custom `effects` (a targeted
//      -2/-2 pump) instead of the cycling factory's fixed "draw a card".
// Both `pump` and `discardThis` are already interpreter/engine-exercised —
// no hand-written per-card test required (per-Op test regime,
// gre-development.md).
export const harvesterOfMisery: CardDefinition = {
    id: "a3012af9-621d-4fae-b00d-079a89ae35fe",
    name: "Harvester of Misery",
    rarity: "mythic",
    oracleText:
        "Menace\nWhen this creature enters, other creatures get -2/-2 until end of turn.\n{1}{B}, Discard this card: Target creature gets -2/-2 until end of turn.",
    manaCost: { X: 3, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 5,
    toughness: 4,
    staticAbilities: ["menace"],
    triggeredAbilities: [
        enteredTrigger({
            id: "harvester-of-misery-etb",
            oracleText:
                "When this creature enters, other creatures get -2/-2 until end of turn.",
            scope: "self",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: -2,
                            toughness: -2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
                {
                    // Cancels the self-hit from the sweep above (see file
                    // header) — nets to "OTHER creatures get -2/-2".
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "harvester-of-misery-discard",
            oracleText:
                "{1}{B}, Discard this card: Target creature gets -2/-2 until end of turn.",
            cost: { mana: { X: 1, B: 1 }, discardThis: true },
            activateFromHand: true,
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: -2,
                    toughness: -2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
