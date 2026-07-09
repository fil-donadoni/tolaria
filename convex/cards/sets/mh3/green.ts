// MH3 — green cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../types";

// Fanatic of Rhonas — {1}{G} Creature — Snake Druid, 1/4.
// "{T}: Add {G}. Ferocious — {T}: Add {G}{G}{G}{G}. Activate only if you
// control a creature with power 4 or greater." (Ferocious ability word —
// engine infra, no registry row.)
// TODO(issue #691): Eternalize {2}{G}{G} — the Eternalize keyword is planned
// (mechanicsRegistry.ts) but not yet implemented.
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
    ],
};
