// Minimal continuous-effect layer system (CR 611, 613).
// Scope: P/T buffs (layer 7c) only. Computed at read time — never mutate card state.
//
// Static effects are expressed via an `applies` predicate plus a small
// `StaticEffectContext` of pure helpers (getColors, isCreature, hasSubtype).
// Each card declares its own eligibility rule — engine has no enum of
// scopes/filters to maintain.

import { tryGetCardById } from "../cards";
import { getColorsFromCost } from "../cards/colors";
import type {
    Color,
    ManaCost,
    PermanentView,
    StaticEffect,
    StaticEffectContext,
    StaticEffectStateView,
} from "../cards/types";

export type PTBuff = { power: number; toughness: number };

const ZERO: PTBuff = { power: 0, toughness: 0 };

/** Re-exported for engine callers; the canonical definition lives in types.ts
 *  so static-effect predicates can reference it without a cycle. */
export type LayerStateView = StaticEffectStateView;

/** Returns the card definition's static effects, or [] if unknown. */
function getStaticEffects(card: PermanentView): StaticEffect[] {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return [];
    return tryGetCardById(cardId)?.staticEffects ?? [];
}

/** Context passed to every static-effect predicate. Pure, state-free. */
export const STATIC_EFFECT_CTX: StaticEffectContext = {
    getColors(card: PermanentView): Color[] {
        // Resolve manaCost via registry. The embedded card.card is slimmed to { id }
        // in public/full projections, so reading manaCost directly would silently yield [].
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ?? (cardId ? tryGetCardById(cardId)?.manaCost : undefined);
        return getColorsFromCost(cost);
    },
    isCreature(card: PermanentView): boolean {
        return card.types.includes("Creature");
    },
    hasSubtype(card: PermanentView, subtype: string): boolean {
        return card.subtypes.includes(subtype);
    },
    getCmc(card: PermanentView): number {
        // CR 202.3 — numeric X in the printed cost contributes to mana
        // value (the codebase encodes generic cost as `X: number`); only
        // the string-X placeholder for variable-X cards is treated as 0.
        const embedded = (card.card as { manaCost?: ManaCost }).manaCost;
        const cardId = (card.card as { id?: string }).id;
        const cost =
            embedded ?? (cardId ? tryGetCardById(cardId)?.manaCost : undefined);
        if (!cost) return 0;
        let total = 0;
        for (const [, v] of Object.entries(cost)) {
            if (typeof v === "number") total += v;
        }
        return total;
    },
};

/**
 * Sum of P/T buffs applied to `target` by static effects of all permanents
 * currently on the battlefield (CR 611.2).
 */
export function getStaticPTBuff(
    state: LayerStateView,
    target: PermanentView
): PTBuff {
    let power = 0;
    let toughness = 0;

    // Fast path: P/T buffs are only meaningful on creatures (CR 208.2).
    if (!STATIC_EFFECT_CTX.isCreature(target)) return ZERO;

    for (const player of state.players) {
        for (const source of player.battlefield) {
            for (const effect of getStaticEffects(source)) {
                if (effect.kind === "pt-buff") {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    power += effect.power;
                    toughness += effect.toughness;
                } else if (effect.kind === "pt-cda") {
                    if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                        continue;
                    }
                    const pt = effect.compute(
                        source,
                        state,
                        STATIC_EFFECT_CTX,
                        target
                    );
                    power += pt.power;
                    toughness += pt.toughness;
                }
            }
        }
    }

    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/** Sum of one-shot temporary P/T modifications stored on `target`
 *  (CR 611.1, 611.2). Independent from static effects: these mods live on
 *  the permanent itself and are purged by phase-boundary cleanup. */
function getTemporaryPTBuff(target: PermanentView): PTBuff {
    const mods = target.temporaryPTMods;
    if (!mods?.length) return ZERO;
    let power = 0;
    let toughness = 0;
    for (const m of mods) {
        power += m.power;
        toughness += m.toughness;
    }
    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/** Per-counter-type contribution to layer 7d (CR 613.4d, 122.1d). Only the
 *  P/T-modifying built-in types are recognized here; other types (corpse,
 *  mire, charge, vitality) are inert to the layer system and are read by
 *  card-specific abilities directly. */
const COUNTER_PT_CONTRIBUTION: Record<string, PTBuff> = {
    "+1/+1": { power: 1, toughness: 1 },
    "-1/-1": { power: -1, toughness: -1 },
    "+1/+0": { power: 1, toughness: 0 },
    "-1/-0": { power: -1, toughness: 0 },
    "+0/+1": { power: 0, toughness: 1 },
    "-0/-1": { power: 0, toughness: -1 },
};

/** Sum of P/T contributions from counters on `target` (layer 7d). Reads from
 *  `target.counters` and folds in only types with a non-zero P/T effect. */
function getCounterPTBuff(target: PermanentView): PTBuff {
    const counters = target.counters;
    if (!counters) return ZERO;
    let power = 0;
    let toughness = 0;
    for (const [type, count] of Object.entries(counters)) {
        const contribution = COUNTER_PT_CONTRIBUTION[type];
        if (!contribution || count === 0) continue;
        power += contribution.power * count;
        toughness += contribution.toughness * count;
    }
    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/** Effective power after static P/T buffs. Not floored (combat damage floors separately). */
export function getEffectivePower(
    state: LayerStateView,
    target: PermanentView
): number {
    return (
        (target.power ?? 0) +
        getStaticPTBuff(state, target).power +
        getTemporaryPTBuff(target).power +
        getCounterPTBuff(target).power
    );
}

/** Effective toughness after static P/T buffs. */
export function getEffectiveToughness(
    state: LayerStateView,
    target: PermanentView
): number {
    return (
        (target.toughness ?? 0) +
        getStaticPTBuff(state, target).toughness +
        getTemporaryPTBuff(target).toughness +
        getCounterPTBuff(target).toughness
    );
}
