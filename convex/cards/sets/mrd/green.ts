// mrd — green cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Viridian Joiner — {2}{G} Creature — Elf Druid, 1/2. "{T}: Add an amount of
// {G} equal to this creature's power." A single-colour, board-conditional
// mana ability (CR 106.1 / 605.1a) whose amount is the source's OWN power —
// the `manaAmount` hook now receives the source's CURRENT EFFECTIVE power
// (CR 613.4 layer pipeline: +1/+1 counters, anthems, CDAs), not its raw base
// stat (issue #927, `getDynamicManaProduced` / `gre/constants.ts`). No player
// choice is involved (single fixed colour), so this card exercises the fix
// end-to-end through the existing tap-mana-ability path with no further
// engine plumbing needed — unlike Vivi Ornitier (FIN), whose OWN mana
// ability additionally needs a runtime {U}/{R} colour-split CHOICE on a
// NON-tap activation, a separate, not-yet-built activation pathway (tracked
// by a follow-up issue, see `fin/multicolor.ts`).
export const viridianJoiner: CardDefinition = {
    id: "b50679df-bf82-4bb2-9fe3-8ebd7a9decde",
    name: "Viridian Joiner",
    rarity: "common",
    oracleText: "{T}: Add an amount of {G} equal to this creature's power.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "viridian-joiner-mana",
            oracleText:
                "{T}: Add an amount of {G} equal to this creature's power.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaProduced: { G: 1 },
            // CR 106.1 / 613.4 — colourless amount is the source's CURRENT
            // effective power (issue #927), read off the `source` the engine
            // now overrides with the post-layers value.
            manaAmount: (source) => ({ G: source.power ?? 0 }),
        },
    ],
};
