import { collapseInterchangeableMoves } from "./ai/interchangeable";
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

/** The candidates the rollout's greedy pick probes out of `moves`, the moves
 *  a player may make at `state` (ADR 0184, issue #10473): all of them when there
 *  are `cap` or fewer; otherwise the decline, when the ply has one, and the
 *  best of the rest, `cap` in all.
 *
 *  "Best" is three keys, in order:
 *
 *  1. A REPEAT last. A candidate `collapseInterchangeableMoves` folds into
 *     another (issue #3593) — the same play on another copy of the same
 *     card: the second Swamp in hand, the second of two identical pump
 *     creatures, the other Bear attacking alone — does what its
 *     representative does, so its probe tells the pick nothing the
 *     representative's did not. It ranks after every
 *     candidate that does something else, whatever their kinds. Without this
 *     a kind rank fills the cut with copies of one play and drops the only
 *     other play on the ply (the blade's "rollout probe cut" entry).
 *  2. `rolloutMoveKindRank`.
 *  3. By lot, one `rng` draw per candidate: the kind rank cannot tell two
 *     candidates of one kind apart, and enumeration order would drop the
 *     same one — the last target in a graveyard, the last attacker on the
 *     battlefield — in every rollout. A draw drops a different one each time.
 *
 *  Draws only on a ply that is cut, from the rollout's own stream, so a search
 *  stays deterministic in its seed. Returned in enumeration order, so the
 *  pick's own tie-break reads the kept moves as it read the whole list.
 *  `moves` is not mutated. */
export function rolloutProbeCandidates(
    state: GameState,
    moves: readonly Move[],
    rng: () => number,
    cap: number = ROLLOUT_PROBE_CAP
): Move[] {
    if (moves.length <= cap) return moves.slice();
    const declineAt = moves.findIndex(isRolloutDecline);
    const representatives = new Set(collapseInterchangeableMoves(state, moves));
    const ranked: { at: number; repeat: boolean; rank: number; lot: number }[] =
        [];
    for (let i = 0; i < moves.length; i++) {
        if (i === declineAt) continue;
        ranked.push({
            at: i,
            repeat: !representatives.has(moves[i]),
            rank: rolloutMoveKindRank(moves[i]),
            lot: rng(),
        });
    }
    ranked.sort(
        (a, b) =>
            Number(a.repeat) - Number(b.repeat) ||
            b.rank - a.rank ||
            a.lot - b.lot
    );
    const keep = new Set<number>();
    if (declineAt >= 0) keep.add(declineAt);
    for (let i = 0; i < ranked.length && keep.size < cap; i++) {
        keep.add(ranked[i].at);
    }
    return moves.filter((_, i) => keep.has(i));
}
