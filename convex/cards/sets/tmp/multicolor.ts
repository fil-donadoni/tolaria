// TMP — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Lobotomy — {2}{U}{B} Sorcery. "Target player reveals their hand, then you
// choose a card other than a basic land card from it. Search that player's
// graveyard, hand, and library for all cards with the same name as the
// chosen card and exile them. Then that player shuffles." (CR 201.2 dynamic
// same-name filter + CR 400.7 multi-zone sweep, issue #1104 gap 2.) The
// `choice(zone: "hand", zoneOwnerId: { target: 0 })` Op is the shipped
// Thoughtseize/Duress template — it reveals the target's hand to the chooser
// AND records the pick in one step (no separate `reveal` Op needed).
// `EffectCardFilter.name`'s bare-ref form now ALSO accepts a `choice`
// binding (not just `nameCard`'s own name-string binding) — `resolveNameRef`
// resolves the picked INSTANCE ID to its live name via the new
// `SpellContext.getCardName`. `moveZone`'s new FOURTH shape (`fromZones` +
// `filter`, no prior choice needed) sweeps all three zones — graveyard,
// hand, library — in one filtered pass to `exile`.
//
// Home set = earliest paper printing (ADR 0041) = Tempest; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/multicolor.ts`.
import type { CardDefinition } from "../../types";
export const lobotomy: CardDefinition = {
    id: "ee7ba92d-d327-4b1c-be40-708c5abb27df", // TMP 267
    name: "Lobotomy",
    rarity: "uncommon",
    oracleText:
        "Target player reveals their hand, then you choose a card other than a basic land card from it. Search that player's graveyard, hand, and library for all cards with the same name as the chosen card and exile them. Then that player shuffles.",
    manaCost: { X: 2, U: 1, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        // CR 701.20a — "reveals their hand" is a PUBLIC reveal to every
        // player (not merely exposed to the chooser for the duration of the
        // pick, which the `choice` Op's own transient exposure would give
        // for free) — an explicit `reveal` Op, same as every other
        // Thoughtseize-family "target player reveals their hand" card.
        {
            op: "reveal",
            player: { target: 0 },
            zone: "hand",
        },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            zoneOwnerId: { target: 0 },
            filter: { excludeSupertype: "Basic" },
            count: 1,
            prompt: "Choose a card other than a basic land card",
            bind: "$chosen",
        },
        {
            op: "moveZone",
            player: { target: 0 },
            fromZones: ["graveyard", "hand", "library"],
            filter: { name: { ref: "$chosen" } },
            to: "exile",
        },
        {
            op: "libraryLook",
            action: "shuffle",
            player: { target: 0 },
        },
    ],
};
