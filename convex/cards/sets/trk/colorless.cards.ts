// TRK — colorless cards, split by colour per ADR 0043. The registry's
// `import * as trk from "./sets/trk/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live here.

import { entersOrUpkeepTrigger } from "../../abilities/triggers/entersOrUpkeepTrigger";
import { defineCard, PERMANENT_TYPES } from "../../types";

// Deep Space 9 — {9} Legendary Artifact — Spacecraft (modern Tron, issue
// #10552).
//   - "When Deep Space 9 enters and at the beginning of your upkeep, …" —
//     ONE Oracle line over two events (CR 603.2), the compiled
//     `enters-or-upkeep` head. Body: `exileTopOfLibrary` four, face up
//     (CR 701.13a), `bindAll` the exiled set, then "put all permanent cards
//     exiled this way onto the battlefield" as ONE instruction (CR 608.2c):
//     `forEach { set: "bound", filter: permanent card (CR 110.4a) }` +
//     `simultaneous`, handed whole to the batch return from exile. The cards
//     enter under their owner's (= the controller's) control.
//   - Station (CR 702.184a) and "9+ | Creatures you control get +3/+3."
//     (CR 721.2a) — `stationThresholds`, no P/T box (CR 721.2c).
// hand-tail: When {self} enters and at the beginning of your upkeep, exile the top four cards of your library. Put all permanent cards exiled this way onto the battlefield. (#10552)
export const deepSpace9 = defineCard(() => ({
    id: "76b039c5-e0a1-410a-954b-52f304e31f7f", // TRK 263
    name: "Deep Space 9",
    rarity: "mythic",
    oracleText:
        "When Deep Space 9 enters and at the beginning of your upkeep, exile the top four cards of your library. Put all permanent cards exiled this way onto the battlefield.\nStation (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery.)\n9+ | Creatures you control get +3/+3.",
    manaCost: { X: 9 },
    types: ["Artifact"],
    subtypes: ["Spacecraft"],
    supertypes: ["Legendary"],
    triggeredAbilities: [
        entersOrUpkeepTrigger({
            id: "deep-space-9-exile-four",
            oracleText:
                "When Deep Space 9 enters and at the beginning of your upkeep, exile the top four cards of your library. Put all permanent cards exiled this way onto the battlefield.",
            effects: [
                {
                    op: "exileTopOfLibrary",
                    player: "controller",
                    count: 4,
                    bindAll: "$exiled",
                },
                {
                    op: "forEach",
                    select: {
                        set: "bound",
                        ref: "$exiled",
                        filter: { type: [...PERMANENT_TYPES] },
                    },
                    simultaneous: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            from: "exile",
                            to: "battlefield",
                        },
                    ],
                },
            ],
        }),
    ],
    stationThresholds: [
        {
            charge: 9,
            staticEffects: [
                {
                    kind: "pt-buff",
                    applies: (target, source, ctx) =>
                        ctx.isCreature(target) &&
                        target.controllerId === source.controllerId,
                    power: 3,
                    toughness: 3,
                },
            ],
        },
    ],
}));
