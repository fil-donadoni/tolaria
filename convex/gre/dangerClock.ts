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
import { getEffectivePower, getEffectiveToughness } from "./layers";
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

/** The predicted result of a DECLARED combat: the face damage that gets through
 *  and the creatures that die on each side. Pure and valuation-free — the leaf
 *  evaluation (ADR 0020 §3) values the dead creatures itself, keeping this
 *  module free of the `evaluate` valuation it would otherwise depend on. */
export type CombatOutcome = {
    /** Combat damage reaching the defender's life. */
    faceDamage: number;
    /** Ids of the attacking player's creatures expected to die. */
    deadAttackerIds: string[];
    /** Ids of the defending player's blockers expected to die. */
    deadBlockerIds: string[];
};

/** Crude, pure prediction of how the combat ALREADY DECLARED in `state.combat`
 *  resolves, from a sensible defender (ADR 0020 §3). It reuses the Danger Clock's
 *  legality helpers and greedy, biggest-threat-first shape rather than adding a
 *  second combat subsystem; the only addition over `predictUnblockedDamage` is
 *  that it tracks trades (which creatures die), not just damage prevented.
 *
 *  Per declared attacker (processed biggest-power-first), the defender:
 *    1. takes a block that KILLS the attacker and SURVIVES (free removal), else
 *    2. takes a TRADE that kills the attacker if the blocker is not bigger by
 *       body (P+T) — an even-or-favourable exchange, else
 *    3. lets it through (the attacker's power hits the defender's life).
 *  Toughness-only chumps are not modelled (a blocker that cannot kill the
 *  attacker is kept back) — crude, exactly as ADR 0018 specifies for the clock. */
export function predictCombatOutcome(
    state: GameState,
    attackerId: string,
    defenderId: string
): CombatOutcome {
    const empty: CombatOutcome = {
        faceDamage: 0,
        deadAttackerIds: [],
        deadBlockerIds: [],
    };
    const attacker = state.players.find((p) => p.id === attackerId);
    const defender = state.players.find((p) => p.id === defenderId);
    const combat = state.combat;
    if (!attacker || !defender || !combat) return empty;

    const declared = combat.attackerIds
        .map((id) => attacker.battlefield.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => !!c && isCreature(c))
        .sort(
            (a, b) => getEffectivePower(state, b) - getEffectivePower(state, a)
        );

    const blockers = defender.battlefield.filter((c) => isCreature(c));
    const used = new Set<string>();
    const out: CombatOutcome = {
        faceDamage: 0,
        deadAttackerIds: [],
        deadBlockerIds: [],
    };

    for (const atk of declared) {
        const atkP = Math.max(0, getEffectivePower(state, atk));
        const atkT = Math.max(0, getEffectiveToughness(state, atk));
        const legal = blockers.filter(
            (b) =>
                !used.has(b.id) &&
                evaluateBlockerKeywords(atk, b, defender.battlefield).eligible
        );

        // 1. Kills the attacker and survives — always worth it for the defender.
        const survivingKiller = legal.find(
            (b) =>
                getEffectivePower(state, b) >= atkT &&
                getEffectiveToughness(state, b) > atkP
        );
        if (survivingKiller) {
            used.add(survivingKiller.id);
            out.deadAttackerIds.push(atk.id);
            continue;
        }

        // 2. Trades with the attacker (both die) — taken only when the blocker is
        // not bigger by body (P+T), a crude even-or-favourable-exchange proxy.
        const aSize = atkP + atkT;
        const trade = legal.find((b) => {
            if (getEffectivePower(state, b) < atkT) return false; // can't kill atk
            const bSize =
                Math.max(0, getEffectivePower(state, b)) +
                Math.max(0, getEffectiveToughness(state, b));
            return bSize <= aSize;
        });
        if (trade) {
            used.add(trade.id);
            out.deadAttackerIds.push(atk.id);
            out.deadBlockerIds.push(trade.id);
            continue;
        }

        // 3. Unblocked — its power reaches the defender's life.
        out.faceDamage += atkP;
    }

    return out;
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
