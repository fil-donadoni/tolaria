// gtc — colorless cards (ADR 0043 colour split).
import { defineCard } from "../../types";

// Thespian's Stage — Land (Vintage Cube, issue #7257). The copy ability is the
// shipped `becomeCopy` Op; "except it has this ability" is its
// `except.additionalActivatedAbilityIds` clause (CR 707.9a, issue #7207),
// resolved against the card that prints the resolving ability, so a land that
// became a copy keeps the ability — and a copy of the copy inherits it
// (CR 707.3). The land stays tapped-out by its own cost; the target is any land.
// hand-tail: This land becomes a copy of target land, except it has this ability (#7257)
export const thespiansStage = defineCard(() => ({
    id: "b6f27909-e5cd-44c0-91c4-21624f692fd9",
    name: "Thespian's Stage",
    rarity: "rare",
    oracleText:
        "{T}: Add {C}.\n{2}, {T}: This land becomes a copy of target land, except it has this ability.",
    manaCost: {},
    types: ["Land"],
    activatedAbilities: [
        {
            id: "thespians-stage-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effects: [{ op: "addMana", mana: { C: 1 } }],
            manaProduced: { C: 1 },
        },
        {
            id: "thespians-stage-become-copy",
            oracleText:
                "{2}, {T}: This land becomes a copy of target land, except it has this ability.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            effects: [
                {
                    op: "becomeCopy",
                    target: { ref: "$source" },
                    source: { target: 0 },
                    except: {
                        additionalActivatedAbilityIds: [
                            "thespians-stage-become-copy",
                        ],
                    },
                },
            ],
        },
    ],
}));
