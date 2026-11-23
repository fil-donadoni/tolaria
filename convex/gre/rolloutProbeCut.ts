import { getEffectivePower } from "./layers";
import type { Move } from "./moves";
import type { GameState } from "./state";

/** How many candidates the rollout's greedy pick probes on one ply (ADR 0184,
 *  amending ADR 0021; issue #10473): the ply's decline and the best
 *  `ROLLOUT_PROBE_CAP - 1` of the rest. A ply with this many candidates or
 *  fewer is probed whole. The owner's ruling of 2026-11-22
 *  (`docs/research/rollout-policy-cost.md` § 6): three, with four measured as
 *  the reference and two ruled out. */
export const ROLLOUT_PROBE_CAP = 3;

/** Whether `move` is the ply's DECLINE: `pass`, or — on a declaration ply,
 *  which offers no `pass` — the empty attack or block declaration. The decline
 *  is the one candidate the cut never drops: a mover that can only ever act
 *  is the action bias ADR 0015 removed, back by another door. */
export function isRolloutDecline(move: Move): boolean {
    if (move.kind === "pass") return true;
    if (move.kind === "declare-attackers") return move.attackerIds.length === 0;
    if (move.kind === "declare-blockers") return move.assignments.length === 0;
    return false;
}

/** The static rank the cut orders candidates by: what KIND of move it is,
 *  never a card (ADR 0102). Higher first; the rank measured in
 *  `docs/research/rollout-policy-cost.md` (`KIND_SCORE` of
 *  `docs/research/scripts/brain-bench/rollout-policies.mjs`), the decline at
 *  the bottom. */
export function rolloutMoveKindRank(move: Move): number {
    if (isRolloutDecline(move)) return 0;
    switch (move.kind) {
        case "play-land":
            return 6;
        case "cast-spell":
            return 5;
        case "activate-ability":
        case "activate-granted-ability":
        case "declare-attackers":
        case "declare-blockers":
            return 4;
        case "turn-face-up":
        case "foretell":
        case "plot":
        case "summon-companion":
            return 3;
        default:
            return 2;
    }
}

/** How wide a declaration is: its attackers, or its block assignments. */
function declarationWidth(move: Move): number {
    if (move.kind === "declare-attackers") return move.attackerIds.length;
    if (move.kind === "declare-blockers") return move.assignments.length;
    return 0;
}

/** The index of the WIDEST declaration of a declaration ply (the last one
 *  enumerated among equals: the power set ends on the full one), or -1 on any
 *  other ply. */
function widestDeclarationAt(moves: readonly Move[]): number {
    const kind = moves[0].kind;
    if (kind !== "declare-attackers" && kind !== "declare-blockers") return -1;
    let widestAt = 0;
    for (let i = 1; i < moves.length; i++) {
        if (declarationWidth(moves[i]) >= declarationWidth(moves[widestAt])) {
            widestAt = i;
        }
    }
    return widestAt;
}

/** The power a LONE attacker swings with — its effective power (CR 613.4),
 *  floored at zero as combat damage is (CR 510.1a) — or -1 for any move that
 *  is not an attack by exactly one creature. */
function loneAttackerPower(state: GameState, move: Move): number {
    if (move.kind !== "declare-attackers" || move.attackerIds.length !== 1) {
        return -1;
    }
    const id = move.attackerIds[0];
    for (let i = 0; i < state.players.length; i++) {
        const attacker = state.players[i].battlefield.find((c) => c.id === id);
        if (attacker) return Math.max(0, getEffectivePower(state, attacker));
    }
    return 0;
}

/** The candidates the rollout's greedy pick probes out of `moves`, the moves
 *  of one rollout ply in `state` (ADR 0184, issue #10473): all of them when
 *  there are `cap` or fewer; otherwise the decline, when the ply has one, and
 *  the best of the rest, `cap` in all.
 *
 *  "Best" is `rolloutMoveKindRank`, then, between equal kinds:
 *
 *  1. **The widest declaration of a declaration ply.** On a declaration ply
 *     every candidate is one kind, and the power set enumerates the single
 *     attackers first and the full attack last: in enumeration order alone
 *     no mover with two creatures ever probes attacking with both, and no
 *     defender a double block.
 *  2. **On an attack ply, the strongest lone attacker.** The other end of the
 *     same ply: one creature swings, the rest stay home to block. Without it
 *     the pumped creature's attack on its own leaves the playouts (a sorcery
 *     pump's race, the Bot-play sweep), and between nobody and everybody the
 *     pick declines. Read off the attacker's power, once per lone attacker.
 *  3. Enumeration order.
 *
 *  No draw, no table: the rollout's random stream is consumed as before the
 *  cut. Ranking a copy of a kept play last (`collapseInterchangeableMoves`)
 *  and a draw between equal kinds were both measured and left out (ADR 0184
 *  § Considered and measured). Returned in enumeration order, so the pick's
 *  own tie-break reads the kept moves as it read the whole list. `moves` is
 *  not mutated. */
export function rolloutProbeCandidates(
    moves: readonly Move[],
    state: GameState,
    cap: number = ROLLOUT_PROBE_CAP
): Move[] {
    if (moves.length <= cap) return moves.slice();
    const declineAt = moves.findIndex(isRolloutDecline);
    const widestAt = widestDeclarationAt(moves);
    const ranked: { at: number; rank: number; lone: number }[] = [];
    for (let i = 0; i < moves.length; i++) {
        if (i === declineAt) continue;
        ranked.push({
            at: i,
            rank: rolloutMoveKindRank(moves[i]),
            lone: loneAttackerPower(state, moves[i]),
        });
    }
    ranked.sort(
        (a, b) =>
            b.rank - a.rank ||
            Number(b.at === widestAt) - Number(a.at === widestAt) ||
            b.lone - a.lone ||
            a.at - b.at
    );
    const keep = new Set<number>();
    if (declineAt >= 0) keep.add(declineAt);
    for (let i = 0; i < ranked.length && keep.size < cap; i++) {
        keep.add(ranked[i].at);
    }
    return moves.filter((_, i) => keep.has(i));
}
