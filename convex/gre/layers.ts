// Minimal continuous-effect layer system (CR 611, 613).
// Scope: P/T buffs (layer 7c) only. Computed at read time — never mutate card state.
//
// Explicit non-goals for this iteration:
// - No layer ordering beyond 7c (no type-changing, no ability-adding, etc.)
// - No characteristic-defining abilities
// - No dependency graph; effects are assumed independent

import { tryGetCardById } from "../cards";
import type { StaticEffect } from "../cards/types";
import type { CardInstanceState, GameState } from "./state";

/** Aggregated P/T delta applied to a given creature by all active static effects. */
export type PTBuff = { power: number; toughness: number };

const ZERO: PTBuff = { power: 0, toughness: 0 };

/** Returns the card definition's static effects, or [] if unknown. */
function getStaticEffects(card: CardInstanceState): StaticEffect[] {
    const cardId = (card.card as { id?: string }).id;
    if (!cardId) return [];
    return tryGetCardById(cardId)?.staticEffects ?? [];
}

/**
 * Sum of P/T buffs applied to `target` by static effects of all permanents
 * currently on the battlefield (CR 611.2). Target must be a creature for
 * P/T buffs to be meaningful; callers enforce that.
 */
export function getStaticPTBuff(
    state: GameState,
    target: CardInstanceState
): PTBuff {
    let power = 0;
    let toughness = 0;

    for (const player of state.players) {
        for (const source of player.battlefield) {
            for (const effect of getStaticEffects(source)) {
                if (effect.kind !== "pt-buff") continue;
                if (!isEligible(effect, source, target)) continue;
                power += effect.power;
                toughness += effect.toughness;
            }
        }
    }

    if (power === 0 && toughness === 0) return ZERO;
    return { power, toughness };
}

function isEligible(
    effect: Extract<StaticEffect, { kind: "pt-buff" }>,
    source: CardInstanceState,
    target: CardInstanceState
): boolean {
    // Target must be a creature (CR 208.2 — only creatures have P/T).
    if (!target.types.includes("Creature")) return false;

    if (effect.scope === "creatures-you-control") {
        if (target.controllerId !== source.controllerId) return false;
    }

    if (effect.condition === "untapped" && target.isTapped) return false;
    if (effect.condition === "tapped" && !target.isTapped) return false;

    return true;
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
