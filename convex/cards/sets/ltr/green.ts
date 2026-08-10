// LTR — green cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { typecyclingAbility } from "../../abilities/cycling";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { createFoodTokenOp } from "../../abilities/tokens/foodToken";

// Delighted Halfling — "{T}: Add {C}.\n{T}: Add one mana of any color. Spend
// this mana only to cast a legendary spell, and that spell can't be
// countered." (issue #1559.) Both engine gaps flagged when this card was
// first triaged (#1530) have now shipped:
// (1) `ManaRestriction` (`convex/gre/types.ts`) grew a `legendary-spell`
// member keyed on the SUPERTYPE "Legendary" (`restrictionAllowsSpell` /
// `restrictedUnitAllowsSpell` / `spendablePoolForSpell` / `payManaCostForSpell`
// now take a parallel `spellSupertypes` channel alongside `spellTypes`); and
// (2) a per-CAST "can't be countered" rider now exists —
// `RestrictedMana.cantBeCounteredRider`, set on the deposited unit via the new
// `ActivatedAbility.manaCantBeCounteredRider` field, detected by
// `payManaCostForSpell`'s boolean return and stamped onto
// `StackItem.dynamicCantBeCountered` at cast-cost commit, read by `counter()`
// alongside the static per-definition `CardDefinition.cantBeCountered`.
// Both abilities are the established declarative mana-ability shape (CR
// 605.3a — `useStack: false`, `manaChoices` + `manaRestriction` +
// `effect` fallback, exactly like Adarkar Unicorn / Mishra's Workshop); no
// Effect Script / `resolve()` needed for either.
export const delightedHalfling: CardDefinition = {
    id: "71384418-173a-4f77-adab-56e52fa23692",
    name: "Delighted Halfling",
    rarity: "rare",
    oracleText:
        "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Halfling", "Citizen"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "delighted-halfling-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 },
            effect: (ctx) => ctx.addMana({ C: 1 }),
        },
        {
            id: "delighted-halfling-legendary",
            oracleText:
                "{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            manaRestriction: "legendary-spell",
            manaCantBeCounteredRider: true,
            // Representative fallback (Adarkar Unicorn pattern) — the real
            // choice always resolves through `manaChoices` above.
            manaProduced: { G: 1 },
            effect: (ctx) => ctx.addMana({ G: 1 }),
        },
    ],
};

// Generous Ent — "Reach. When this creature enters, create a Food token.
// Forestcycling {1}." (Issue #1839.) All three clauses declarative:
//  - Reach: CR 702.17, a plain `staticAbilities` keyword.
//  - The ETB Food token: CR 603.6a `enteredTrigger` + `createFoodTokenOp`,
//    the shared CR 707.2 Food spec (never a hand-rolled token spec).
//  - Forestcycling {1}: CR 702.29e typecycling — `typecyclingAbility`, which
//    shares plain Cycling's activation shell (CR 702.29f).
export const generousEnt: CardDefinition = {
    id: "85d22d5d-3875-42ff-b51e-c6e21db201f5",
    name: "Generous Ent",
    rarity: "common",
    manaCost: { X: 5, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 5,
    toughness: 7,
    oracleText:
        'Reach\nWhen this creature enters, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\nForestcycling {1} ({1}, Discard this card: Search your library for a Forest card, reveal it, put it into your hand, then shuffle.)',
    staticAbilities: ["reach"],
    triggeredAbilities: [
        enteredTrigger({
            id: "generous-ent-etb-food",
            oracleText: "When this creature enters, create a Food token.",
            scope: "self",
            effects: [createFoodTokenOp()],
        }),
    ],
    // CR 702.29e/f — Forestcycling {1}.
    activatedAbilities: [typecyclingAbility({ generic: 1 }, "Forest")],
};
