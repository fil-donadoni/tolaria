// Danger Clock — the race term of the Bot's position evaluation (ADR 0018,
// issue #196).
//
// Each player has a clock: how fast their board kills the other player. The
// evaluation rewards holding the FASTER clock, so the Bot defends when its own
// clock is short (an opposing board about to kill it) and presses damage when it
// holds the faster clock instead of turtling. This estimates the threat BEYOND
// the rollout's turn-boundary horizon (ADR 0015) — the rollout plays out one
// round of realized damage; the clock reads the steady state past it.
//
// PURE. The incoming-damage estimate is net of available blockers via a crude
// best-block assignment (the defender chumps the biggest threats), and respects
// the SAME keyword evasion the real combat resolver uses — `combatRegistry`'s
// `evaluateBlockerKeywords` / `evaluateAttackerKeywords` — so which blocks are
// legal never drifts from how combat actually resolves. (The combat resolver's
// own `bestDefenderBlocks` is eval-based; reusing it here would recurse through
// `evaluate`, so the Clock shares the legality rules and does its own crude,
// non-eval assignment, exactly as ADR 0018 specifies.)

import type { GameState } from "./state";
import { getEffectivePower } from "./layers";
import { isCreature } from "./constants";
import {
    evaluateBlockerKeywords,
    evaluateAttackerKeywords,
} from "./combatRegistry";

/** Reward magnitude for holding a one-combat-lethal clock (a full fraction).
 *  Forge-scale (ADR 0018) but kept below a creature's worth (~170) so the clock
 *  is a positional nudge — defend / press — not an override of material. */
const W_CLOCK = 150;

/** Crude, pure prediction of the combat damage `attackerId`'s board pushes
 *  through `defenderId`'s blockers in one combat, assuming the defender blocks to
 *  minimise damage taken (chump the biggest threats first). Forward-looking: it
 *  ignores tapped / summoning-sickness (both transient — the creatures untap and
 *  lose sickness on the relevant future turn), so it reads the steady-state clock
 *  rather than just this turn. Respects keyword evasion via `combatRegistry`. */
export function predictUnblockedDamage(
    state: GameState,
    attackerId: string,
    defenderId: string
): number {
    const attacker = state.players.find((p) => p.id === attackerId);
    const defender = state.players.find((p) => p.id === defenderId);
    if (!attacker || !defender) return 0;

    // Potential attackers: creatures that may attack (not defender-restricted)
    // and deal positive damage.
    const attackers = attacker.battlefield
        .filter(
            (c) =>
                isCreature(c) &&
                evaluateAttackerKeywords(c).eligible &&
                getEffectivePower(state, c) > 0
        )
        .sort(
            (a, b) => getEffectivePower(state, b) - getEffectivePower(state, a)
        );

    const blockers = defender.battlefield.filter((c) => isCreature(c));
    const usedBlocker = new Set<string>();

    let damage = 0;
    for (const atk of attackers) {
        // The defender spends a blocker on the biggest threats first; one legal,
        // unused blocker stops ALL of an attacker's damage (crude — toughness /
        // trades are not modelled, only damage prevented).
        const blocker = blockers.find(
            (b) =>
                !usedBlocker.has(b.id) &&
                evaluateBlockerKeywords(atk, b, defender.battlefield).eligible
        );
        if (blocker) usedBlocker.add(blocker.id);
        else damage += getEffectivePower(state, atk);
    }
    return damage;
}

/** One player's clock reward: how fast they kill the other, as the fraction of
 *  the defender's life removed per combat (capped at one combat = lethal on
 *  board). Zero when there is no incoming damage. */
function clockReward(dmgPerCombat: number, defenderLife: number): number {
    if (dmgPerCombat <= 0) return 0;
    const fraction = Math.min(1, dmgPerCombat / Math.max(1, defenderLife));
    return W_CLOCK * fraction;
}

/** Signed Danger Clock contribution to `evaluate`, from `playerId`'s view:
 *  my clock reward (how fast I kill the opponent) minus the opponent's (how fast
 *  they kill me). Positive when I hold the faster clock, negative when an
 *  opposing board threatens me — symmetric, so the Bot both presses when ahead
 *  and defends when behind. Pure; zero on a creatureless or mirrored board. */
export function dangerClock(state: GameState, playerId: string): number {
    const me = state.players.find((p) => p.id === playerId);
    const opp = state.players.find((p) => p.id !== playerId);
    if (!me || !opp) return 0;

    const myDamage = predictUnblockedDamage(state, me.id, opp.id);
    const oppDamage = predictUnblockedDamage(state, opp.id, me.id);
    return clockReward(myDamage, opp.life) - clockReward(oppDamage, me.life);
}
