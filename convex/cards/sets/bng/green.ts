// bng — green cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Satyr Wayfinder — {1}{G} Creature — Satyr, 1/1 (Vintage Cube residue,
// issue #1305, parent PRD #620). "When this creature enters, reveal the top
// four cards of your library. You may put a land card from among them into
// your hand. Put the rest into your graveyard." UNBLOCKED since the earlier
// #679 stub note (which predates the `digToHand` Op, issue #984/#1101):
// `digToHand` is a fixed top-N reveal window with a type filter and a
// graveyard destination for the non-kept cards — exactly this shape (`look:
// 4, take: 1, optional: true` — "you MAY put A land card", `filter: { type:
// "Land" }`, `destination: "graveyard"`). Both the reveal-window suspend and
// the graveyard-destination leg are already interpreter-exercised (Reviving
// Vapors, inv/multicolor.ts, issue #1101) — no hand-written per-card test
// required (per-Op test regime, gre-development.md).
export const satyrWayfinder: CardDefinition = {
    id: "13c5a1ce-932a-4b3d-8b86-ed920e646afc",
    name: "Satyr Wayfinder",
    rarity: "common",
    oracleText:
        "When this creature enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Satyr"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: "satyr-wayfinder-etb",
            oracleText:
                "When this creature enters, reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.",
            scope: "self",
            effects: [
                {
                    op: "digToHand",
                    player: "controller",
                    look: 4,
                    take: 1,
                    optional: true,
                    filter: { type: "Land" },
                    destination: "graveyard",
                },
            ],
        }),
    ],
};
