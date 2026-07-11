// Urza's Legacy (ULG) — black cards, split by colour per ADR 0043. The
// registry's `import * as ulg from "./sets/ulg"` resolves through ulg/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition } from "../../types";
import { cyclingAbility } from "../../abilities/cycling";

// Unearth — {B} Sorcery. "Return target creature card with mana value 3 or less
// from your graveyard to the battlefield." plus Cycling {2} (CR 702.29). The
// reanimation is the same targeted-graveyard-card → battlefield `moveZone`
// shape as Reanimate (tmp/black.ts); the `mvFilter: { max: 3 }` gates the
// target (CR 601.2c) as in Sevinne's Reclamation (c19/white.ts). The Cycling
// ability is the engine/cost capability from issue #689.
export const unearth: CardDefinition = {
    id: "b6cb2549-e485-44d6-9d65-7605c568909e",
    name: "Unearth",
    rarity: "common",
    oracleText:
        "Return target creature card with mana value 3 or less from your graveyard to the battlefield.\nCycling {2} ({2}, Discard this card: Draw a card.)",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
        mvFilter: { max: 3 },
    },
    // CR 400.7 — return the targeted graveyard creature card to the battlefield
    // under its owner's control (the caster).
    effects: [{ op: "moveZone", target: { target: 0 }, to: "battlefield" }],
    // CR 702.29 — Cycling {2}. Usable only from hand at instant speed.
    activatedAbilities: [cyclingAbility({ generic: 2 })],
};
