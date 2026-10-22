// Dominated multi-blocks (issue #5951) — the search's opponent model at a
// declare-blockers node.
//
// Once the search deals a multi-blocked attacker's damage by the split the
// driver submits (`searchCombatDamageAssignments`, CR 510.1c), a block that
// adds a creature only to feed it to the attacker is no longer free. ISMCTS
// still EXPLORES such a block at the defender's node, and its mean backup
// credits the attacker with every one of those defender mistakes: a swing
// into a blocker that absorbs it for free read as profitable because the
// defender's tree kept "answering" it with Giant Spider + Hypnotic Specter
// and losing the Specter.
//
// A block declaration B is DOMINATED when one of its multi-blocked attackers
// keeps blocked with one blocker fewer (B') and B' is at least as good for
// the defender on every observable axis after combat damage — every defender
// permanent alive after B is alive after B', no attacking-side permanent
// alive after B' was dead after B, neither life total nor poison count moves
// against the defender, and every survivor carries the same counters. B' is
// itself a legal declaration (it is in the enumerated set: a menace-style blocker
// minimum keeps B), so dropping B never removes the defender's best
// answer — B' or something B' leads to by the same argument survives.
//
// The verdict is SIMULATED, never derived: both declarations are applied to a
// clone and resolved through the real combat-damage pipeline (first strike,
// deathtouch, banding's assigner, the lethal thresholds — all the engine's).
// It fails CLOSED to "keep": a declaration whose blocking or whose combat
// damage puts a trigger on the stack or raises a choice (a "whenever blocks"
// payoff, a dies trigger, persist), which the probe cannot resolve, is never
// judged dominated. Damage marked on a survivor is NOT compared: it leaves at
// cleanup (CR 514.2), so a block that only adds damage to the attacker reads
// as no better — a post-combat burn spell that would finish it is the one
// line this approximation gives up.
//
// Bot paths only, like every other pruning: a dominated block is LEGAL, and
// the human affordance surface (`legalActions`) keeps the whole set. It is
// blocker-declaration policy, so it governs the Bot's own blocks too.
//
// Tree and root only (`withoutDominatedBlocks`, `enumerateRootMoves`), never the
// rollout: the defect is the tree node's mean backup over the replies it
// EXPLORES, while a rollout draws one reply per ply in the hot loop. Pruning
// there too shifted the rollout's random stream and flipped two noise-pinned
// Bot-play sweep verdicts (Imperial Seal, Gerrard's Wisdom: `played` on 15
// and 17 of 24 seat-seeds with it, 19 and 20 without) for no `must` gain.
// (Gerrard's Wisdom stopped being noise-pinned once issue #6346's life-gain
// race gave the gain a lethal clock to decide; Imperial Seal still is.)
import type { GameState } from "../state";
import { getOpponentId } from "../state";
import type { Move } from "../moves";
import { cloneGameState } from "../clone";
import { markDeclaredBlockers } from "../combat";
import { recordBlockedAttackers } from "../banding";
import { emitBlockersConfirmedEvents } from "../phases";
import { checkStateBasedActions } from "../sba";
import { resolveCombatDamage } from "../applyMove";

type BlockAssignment = { blockerId: string; attackerId: string };
type DeclareBlockersMove = Extract<Move, { kind: "declare-blockers" }>;

/** What a block declaration leaves behind once combat damage has resolved,
 *  or `undefined` when the probe cannot judge it (a block trigger, a choice). */
type CombatOutcome = {
    defenderAlive: Map<string, string>;
    attackingSideAlive: Map<string, string>;
    defenderLife: number;
    attackingLife: number;
    defenderPoison: number;
    attackingPoison: number;
};

function assignmentKey(assignments: readonly BlockAssignment[]): string {
    return assignments
        .map((a) => `${a.blockerId}>${a.attackerId}`)
        .sort()
        .join(",");
}

function simulateBlocks(
    state: GameState,
    assignments: readonly BlockAssignment[]
): CombatOutcome | undefined {
    const probe = cloneGameState(state);
    const combat = probe.combat;
    if (!combat) return undefined;
    const byBlocker: Record<string, string[]> = {};
    for (const { blockerId, attackerId } of assignments) {
        (byBlocker[blockerId] ??= []).push(attackerId);
    }
    combat.blockerAssignments = byBlocker;
    // The search's own declare-blockers sequence (`applyMoveInSearch`).
    markDeclaredBlockers(probe);
    combat.blockersConfirmed = true;
    recordBlockedAttackers(probe);
    const stackBefore = probe.stack.length;
    emitBlockersConfirmedEvents(probe);
    if (
        probe.stack.length !== stackBefore ||
        (probe.pendingChoices?.length ?? 0) > 0 ||
        probe.pendingTarget
    ) {
        return undefined;
    }
    checkStateBasedActions(probe);
    resolveCombatDamage(probe);
    // The same fail-closed rule after damage: a dies or damage trigger
    // ("when this dies, deal 1 damage…", persist) is still on the stack here,
    // and the board below would read without it.
    if (
        probe.stack.length !== stackBefore ||
        (probe.pendingChoices?.length ?? 0) > 0 ||
        probe.pendingTarget
    ) {
        return undefined;
    }
    const defenderId = getOpponentId(probe, probe.activePlayerId);
    const defender = probe.players.find((p) => p.id === defenderId);
    const attacking = probe.players.find((p) => p.id === probe.activePlayerId);
    if (!defender || !attacking) return undefined;
    const alive = (bf: typeof defender.battlefield) =>
        new Map(bf.map((c) => [c.id, JSON.stringify(c.counters ?? {})]));
    return {
        defenderAlive: alive(defender.battlefield),
        attackingSideAlive: alive(attacking.battlefield),
        defenderLife: defender.life,
        attackingLife: attacking.life,
        defenderPoison: defender.poisonCounters ?? 0,
        attackingPoison: attacking.poisonCounters ?? 0,
    };
}

/** `better` is at least as good as `worse` for the defender on every axis. */
function weaklyDominates(better: CombatOutcome, worse: CombatOutcome): boolean {
    for (const [id, counters] of worse.defenderAlive) {
        if (better.defenderAlive.get(id) !== counters) return false;
    }
    for (const [id, counters] of better.attackingSideAlive) {
        if (worse.attackingSideAlive.get(id) !== counters) return false;
    }
    return (
        better.defenderLife >= worse.defenderLife &&
        better.attackingLife <= worse.attackingLife &&
        better.defenderPoison <= worse.defenderPoison &&
        better.attackingPoison >= worse.attackingPoison
    );
}

/** The attackers `assignments` blocks with two or more creatures. */
function multiBlockedAttackers(
    assignments: readonly BlockAssignment[]
): Set<string> {
    const count = new Map<string, number>();
    for (const a of assignments) {
        count.set(a.attackerId, (count.get(a.attackerId) ?? 0) + 1);
    }
    return new Set([...count].filter(([, n]) => n >= 2).map(([id]) => id));
}

/**
 * `moves` without the declare-blockers moves a smaller legal declaration in
 * the same list dominates (see the header). Every other move — and every
 * declaration with no multi-blocked attacker — passes through untouched, in
 * order; on a list with no multi-block nothing is simulated.
 */
export function pruneDominatedBlocks(
    state: GameState,
    moves: readonly Move[]
): Move[] {
    const multi = moves.filter(
        (m): m is DeclareBlockersMove =>
            m.kind === "declare-blockers" &&
            multiBlockedAttackers(m.assignments).size > 0
    );
    if (multi.length === 0 || !state.combat) return [...moves];
    const legal = new Set(
        moves
            .filter(
                (m): m is DeclareBlockersMove => m.kind === "declare-blockers"
            )
            .map((m) => assignmentKey(m.assignments))
    );
    const outcomes = new Map<string, CombatOutcome | undefined>();
    const outcomeOf = (assignments: readonly BlockAssignment[]) => {
        const key = assignmentKey(assignments);
        if (!outcomes.has(key)) {
            outcomes.set(key, simulateBlocks(state, assignments));
        }
        return outcomes.get(key);
    };
    const dominated = new Set<Move>();
    for (const move of multi) {
        const full = outcomeOf(move.assignments);
        if (!full) continue;
        const multiAttackers = multiBlockedAttackers(move.assignments);
        const isDominated = move.assignments.some((dropped) => {
            if (!multiAttackers.has(dropped.attackerId)) return false;
            const smaller = move.assignments.filter((a) => a !== dropped);
            if (!legal.has(assignmentKey(smaller))) return false;
            const reduced = outcomeOf(smaller);
            return reduced !== undefined && weaklyDominates(reduced, full);
        });
        if (isDominated) dominated.add(move);
    }
    return moves.filter((m) => !dominated.has(m));
}
