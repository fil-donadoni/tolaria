// DSL-derived card valuation (PRD #1423, issue #1426; aiEffects shadow-script
// mechanism, issue #1431) — the bridge between the per-Op value model
// (`opValuers.ts`) and the latent `cardValue` primitive (`../cardValue.ts`).
// Reads a `CardDefinition`'s Effect Script(s) under CONTEXT-FREE grounding
// (the card's worth in hand) and returns the two scalar pieces the
// `latentValue` precedence composes:
//
//   • spell-script value — a NON-CREATURE's resolution: a real `effects[]`
//     script if present, else its `aiEffects` valuation-only shadow script
//     (issue #1431) if present — both walked through the SAME `OP_VALUERS`.
//     `undefined` when the card has neither (a bare `resolve()` /
//     `effect`-shorthand card) — the signal to fall back to `aiValue`/
//     `base + MV`.
//   • ability-script value — a permanent's activated + triggered ability
//     scripts (real `effects[]`, else `aiEffects`), summed and discounted
//     (conditional / one-shot value on top of the body). 0 when it has none.
//
// Kept isomorphic (types + pure `valueEffectScript`) so it rides in the
// client-importable `cardValue` barrel.

import type { CardDefinition, EffectOp } from "../../cards/types";
import { contextFreeGrounding, type GroundingContext } from "./grounding";
import { valueEffectScript } from "./opValuers";
import type { OpValue } from "./featureBasis";

/** A real `effects[]` script wins outright; otherwise fall back to the
 *  `aiEffects` valuation-only shadow script (issue #1431) — both are walked
 *  through the identical `OP_VALUERS` table, so the caller can't tell them
 *  apart from the resulting `{ points, tags }`. `undefined` when neither is
 *  present (the "no honest shadow script" case the catalogue guard governs). */
function effectiveScript(site: {
    effects?: EffectOp[];
    aiEffects?: EffectOp[];
}): EffectOp[] | undefined {
    if (site.effects && site.effects.length > 0) return site.effects;
    if (site.aiEffects && site.aiEffects.length > 0) return site.aiEffects;
    return undefined;
}

/** Ability scripts are conditional and often one-shot (an ETB, a tap ability),
 *  and the creature body already counts the permanent — so their script value
 *  is discounted before being added to the body (never doubled with it). */
const ABILITY_SCRIPT_DISCOUNT = 0.5;

/** The full DSL-derived `{ points, tags }` of a NON-CREATURE card's spell
 *  script — its real `effects[]` if present, else its `aiEffects` shadow
 *  script (issue #1431), both walked through the identical `OP_VALUERS`.
 *  `undefined` when the card carries neither (see `dslSpellScriptValue`
 *  below). Exposes the TAGS alongside the scalar (`dslSpellScriptValue`
 *  strips them) for a caller that needs to know WHICH feature dimension the
 *  script loads onto — the choice-node `priorFor` seam's context-aware
 *  removal-target bonus (issue #1433) is the first such reader. Defaults to
 *  CONTEXT-FREE grounding (a card's worth in hand); a context-aware caller
 *  passes its own `GroundingContext` (`contextAwareGrounding`, PRD #1423). */
export function dslSpellScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): OpValue | undefined {
    const script = effectiveScript(def);
    if (!script) return undefined;
    return valueEffectScript(script, ctx);
}

/** The DSL spell-script value of a NON-CREATURE card (context-free): its real
 *  `effects[]` script if present, else its `aiEffects` shadow script (issue
 *  #1431) — either walked identically through `OP_VALUERS`. `undefined` when
 *  the card carries neither (a bare `resolve()` / `effect`-shorthand /
 *  legacy-`modes[]` card — those fall back to `aiValue`/`base + MV`; a DSL
 *  modal spell instead nests its modes in an `optionChoice` Op INSIDE
 *  `effects[]`, valued by the walker). */
export function dslSpellScriptValue(def: CardDefinition): number | undefined {
    return dslSpellScriptOpValue(def)?.points;
}

/** The RAW (un-discounted) sum of a card's activated + triggered ability-script
 *  values (context-free): each ability's real `effects[]` script if present,
 *  else its `aiEffects` shadow script (issue #1431). This is the ability
 *  worth of a permanent that is ALREADY IN PLAY — its abilities are
 *  immediately usable, so no in-hand discount applies. The latent (in-hand)
 *  paths discount this before adding it to the body
 *  (`ABILITY_SCRIPT_DISCOUNT`), the realized (in-play) path does not. 0 when
 *  the card has no ability scripts. */
export function dslRealizedAbilityScriptValue(def: CardDefinition): number {
    const ctx = contextFreeGrounding();
    let total = 0;
    for (const ability of def.activatedAbilities ?? []) {
        const script = effectiveScript(ability);
        if (script) total += valueEffectScript(script, ctx).points;
    }
    for (const ability of def.triggeredAbilities ?? []) {
        const script = effectiveScript(ability);
        if (script) total += valueEffectScript(script, ctx).points;
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
