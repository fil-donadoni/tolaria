// Minimal continuous-effect layer system (CR 611, 613).
// Scope: P/T buffs (layer 7c) only. Computed at read time — never mutate card state.
//
// Static effects are expressed via an `applies` predicate plus a small
// `StaticEffectContext` of pure helpers (getColors, isCreature, hasSubtype).
// Each card declares its own eligibility rule — engine has no enum of
// scopes/filters to maintain.

import { tryGetCardById } from "../cards";
import type {
    Color,
    ManaCost,
    PermanentView,
    StaticEffect,
    StaticEffectContext,
} from "../cards/types";
import type { CardInstanceState, GameState } from "./state";
import { MANA_COLORS } from "./constants";

export type PTBuff = { power: number; toughness: number };

const ZERO: PTBuff = { power: 0, toughness: 0 };

/** Returns the card definition's static effects, or [] if unknown. */
function getStaticEffects(card: CardInstanceState): StaticEffect[] {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return [];
    return tryGetCardById(cardId)?.staticEffects ?? [];
}

/** Context passed to every static-effect predicate. Pure, state-free. */
export const STATIC_EFFECT_CTX: StaticEffectContext = {
    getColors(card: PermanentView): Color[] {
        const cost = (card.card as { manaCost?: ManaCost }).manaCost;
        if (!cost) return [];
        const colors: Color[] = [];
        // Only WUBRG count as colors (CR 202.2); generic X and colorless C
        // don't make a card colored.
        for (const c of MANA_COLORS) {
            if (c === "C") continue;
            if ((cost[c] ?? 0) > 0) colors.push(c);
        }
        return colors;
    },
    isCreature(card: PermanentView): boolean {
        return card.types.includes("Creature");
    },
    hasSubtype(card: PermanentView, subtype: string): boolean {
        return card.subtypes.includes(subtype);
    },
};

/**
 * Sum of P/T buffs applied to `target` by static effects of all permanents
 * currently on the battlefield (CR 611.2).
 */
export function getStaticPTBuff(
    state: GameState,
    target: CardInstanceState
): PTBuff {
    let power = 0;
    let toughness = 0;

    // Fast path: P/T buffs are only meaningful on creatures (CR 208.2).
    if (!STATIC_EFFECT_CTX.isCreature(target)) return ZERO;

    for (const player of state.players) {
        for (const source of player.battlefield) {
            for (const effect of getStaticEffects(source)) {
                if (effect.kind !== "pt-buff") continue;
                if (!effect.applies(target, source, STATIC_EFFECT_CTX)) {
                    continue;
                }
                power += effect.power;
                toughness += effect.toughness;
            }
        }
    }

    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

/** Effective power after static P/T buffs. Not floored (combat damage floors separately). */
export function getEffectivePower(
    state: GameState,
    target: CardInstanceState
): number {
    return (target.power ?? 0) + getStaticPTBuff(state, target).power;
}

/** Effective toughness after static P/T buffs. */
export function getEffectiveToughness(
    state: GameState,
    target: CardInstanceState
): number {
    return (target.toughness ?? 0) + getStaticPTBuff(state, target).toughness;
}
