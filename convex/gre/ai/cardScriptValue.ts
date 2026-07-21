// DSL-derived card valuation (PRD #1423, issue #1426) — the bridge between the
// per-Op value model (`opValuers.ts`) and the latent `cardValue` primitive
// (`../cardValue.ts`). Reads a `CardDefinition`'s Effect Script(s) under
// CONTEXT-FREE grounding (the card's worth in hand) and returns the two scalar
// pieces the `latentValue` precedence composes:
//
//   • spell-script value — a NON-CREATURE's resolution (`effects[]`, or the
//     best mode of a modal `modes[]`). `undefined` when the card has no DSL
//     spell script (a `resolve()` / `effect`-shorthand card) — the signal to
//     fall back to `base + MV`.
//   • ability-script value — a permanent's activated + triggered ability
//     scripts, summed and discounted (conditional / one-shot value on top of
//     the body). 0 when it has none.
//
// Kept isomorphic (types + pure `valueEffectScript`) so it rides in the
// client-importable `cardValue` barrel.

import type { CardDefinition } from "../../cards/types";
import { contextFreeGrounding } from "./grounding";
import { valueEffectScript } from "./opValuers";

/** Ability scripts are conditional and often one-shot (an ETB, a tap ability),
 *  and the creature body already counts the permanent — so their script value
 *  is discounted before being added to the body (never doubled with it). */
const ABILITY_SCRIPT_DISCOUNT = 0.5;

/** The DSL spell-script value of a NON-CREATURE card (context-free), or
 *  `undefined` when the card carries no DSL spell script (a `resolve()` /
 *  `effect`-shorthand / legacy-`modes[]` card — those fall back to `base + MV`;
 *  a DSL modal spell instead nests its modes in an `optionChoice` Op INSIDE
 *  `effects[]`, valued by the walker). */
export function dslSpellScriptValue(def: CardDefinition): number | undefined {
    if (def.effects && def.effects.length > 0) {
        return valueEffectScript(def.effects, contextFreeGrounding()).points;
    }
    return undefined;
}

/** The RAW (un-discounted) sum of a card's activated + triggered ability-script
 *  values (context-free). This is the ability worth of a permanent that is
 *  ALREADY IN PLAY — its abilities are immediately usable, so no in-hand
 *  discount applies. The latent (in-hand) paths discount this before adding it
 *  to the body (`ABILITY_SCRIPT_DISCOUNT`), the realized (in-play) path does
 *  not. 0 when the card has no ability scripts. */
export function dslRealizedAbilityScriptValue(def: CardDefinition): number {
    const ctx = contextFreeGrounding();
    let total = 0;
    for (const ability of def.activatedAbilities ?? []) {
        if (ability.effects && ability.effects.length > 0) {
            total += valueEffectScript(ability.effects, ctx).points;
        }
    }
    for (const ability of def.triggeredAbilities ?? []) {
        if (ability.effects && ability.effects.length > 0) {
            total += valueEffectScript(ability.effects, ctx).points;
        }
    }
    return total;
}

/** The DSL ability-script value of a card's activated + triggered abilities
 *  (context-free), discounted and summed — the LATENT (in-hand) ability worth
 *  added to a creature's body by the `latentValue` precedence. Kept strictly
 *  below its realized (in-play) counterpart (`dslRealizedAbilityScriptValue`)
 *  by `ABILITY_SCRIPT_DISCOUNT < 1`, so a creature's latent worth stays below
 *  its realized board worth — casting a utility creature is strictly positive
 *  (issue #149, review #1440). 0 when the card has no ability scripts. */
export function dslAbilityScriptValue(def: CardDefinition): number {
    return dslRealizedAbilityScriptValue(def) * ABILITY_SCRIPT_DISCOUNT;
}
