// ECL — green cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Formidable Speaker — "When this creature enters, you may discard a card.
// If you do, search your library for a creature card, reveal it, put it into
// your hand, then shuffle." (CR 603.6a ETB, 117.3a/608.2b optional cost
// gating a conditional follow-on, 701.9 search.) Issue #899 added the
// `discard` leg to `MayPayCost` (mirroring the pre-existing `sacrifice` leg's
// hand-instead-of-battlefield picker) so the optional discard can gate the
// search through the already-shipped boolean-binding `if` predicate — the
// same mayPay + if($paid) shape Force Spike / No More Lies use for their
// counter-unless-pay punisher, here paying with a card instead of mana.
export const formidableSpeaker: CardDefinition = {
    id: "265522eb-4f6a-40e7-b374-3833fa63c80b",
    name: "Formidable Speaker",
    rarity: "rare",
    oracleText:
        "When this creature enters, you may discard a card. If you do, search your library for a creature card, reveal it, put it into your hand, then shuffle.\n{1}, {T}: Untap another target permanent.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 2,
    toughness: 4,
    // "{1}, {T}: Untap another target permanent." (CR 605 activated ability,
    // CR 701.20b untap.) "another target permanent" = any of the CR 300.1
    // permanent types (Vindicate precedent) minus the source itself, injected
    // via a dynamic getTargetRequirement carrying the source id (Sorceress
    // Queen precedent).
    activatedAbilities: [
        {
            id: "formidable-speaker-untap",
            oracleText: "{1}, {T}: Untap another target permanent.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: [...PERMANENT_TYPES], count: 1 },
            getTargetRequirement: (source) => ({
                type: [...PERMANENT_TYPES],
                count: 1,
                excludeInstanceIds: [source.id],
            }),
            effects: [{ op: "tapUntap", action: "untap", target: { target: 0 } }],
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "formidable-speaker-etb",
            oracleText:
                "When this creature enters, you may discard a card. If you do, search your library for a creature card, reveal it, put it into your hand, then shuffle.",
            scope: "self",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    cost: { discard: { count: 1 } },
                    prompt: "Discard a card?",
                    bind: "$discarded",
                },
                {
                    op: "if",
                    predicate: { binding: "$discarded" },
                    then: [
                        {
                            op: "choice",
                            kind: "search-library",
                            player: "controller",
                            zone: "library",
                            filter: { type: "Creature" },
                            count: 1,
                            prompt: "Search your library for a creature card.",
                            bind: "$found",
                        },
                        {
                            op: "reveal",
                            player: "controller",
                            cards: { ref: "$found" },
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$found" },
                            player: "controller",
                            from: "library",
                            to: "hand",
                        },
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: "controller",
                        },
                    ],
                },
            ],
        }),
    ],
};
