// LCI — green cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import { createMapTokenOp } from "../../abilities/tokens/mapToken";

// Sentinel of the Nameless City — {2}{G} Creature — Merfolk Warrior Scout 3/4
// (LCI, issue #2376, parent PRD #1525). "Vigilance. Whenever this creature
// enters or attacks, create a Map token."
//
// The card that earned Explore (CR 701.44) its Effect Op. Two seams, neither
// of them card-shaped:
//
// 1. ONE Oracle line spanning two engine events (CR 603.2) => ONE
//    `TriggeredAbility` with an array `event` and a discriminating `matches`,
//    the Sin, Spira's Punishment shape (`fin/multicolor.ts`). Two abilities
//    would put two separate triggers on the stack off one line.
// 2. The Map token is the SHARED `MAP_TOKEN_SPEC`
//    (`abilities/tokens/mapToken.ts`), so every Map in the game — this one and
//    Get Lost's two, when that card ships — is one synthesized token
//    definition with one art and one client rehydration path. The token's own
//    activated ability is where Explore actually happens; this card never
//    mentions the keyword.
export const sentinelOfTheNamelessCity: CardDefinition = {
    id: "eeeffc0b-dc92-458e-ad58-86ff6077a508",
    name: "Sentinel of the Nameless City",
    rarity: "uncommon",
    oracleText:
        'Vigilance\nWhenever this creature enters or attacks, create a Map token. (It\'s an artifact with "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.")',
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Warrior", "Scout"],
    power: 3,
    toughness: 4,
    staticAbilities: ["vigilance"],
    triggeredAbilities: [
        {
            id: "sentinel-of-the-nameless-city-map",
            oracleText:
                "Whenever this creature enters or attacks, create a Map token.",
            // CR 603.2 — ONE Oracle line spanning two engine events, so ONE
            // ability with an array `event` (the Sin, Spira's Punishment shape,
            // `fin/multicolor.ts`); two abilities would render twice on the
            // stack off a single printed line.
            event: ["PERMANENT_ENTERED", "ATTACKERS_DECLARED"],
            matches: (event: GameEvent, self: PermanentView): boolean =>
                (event.type === "PERMANENT_ENTERED" &&
                    event.instanceId === self.id) ||
                (event.type === "ATTACKERS_DECLARED" &&
                    event.attackerIds.includes(self.id)),
            effects: [createMapTokenOp()],
        },
    ],
};
