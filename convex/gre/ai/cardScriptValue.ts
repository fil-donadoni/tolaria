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
import type { OpValue, ValueTag } from "./featureBasis";

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
    if (script) return valueEffectScript(script, ctx);
    return modesScriptOpValue(def, ctx);
}

/** A CAST-TIME modal spell (CR 601.2b–c / 700.2, `modes[]`) carries its
 *  resolution in per-mode Effect Scripts, not in a card-level `effects[]` —
 *  so the plain script reader above finds nothing. Value it the same way the
 *  `optionChoice` walker values a resolution-time modal: worth its BEST mode,
 *  since the chooser picks it (`opValuers.ts` `valueOp`). Modes authored as
 *  `resolve()` closures contribute nothing (no script to walk); `undefined`
 *  when NO mode carries a script, which keeps the `aiValue` / `base + MV`
 *  fallback for a fully-imperative modal card. */
function modesScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext
): OpValue | undefined {
    const modeScripts = (def.modes ?? [])
        .map((mode) => effectiveScript(mode))
        .filter((s): s is EffectOp[] => s !== undefined);
    if (modeScripts.length === 0) return undefined;
    let best: OpValue | undefined;
    for (const script of modeScripts) {
        const value = valueEffectScript(script, ctx);
        if (!best || value.points > best.points) best = value;
    }
    return best;
}

/** The DSL spell-script value of a NON-CREATURE card (context-free): its real
 *  `effects[]` script if present, else its `aiEffects` shadow script (issue
 *  #1431) — either walked identically through `OP_VALUERS`. `undefined` when
 *  the card carries neither (a bare `resolve()` / `effect`-shorthand /
 *  `modes[]` card whose every mode is a `resolve()` closure — those fall back
 *  to `aiValue`/`base + MV`). A modal spell is valued at its BEST mode either
 *  way: a cast-time `modes[]` card via `modesScriptOpValue` below, a
 *  resolution-time `optionChoice` Op via the walker. */
export function dslSpellScriptValue(def: CardDefinition): number | undefined {
    return dslSpellScriptOpValue(def)?.points;
}

/** Merges two `OpValue`s: points summed, tags unioned (dedup) — mirrors
 *  `opValuers.ts`'s internal `addValues`, kept as its own tiny helper here
 *  since it composes ABILITY scripts across an activated + triggered list
 *  rather than Ops within one script. */
function mergeOpValue(a: OpValue, b: OpValue): OpValue {
    const tags = new Set<ValueTag>([...a.tags, ...b.tags]);
    return { points: a.points + b.points, tags: [...tags] };
}

/** The merged, RAW (un-discounted) `{ points, tags }` of a card's activated +
 *  triggered ability scripts under `ctx` (context-free by default): each
 *  ability's real `effects[]` script if present, else its `aiEffects` shadow
 *  script (issue #1431), summed / tag-unioned across every ability. This is
 *  the ability worth of a permanent that is ALREADY IN PLAY — its abilities
 *  are immediately usable, so no in-hand discount applies (the latent
 *  (in-hand) reader, `dslLatentAbilityScriptOpValue` below, discounts this).
 *  `undefined` when the card carries NO ability script at all (real or
 *  shadow) on any ability — the same "no Op maps" `undefined` convention
 *  `dslSpellScriptOpValue` uses. Exposes TAGS (the scalar-only
 *  `dslRealizedAbilityScriptValue` below strips them) for a caller that
 *  needs to know which feature dimension an ABILITY-ONLY card's worth loads
 *  onto — issue #1433 review: Icy Manipulator / Royal Assassin / Nevinyrral's
 *  Disk carry `boardRemoval` + `targeted` only on an ACTIVATED ability (they
 *  have no spell `effects[]` of their own), so a tag reader that only
 *  consults `dslSpellScriptOpValue` never sees it. */
export function dslAbilityScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): OpValue | undefined {
    let acc: OpValue | undefined;
    const abilities = [
        ...(def.activatedAbilities ?? []),
        ...(def.triggeredAbilities ?? []),
    ];
    for (const ability of abilities) {
        const script = effectiveScript(ability);
        if (!script) continue;
        const v = valueEffectScript(script, ctx);
        acc = acc ? mergeOpValue(acc, v) : v;
    }
    return acc;
}

/** The RAW (un-discounted) sum of a card's activated + triggered ability-script
 *  values under `ctx` (context-free by default) — the scalar-only sibling of
 *  `dslAbilityScriptOpValue`. This is the ability worth of a permanent that is
 *  ALREADY IN PLAY — its abilities are immediately usable, so no in-hand
 *  discount applies. The latent (in-hand) paths discount this before adding
 *  it to the body (`ABILITY_SCRIPT_DISCOUNT`), the realized (in-play) path
 *  does not. 0 when the card has no ability scripts. */
export function dslRealizedAbilityScriptValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): number {
    return dslAbilityScriptOpValue(def, ctx)?.points ?? 0;
}

/** The merged, DISCOUNTED `{ points, tags }` of a card's activated + triggered
 *  ability scripts under `ctx` (context-free by default) — the LATENT
 *  (in-hand) sibling of `dslAbilityScriptOpValue`: same tags, points scaled by
 *  `ABILITY_SCRIPT_DISCOUNT` (tags are a membership fact, not a magnitude —
 *  discounting them makes no sense). `undefined` when the card has no
 *  ability scripts (same convention as the realized reader). */
export function dslLatentAbilityScriptOpValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): OpValue | undefined {
    const realized = dslAbilityScriptOpValue(def, ctx);
    if (!realized) return undefined;
    return {
        points: realized.points * ABILITY_SCRIPT_DISCOUNT,
        tags: realized.tags,
    };
}

/** The DSL ability-script value of a card's activated + triggered abilities
 *  (context-free by default), discounted and summed — the LATENT (in-hand)
 *  ability worth added to a creature's body by the `latentValue` precedence.
 *  Kept strictly below its realized (in-play) counterpart
 *  (`dslRealizedAbilityScriptValue`) by `ABILITY_SCRIPT_DISCOUNT < 1`, so a
 *  creature's latent worth stays below its realized board worth — casting a
 *  utility creature is strictly positive (issue #149, review #1440). 0 when
 *  the card has no ability scripts. */
export function dslAbilityScriptValue(
    def: CardDefinition,
    ctx: GroundingContext = contextFreeGrounding()
): number {
    return dslLatentAbilityScriptOpValue(def, ctx)?.points ?? 0;
}
