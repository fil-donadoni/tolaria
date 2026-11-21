// Activated direct-damage reach (issue #10422).
//
// `lethalUnblockedDelta` (evaluate.ts, issue #1489) reads a confirmed block as
// a LOSS when the combat damage it lets through is lethal on its own — and as
// nothing at all when it is one burn activation short. Measured on the issue
// board: the defender at 5, the block that leaves a 3/2 unblocked takes it to
// 2 against an untapped "{R}, Sacrifice: 2 damage to any target" and a red
// source. The opponent model does fire it (every seed, every budget measured),
// but from the defender's root each declaration gets ~14 visits, so the node
// under the losing block averages over its untried replies rather than over
// the kill — 0.25 against 0.33 for the safe block, inside `outcomeEps`, and
// `material-tiebreak` picked the block that keeps more creatures: the loss.
//
// This module answers the missing half: how much damage the ATTACKING player
// can still put on the defending player's face with what is ON THE
// BATTLEFIELD, by activating abilities, after combat damage — on its own turn
// (the active player, so sorcery-timed activations in its second main phase
// count). It is a reading of the board, never a model of a choice.
//
// Deliberately CONSERVATIVE, like the term it feeds (it under-reports, never
// over-fires — a false lethal makes the defender chump everything):
//   * only a DSL ability (`effects`) whose every `dealDamage` amount is a
//     constant counts, summed over the ops that can hit the defending player:
//     a `{ player: "opponent" }` recipient or a target slot whose requirement
//     the targeting authority (`getLegalTargets`) says the defender is a legal
//     target for — hexproof, shroud and "can't be targeted" included;
//   * the cost may hold only mana, `{T}` and sacrificing the source itself —
//     any other cost (life, discard, another permanent, counters) or any
//     activation condition or phase restriction drops the ability;
//   * a tap cost needs an untapped source free of summoning sickness
//     (CR 302.6), and an ATTACKING source is never counted (it may not survive
//     the combat whose damage this is added to);
//   * each permanent contributes at most ONE ability, once (a tap or a
//     sacrifice spends it, and an untapped repeatable one is counted once);
//   * the mana is spent once: abilities are taken largest first, each only if
//     the merged cost of everything taken so far is still payable from the
//     player's untapped sources (`canPayCost`, the shared colour-aware reader).
//
// Pure, no card names (ADR 0102).

import type { ManaCost } from "../../cards/types";
import { isTapLockedBySummoningSickness } from "../constants";
import { getEffectiveActivatedAbilities } from "../activatedAbilities";
import { canPayCost } from "../manaAvailability";
import { censusOf, type ManaCensusMemo } from "../manaCensusMemo";
import { getLegalTargets, targetingSourceFromCard } from "../rules";
import type { CardInstanceState, GameState, PlayerState } from "../state";

type ReachAbility = {
    damage: number;
    mana: ManaCost | undefined;
};

/** The cost keys a counted ability may carry: mana, `{T}`, and sacrificing
 *  the source itself (`sacrifice: true` with no `sacrificeFilter`). */
const ALLOWED_COST_KEYS = new Set(["mana", "tap", "sacrifice"]);

/** Ability fields that each gate or reshape the activation in a way this
 *  board reading does not model — present and truthy, the ability is not
 *  counted. */
const DISQUALIFYING_ABILITY_KEYS = [
    "resolve",
    "resolveSteps",
    "effect",
    "modes",
    "modeSelection",
    "getTargetRequirement",
    "additionalTargetRequirements",
    "activationPhaseRestriction",
    "canActivate",
    "activationCondition",
    "activatableOnlyWhileAttached",
    "requiresMaxSpeed",
    "requiresAttackedThisTurn",
    "classLevelBar",
    "functionsAtClassLevel",
    "boast",
    "activateFromGraveyard",
    "activateFromHand",
    "activatableByOpponentsOnly",
    "activatableByEnchantedController",
] as const;

/** The most damage `player` can deal to `defender` this turn by activating
 *  abilities of permanents it controls, paid from its untapped sources. Zero
 *  when nothing on its battlefield qualifies (the common case: the scan finds
 *  no `dealDamage` ability and spends no census). */
export function activatedDamageReach(
    state: GameState,
    player: PlayerState,
    defender: PlayerState,
    memo?: ManaCensusMemo
): number {
    const attacking = new Set(state.combat?.attackerIds ?? []);
    const candidates: ReachAbility[] = [];
    const battlefield = player.battlefield;
    for (let i = 0; i < battlefield.length; i++) {
        const source = battlefield[i];
        if (attacking.has(source.id)) continue;
        const best = bestReachAbilityOf(state, player, defender, source);
        if (best) candidates.push(best);
    }
    if (candidates.length === 0) return 0;
    candidates.sort((a, b) => b.damage - a.damage);
    const units = censusOf(state, player, memo).now;
    let spent: ManaCost = {};
    let reach = 0;
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const merged = mergeManaCosts(spent, c.mana);
        if (!merged || !canPayCost(units, merged, { life: player.life }))
            continue;
        spent = merged;
        reach += c.damage;
    }
    return reach;
}

/** The single most damaging qualifying ability of `source`, or null. */
function bestReachAbilityOf(
    state: GameState,
    player: PlayerState,
    defender: PlayerState,
    source: CardInstanceState
): ReachAbility | null {
    let best: ReachAbility | null = null;
    const abilities = getEffectiveActivatedAbilities(source);
    for (let i = 0; i < abilities.length; i++) {
        const { ability } = abilities[i];
        const effects = ability.effects;
        if (!effects || !ability.useStack) continue;
        const record = ability as unknown as Record<string, unknown>;
        if (DISQUALIFYING_ABILITY_KEYS.some((k) => record[k])) continue;
        const cost = ability.cost as Record<string, unknown>;
        if (Object.keys(cost).some((k) => cost[k] && !ALLOWED_COST_KEYS.has(k)))
            continue;
        if (ability.cost.tap) {
            // A tapped permanent cannot pay {T} again, and a creature's {T}
            // waits out summoning sickness (CR 302.6) unless it has haste.
            if (source.isTapped || isTapLockedBySummoningSickness(source))
                continue;
        }
        let damage = 0;
        for (let j = 0; j < effects.length; j++) {
            const op = effects[j];
            if (op.op !== "dealDamage") continue;
            if (typeof op.amount !== "number" || op.amount <= 0) continue;
            if (op.source) continue;
            if (
                !reachesDefender(
                    state,
                    player,
                    defender,
                    source,
                    ability.targetRequirement,
                    op.to
                )
            )
                continue;
            damage += op.amount;
        }
        if (damage <= 0) continue;
        if (!best || damage > best.damage)
            best = { damage, mana: ability.cost.mana };
    }
    return best;
}

/** Whether a `dealDamage` recipient can be the defending player. */
function reachesDefender(
    state: GameState,
    player: PlayerState,
    defender: PlayerState,
    source: CardInstanceState,
    requirement: Parameters<typeof getLegalTargets>[1] | undefined,
    to: unknown
): boolean {
    if (!to || typeof to !== "object") return false;
    const recipient = to as { player?: unknown; target?: unknown };
    // A two-player game: "opponent" from the activator is the defender.
    if (recipient.player === "opponent") return true;
    if (recipient.target === 0 && requirement) {
        const legal = getLegalTargets(
            state,
            requirement,
            targetingSourceFromCard(source, false),
            player.id
        );
        return legal.some((t) => t.type === "player" && t.id === defender.id);
    }
    return false;
}

/** The pip-wise sum of two mana costs, or null when either holds a pip that
 *  is not a fixed count (a variable `{X}`, a hybrid or generic marker this
 *  sum cannot price). */
function mergeManaCosts(a: ManaCost, b: ManaCost | undefined): ManaCost | null {
    const out: Record<string, number> = {};
    const add = (cost: ManaCost) => {
        const entries = Object.entries(cost);
        for (let i = 0; i < entries.length; i++) {
            const [key, value] = entries[i];
            if (value === undefined) continue;
            if (typeof value !== "number") return false;
            out[key] = (out[key] ?? 0) + value;
        }
        return true;
    };
    if (!add(a)) return null;
    if (b && !add(b)) return null;
    return out as ManaCost;
}
