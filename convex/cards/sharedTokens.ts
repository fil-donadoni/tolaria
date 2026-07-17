// Shared predefined token specs (CR 111 / 707.2). A canonical `TokenSpec` for a
// named token that multiple cards create, so its characteristics — including a
// token-scoped activated ability (issue #778) — live in ONE place and every
// producer creates the identical token (one synthesized definition, shared art).

import type { ActivatedAbilityContext, TokenSpec } from "./types";

/** Treasure token (issue #778 / #1265). "Artifact — Treasure" with "{T},
 *  Sacrifice this artifact: Add one mana of any color." (CR 707.2.)
 *
 *  The mana ability is the Black Lotus shape (`sets/lea/colorless.ts`): a
 *  `useStack: false` mana ability (CR 605.1a) whose `cost: { tap: true,
 *  sacrifice: true }` taps AND sacrifices the source, with `manaChoices`
 *  offering one mana of each of the five colors — the color is chosen at
 *  activation and applied by the engine (the `effect` body is the default
 *  first option). Carried on `TokenSpec.activatedAbilities`, registered onto
 *  the synthesized token definition by `createTokenPermanents`
 *  (`gre/state.ts`). Created today by Hullbreacher's draw-replacement redirect;
 *  reusable by any future Treasure producer (Magda, khm). */
export const TREASURE_TOKEN: TokenSpec = {
    name: "Treasure",
    types: ["Artifact"],
    subtypes: ["Treasure"],
    activatedAbilities: [
        {
            id: "treasure-token-mana",
            oracleText:
                "{T}, Sacrifice this artifact: Add one mana of any color.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
    // Real printed Treasure token art (tcmr, Commander Legends tokens).
    imagePrintId: "284ec798-2725-4741-8748-578c259d0623",
};
