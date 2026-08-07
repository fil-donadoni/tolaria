// MH3 — green cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../types";
import { PERMANENT_TYPES } from "../../types";
import { ELDRAZI_SPAWN_TOKEN } from "../../sharedTokens";
import { eternalizeAbility } from "../../abilities/eternalize";

/** CR 111 — Fanatic of Rhonas's own printed eternalize token (tmh3 #15, a 4/4
 *  black Token Creature — Zombie Snake Druid). Pinned by hand: the catalogue's
 *  token-art guard (`tokenPrintLookup.test.ts`) only walks `createToken`
 *  specs, and an eternalize token is created by `createTokenCopy`, which has no
 *  static spec to inspect. */
const FANATIC_OF_RHONAS_TOKEN_PRINT_ID = "6ef58164-4155-4e5b-8c16-f16f2ab65baa";

// Fanatic of Rhonas — {1}{G} Creature — Snake Druid, 1/4.
// "{T}: Add {G}. Ferocious — {T}: Add {G}{G}{G}{G}. Activate only if you
// control a creature with power 4 or greater." (Ferocious ability word —
// engine infra, no registry row.)
// "Eternalize {2}{G}{G}" (CR 702.129) is the shared `eternalizeAbility`
// factory (`convex/cards/abilities/eternalize.ts`): a graveyard-source,
// sorcery-speed activated ability whose cost exiles this card and whose script
// creates the CR 707.2 token copy — a 4/4 black Zombie Snake Druid with no mana
// cost, rendered as this card's own printed eternalize token (tmh3 #15).
export const fanaticOfRhonas: CardDefinition = {
    id: "1f9fb33a-3b39-4aff-93b8-aedafe0ea694",
    rarity: "rare",
    name: "Fanatic of Rhonas",
    oracleText:
        "{T}: Add {G}.\nFerocious — {T}: Add {G}{G}{G}{G}. Activate only if you control a creature with power 4 or greater.\nEternalize {2}{G}{G} ({2}{G}{G}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Snake Druid with no mana cost. Eternalize only as a sorcery.)",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Snake", "Druid"],
    power: 1,
    toughness: 4,
    activatedAbilities: [
        {
            id: "tap-for-g",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 1 },
        },
        {
            id: "ferocious-tap-for-gggg",
            oracleText:
                "Ferocious — {T}: Add {G}{G}{G}{G}. Activate only if you control a creature with power 4 or greater.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { G: 4 },
            canActivate(source: PermanentView, stv: TriggerStateView): boolean {
                const controllerId = source.controllerId;
                for (const player of stv.players) {
                    if (player.id !== controllerId) continue;
                    for (const p of player.battlefield) {
                        if (
                            p.types.includes("Creature") &&
                            (p.power ?? 0) >= 4
                        ) {
                            return true;
                        }
                    }
                }
                return false;
            },
        },
        // CR 702.129 — Eternalize {2}{G}{G}. The reminder text's "Zombie Snake
        // Druid" body is rendered from this card's own printed subtypes; the
        // real subtype union is computed by the copy effect at resolution.
        eternalizeAbility(
            { X: 2, G: 2 },
            ["Snake", "Druid"],
            FANATIC_OF_RHONAS_TOKEN_PRINT_ID
        ),
    ],
};

// Malevolent Rumble — {1}{G} Sorcery (Cube FREE wave 3, issue #1531/#1525).
// "Reveal the top four cards of your library. You may put a permanent card
// from among them into your hand. Put the rest into your graveyard. Create a
// 0/1 colorless Eldrazi Spawn creature token with 'Sacrifice this token: Add
// {C}.'" (CR 701.20a reveal, CR 401.4 dig, CR 707.2 token creation.) Fully
// free — a `digToHand` Op (issue #984/#1101) with `reveal: "window"`
// (Reviving Vapors precedent) and `filter: { type: PERMANENT_TYPES }` (any of
// the six permanent card types, CR 300.1) expresses "a permanent card"
// exactly; `destination: "graveyard"` sends the rest there (Reviving Vapors'
// own `graveyard` leg). The Eldrazi Spawn is the shared
// `ELDRAZI_SPAWN_TOKEN` spec (`sharedTokens.ts`), pinned to its own printed
// Scryfall art.
export const malevolentRumble: CardDefinition = {
    id: "a178cfe8-f9fa-4255-88d0-54a0bed079f5",
    rarity: "common",
    name: "Malevolent Rumble",
    oracleText:
        'Reveal the top four cards of your library. You may put a permanent card from among them into your hand. Put the rest into your graveyard. Create a 0/1 colorless Eldrazi Spawn creature token with "Sacrifice this token: Add {C}."',
    manaCost: { X: 1, G: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "digToHand",
            player: "controller",
            look: 4,
            take: 1,
            optional: true,
            filter: { type: [...PERMANENT_TYPES] },
            destination: "graveyard",
            reveal: "window",
        },
        {
            op: "createToken",
            token: ELDRAZI_SPAWN_TOKEN,
            controller: "controller",
        },
    ],
};
