// FUT (Future Sight) — colorless cards, split by colour per ADR 0043. The
// registry's `import * as fut from "./sets/fut"` resolves through fut/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Horizon Canopy — {T}, Pay 1 life: Add {G} or {W}; {1}, {T}, Sacrifice: Draw a
// card. (CR 605.1a mana ability — useStack: false, CR 605.3a; CR 118.4 life
// payment as part of the cost; CR 305 land. The cantrip-sacrifice ability is a
// normal activated ability that uses the stack, CR 602.) Composed entirely from
// existing primitives — the painland mana ability mirrors Standing Stones (DRK).
export const horizonCanopy: CardDefinition = {
    id: "d5dfc25d-a17b-4ead-9484-e8a18b8fa176",
    rarity: "rare",
    name: "Horizon Canopy",
    oracleText:
        "{T}, Pay 1 life: Add {G} or {W}.\n{1}, {T}, Sacrifice this land: Draw a card.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "horizon-canopy-mana",
            oracleText: "{T}, Pay 1 life: Add {G} or {W}.",
            cost: { tap: true, life: 1 },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaChoices: [{ G: 1 }, { W: 1 }],
        },
        {
            id: "horizon-canopy-draw",
            oracleText: "{1}, {T}, Sacrifice this land: Draw a card.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #1264): CR 121.1
            // draw via the DSL `draw` Op.
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Coalition Relic — "{T}: Add one mana of any color.\n{T}: Put a charge
// counter on this artifact.\nAt the beginning of your first main phase,
// remove all charge counters from this artifact. Add one mana of any color
// for each charge counter removed this way." STOP-AND-ISSUE (re-audited
// under the #1306 residue tranche, parent PRD #620): the first mana ability
// alone is trivial (the established any-colour `manaChoices` shape — see
// Starting Town, `fin/colorless.ts`, shipped the same tranche), but the
// phase-trigger effect needs to add N independently-coloured mana instances
// (one choice per counter removed) — there is no `EffectChoiceKind` for
// "pick a mana colour" (the existing `choice` Op kinds are all
// permanent/card/hand selectors) and no SpellContext primitive for a
// repeated colour pick outside the established `manaChoices`/
// `getManaChoices` ACTIVATION-time machinery, which doesn't apply to a
// triggered ability's resolution. Left as a tracked stub pending a "choose N
// colours" primitive. tracked-by: #1368
// export const coalitionRelic: CardDefinition = {
//     id: "7a7c98b0-d64d-4d0a-b284-1187a8e7095e",
//     name: "Coalition Relic",
//     rarity: "rare",
//     manaCost: { X: 3 },
//     types: ["Artifact"],
// };

// Sword of the Meek — {2} Artifact — Equipment. "Equipped creature gets
// +1/+2. Equip {2}. Whenever a 1/1 creature you control enters, you may
// return this card from your graveyard to the battlefield, then attach it to
// that creature." Its original blocker — "needs an Equipment attach Op" —
// is GONE: the Equipment spine shipped (#1349 `attach` Op + Equip ability +
// detach SBA, #1350 equipped-creature-dies last-known, ADR 0065), and #776
// is closed. This stub is therefore a RE-AUDIT candidate, not a capability
// gap: the remaining question is only whether the graveyard→battlefield
// return composes with `attach` in one Effect Script. Ship it or re-file.
// tracked-by: #920
// export const swordOfTheMeek: CardDefinition = {
//     id: "e9f13705-6ede-4c29-a2b4-a082bf69e9c5",
//     name: "Sword of the Meek",
//     rarity: "uncommon",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
//     subtypes: ["Equipment"],
// };
