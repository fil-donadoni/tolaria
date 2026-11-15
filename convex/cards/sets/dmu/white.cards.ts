// DMU — white cards, split by colour per ADR 0043. The registry's
// `import * as dmu from "./sets/dmu/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { CASTABLE_PERMANENT_TYPES, defineCard } from "../../types";
import { leftTrigger } from "../../abilities/triggers/leftTrigger";

// Serra Paragon — {2}{W}{W} Creature — Angel 3/4 (issue #1239). Every clause
// is data over shipped seams:
//
//   - Flying — the keyword.
//   - "Once during each of your turns, you may play a land from your graveyard
//     or cast a permanent spell with mana value 3 or less from your graveyard"
//     — a row on the one graveyard play permission record (ADR 0093): both
//     actions, the cast restricted to castable permanent types at mana value
//     3 or less, once per turn (ONE use covers either action, spent against
//     this source), own turn only. A static ability: no stack (CR 305.1 for
//     the land, CR 601.3 for the cast).
//   - "If you do, it gains '…'" — the record's `grantsOnUse` rider, naming the
//     template below. The commit that spends the permission stamps the rider
//     on the card played or cast with it, and the permanent's entry turns it
//     into an indefinite triggered-ability grant — so the permanent keeps the
//     ability even if Serra Paragon leaves first (the card's ruling), and a
//     countered spell carries nothing.
//   - The granted ability is the shared leave trigger, self-scoped to the
//     battlefield → graveyard departure (any permanent type, CR 603.10a looks
//     back for it); `$event.card` names the card in the graveyard (CR 400.7e).
// hand-tail: Once during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life." (#1239)
export const serraParagon = defineCard(() => ({
    id: "ce295f1e-fb31-4275-a5d3-8c6f29afff40",
    name: "Serra Paragon",
    rarity: "mythic",
    oracleText:
        'Flying\nOnce during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life."',
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 3,
    toughness: 4,
    staticAbilities: ["flying"],
    graveyardPlayPermission: {
        actions: ["play-land", "cast"],
        cardTypes: [...CASTABLE_PERMANENT_TYPES],
        maxManaValue: 3,
        oncePerTurn: true,
        yourTurnOnly: true,
        grantsOnUse: "serra-paragon-granted-exile",
    },
    triggeredGrantTemplates: [
        leftTrigger({
            id: "serra-paragon-granted-exile",
            oracleText:
                "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life.",
            scope: "self",
            toZone: "graveyard",
            effects: [
                {
                    op: "moveZone",
                    target: { ref: "$event.card" },
                    to: "exile",
                },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        }),
    ],
}));
