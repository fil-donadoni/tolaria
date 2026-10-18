// The Bot's combat-damage split (issue #5662) — how a multi-target
// combat-damage source divides its damage among the creatures it is
// assigning to.
//
// CR 510.1c: a creature blocked by two or more creatures "assigns its combat
// damage to those creatures divided as its controller chooses among them";
// CR 510.1d gives a blocker blocking two or more creatures the same freedom,
// and CR 702.22k hands that choice to the ACTIVE player when the blocked
// creatures band — so the assigner may be splitting damage onto its OWN
// creatures. The engine seeds every such source with a default (all damage on
// the first live blocker, `buildDefaultDamageAssignments`), which is only the
// human assigner modal's pre-fill. Before this module the Bot confirmed that
// seed unedited, and the search (`buildAutoDamageAssignments`) dropped the
// damage of every multi-target source outright.
//
// ONE policy, two consumers, so the search prices the split the driver will
// actually submit:
//   * `chooseCombatDamageAssignments` — the search's stand-in for the whole
//     step's assignment (single-block auto map + this policy for the rest);
//   * `chooseDamageSplit` — one source's split, which the driver submits
//     through `setDamageAssignment` before `confirmDamage` (ADR 0074: the
//     server re-validates it, no client authority).
//
// The policy, general over every source (ADR 0102, no per-card knowledge):
//   * hostile targets (the assigner's opponent's creatures): kill the most
//     VALUABLE set the damage can kill, each priced at its lethal threshold
//     (`lethalThresholdsForSource`: CR 702.19b marked and same-step damage,
//     CR 702.2c deathtouch — reused, never re-derived); with trample, the
//     excess reaches "the player, planeswalker, or battle the creature is
//     attacking" only once EVERY blocker has its lethal (CR 702.19b), so the
//     sink is filled only when the kill set is every blocker; otherwise the
//     remainder goes to the most valuable creature left alive;
//   * friendly targets (CR 702.22k): kill as little value as the damage
//     allows — each creature soaks up to one below its lethal, and when the
//     total cannot be absorbed the least valuable one takes the overflow.
import type { CardInstanceState, GameState } from "../state";
import { getOpponentId } from "../state";
import { findPermanent } from "../lookup";
import { beginLayer7Pass, getEffectivePower } from "../layers";
import { getEffectiveBlockGraph } from "../banding";
import {
    attackTargetExcessSink,
    lethalThresholdsForSource,
} from "../damageAssignment";
import {
    buildAutoDamageAssignments,
    getManualAssignmentSourceIds,
    type DamageKind,
} from "../phases";
import { evaluateCreature } from "../evaluate";

type StepAssignments = Record<string, Record<string, number>>;

/** Above this many live targets the kill-set search stops enumerating subsets
 *  (2^n) and goes greedy. No real board reaches it; the cap only bounds the
 *  worst case of a "can block any number" blocker meeting a wide band. */
const MAX_EXACT_TARGETS = 12;

/** One damage target as the policy prices it. */
type SplitTarget = {
    id: string;
    /** Damage this source must assign before the target is lethally damaged
     *  (0 = already lethally damaged by marked / same-step damage). */
    threshold: number;
    /** What the target's death is worth, floored at 1 so every kill counts. */
    value: number;
};

/** The player who assigns `sourceId`'s combat damage: the recorded assigner
 *  of the step (CR 702.22j-k), else the source's controller (CR 510.1c-d). */
function assignerOf(
    state: GameState,
    sourceId: string,
    source: CardInstanceState
): string {
    return state.combat?.damageAssignerIds?.[sourceId] ?? source.controllerId;
}

/** The kill set of hostile targets worth the most, within `power`. Ties keep
 *  the cheaper set (more damage left to spend), then the earlier one in
 *  enumeration order, so the pick is a pure function of the board. */
function bestKillSet(
    targets: readonly SplitTarget[],
    power: number
): Set<string> {
    if (targets.length > MAX_EXACT_TARGETS) {
        // Greedy fallback: most value per point of damage first.
        const order = [...targets].sort(
            (a, b) =>
                b.value / Math.max(1, b.threshold) -
                a.value / Math.max(1, a.threshold)
        );
        const kills = new Set<string>();
        let left = power;
        for (const t of order) {
            if (t.threshold <= left) {
                kills.add(t.id);
                left -= t.threshold;
            }
        }
        return kills;
    }
    let bestMask = 0;
    let bestValue = -1;
    let bestCost = Infinity;
    for (let mask = 0; mask < 1 << targets.length; mask++) {
        let cost = 0;
        let value = 0;
        for (let i = 0; i < targets.length; i++) {
            if (mask & (1 << i)) {
                cost += targets[i].threshold;
                value += targets[i].value;
            }
        }
        if (cost > power) continue;
        if (value > bestValue || (value === bestValue && cost < bestCost)) {
            bestMask = mask;
            bestValue = value;
            bestCost = cost;
        }
    }
    return new Set(
        targets.filter((_, i) => bestMask & (1 << i)).map((t) => t.id)
    );
}

/** The most valuable target in `pool` that still needs damage to die, else
 *  the first of `pool` — where damage left over after the kills goes. */
function remainderTarget(pool: readonly SplitTarget[]): string | undefined {
    let best: SplitTarget | undefined;
    for (const t of pool) {
        if (t.threshold > 0 && (!best || t.value > best.value)) best = t;
    }
    return (best ?? pool[0])?.id;
}

function splitOntoHostile(
    targets: readonly SplitTarget[],
    power: number,
    excessSinkId: string | undefined
): Record<string, number> {
    const kills = bestKillSet(targets, power);
    const out: Record<string, number> = {};
    let left = power;
    for (const t of targets) {
        const amount = kills.has(t.id) ? t.threshold : 0;
        out[t.id] = amount;
        left -= amount;
    }
    if (left > 0) {
        // CR 702.19b — the excess may reach the sink only once every blocker
        // has been assigned its lethal threshold.
        const sinkOpen =
            excessSinkId !== undefined && kills.size === targets.length;
        const to = sinkOpen
            ? excessSinkId
            : (remainderTarget(targets.filter((t) => !kills.has(t.id))) ??
              remainderTarget(targets));
        if (to !== undefined) out[to] = (out[to] ?? 0) + left;
    }
    return out;
}

function splitOntoFriendly(
    targets: readonly SplitTarget[],
    power: number
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of targets) out[t.id] = 0;
    // A target already lethally damaged dies whatever this source does: it
    // soaks the whole amount for free.
    const doomed = targets.find((t) => t.threshold === 0);
    if (doomed) {
        out[doomed.id] = power;
        return out;
    }
    const soak = targets.reduce((sum, t) => sum + t.threshold - 1, 0);
    // Overflow, if any, lands on the least valuable target — the one death
    // the total forces. Every other target soaks one below its lethal.
    const victim =
        power > soak
            ? targets.reduce((a, b) => (b.value < a.value ? b : a))
            : undefined;
    let left = power;
    for (const t of targets) {
        if (t === victim) continue;
        const amount = Math.min(left, t.threshold - 1);
        out[t.id] = amount;
        left -= amount;
    }
    if (victim) out[victim.id] = left;
    return out;
}

/**
 * `sourceId`'s combat-damage split under the Bot's policy (see the header),
 * or `undefined` when it has no damage to split (no power, no live target).
 *
 * `stepAssignments` is the rest of THIS combat damage step — what the lethal
 * thresholds subtract (CR 702.19b). Every entry the result names is a live
 * target or the trample sink, and the entries total the source's effective
 * power, so `setDamageAssignment` and `confirmDamage`'s completeness gate
 * (`combatDamageAssignmentCompleteness`) both accept it.
 */
export function chooseDamageSplit(
    state: GameState,
    sourceId: string,
    stepAssignments: StepAssignments
): Record<string, number> | undefined {
    const source = findPermanent(state, sourceId);
    if (!source || !state.combat) return undefined;
    const power = Math.max(0, getEffectivePower(state, source));
    if (power === 0) return undefined;

    const graph = getEffectiveBlockGraph(state);
    const isAttacker = state.combat.attackerIds.includes(sourceId);
    const rawTargets = isAttacker
        ? (graph.blockersByAttacker[sourceId] ?? [])
        : (graph.attackersByBlocker[sourceId] ?? []);
    const thresholds = lethalThresholdsForSource(
        state,
        sourceId,
        stepAssignments
    );
    const pass = beginLayer7Pass(state);
    const targets: SplitTarget[] = [];
    const controllers = new Set<string>();
    for (const id of rawTargets) {
        // CR 510.1c — a creature no longer on the battlefield absorbs nothing.
        const card = findPermanent(state, id);
        if (!card) continue;
        controllers.add(card.controllerId);
        targets.push({
            id,
            threshold: thresholds[id] ?? 0,
            value: Math.max(1, evaluateCreature(state, card, undefined, pass)),
        });
    }
    if (targets.length === 0) return undefined;

    const assignerId = assignerOf(state, sourceId, source);
    if (controllers.size === 1 && controllers.has(assignerId)) {
        return splitOntoFriendly(targets, power);
    }
    const excessSinkId =
        isAttacker && source.staticAbilities.includes("trample")
            ? attackTargetExcessSink(
                  state,
                  sourceId,
                  getOpponentId(state, state.activePlayerId)
              )
            : undefined;
    return splitOntoHostile(targets, power, excessSinkId);
}

/**
 * The whole step's combat-damage assignment as the search simulates it: the
 * engine's auto map (unblocked / single-blocked sources) plus the policy's
 * split for every multi-target source (CR 510.1c-d), whoever assigns it — the
 * opponent is modelled as assigning by the same policy. Sources are walked in
 * the engine's own order so a later split sees an earlier one's damage.
 */
export function chooseCombatDamageAssignments(
    state: GameState,
    kind: DamageKind
): StepAssignments {
    const result = buildAutoDamageAssignments(state, kind);
    if (!state.combat) return result;
    const graph = getEffectiveBlockGraph(state);
    for (const sourceId of getManualAssignmentSourceIds(state, kind, graph)) {
        const split = chooseDamageSplit(state, sourceId, result);
        if (split) result[sourceId] = split;
    }
    return result;
}

/** One source's chosen split, and whether the step map already holds it. */
export type ChosenDamageSplit = {
    sourceId: string;
    assignments: Record<string, number>;
    /** The server's map already holds exactly this split (often the seed). */
    unchanged: boolean;
};

/**
 * The split of every source `assignerId` assigns in the CURRENT damage step
 * (the sources whose recorded assigner it is, CR 702.22j-k), each chosen
 * against the step map as it will stand when submitted — the server's map
 * with the earlier splits of this list already applied.
 */
export function damageSplitsFor(
    state: GameState,
    assignerId: string
): ChosenDamageSplit[] {
    const combat = state.combat;
    if (!combat || combat.damageConfirmed !== false) return [];
    const current = combat.damageAssignments ?? {};
    const owned = Object.entries(combat.damageAssignerIds ?? {})
        .filter(([, owner]) => owner === assignerId)
        .map(([sourceId]) => sourceId);
    // The step map as the search builds it: every source this assigner is
    // about to (re)split starts with NO entry, never the engine's seed. A
    // seed left in place would count toward another split's lethal threshold
    // (CR 702.19b) and then be replaced — a trampler could be priced as
    // having lethal on a shared blocker that ends up with none.
    const step: StepAssignments = { ...current };
    for (const sourceId of owned) delete step[sourceId];
    const out: ChosenDamageSplit[] = [];
    for (const sourceId of owned) {
        const split = chooseDamageSplit(state, sourceId, step);
        if (!split) continue;
        step[sourceId] = split;
        out.push({
            sourceId,
            assignments: split,
            unchanged: sameSplit(split, current[sourceId]),
        });
    }
    return out;
}

/** The splits the driver must SUBMIT before confirming: `damageSplitsFor`
 *  minus those the step map already holds (nothing to send for them). */
export function owedDamageSplits(
    state: GameState,
    assignerId: string
): ChosenDamageSplit[] {
    return damageSplitsFor(state, assignerId).filter((s) => !s.unchanged);
}

function sameSplit(
    a: Record<string, number>,
    b: Record<string, number> | undefined
): boolean {
    if (!b) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
    return true;
}
