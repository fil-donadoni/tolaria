import type { Move } from "./moves";

/** How many candidates the rollout's greedy pick probes on one ply (ADR 0184,
 *  amending ADR 0021; issue #10473): the ply's decline and the best
 *  `ROLLOUT_PROBE_CAP - 1` of the rest. A ply with this many candidates or
 *  fewer is probed whole; an attack declaration ply keeps one probe per
 *  creature besides (`rolloutProbeCandidates`). The owner's ruling of 2026-11-22
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

/** The candidates the rollout's greedy pick probes out of `moves`, the moves
 *  of one rollout ply (ADR 0184, issue #10473): all of them when there are
 *  `cap` or fewer. Otherwise:
 *
 *  - **An attack declaration ply** keeps the empty attack, every creature
 *    attacking ALONE and the widest attack: nobody, each one, everybody. The
 *    kind rank says nothing here (every candidate is one kind) and the power
 *    set enumerates the last creature's lone attack first and the full attack
 *    last, so three probes in any fixed order miss either the full attack (a
 *    creature that must attack beside another) or the one creature worth
 *    sending while the rest stay home (a pumped or evasive attacker: the
 *    Bot-play sweep's pump race is decided there). One probe per creature
 *    plus two, where the power set doubles with each creature.
 *  - **Every other ply** keeps the decline, when the ply has one, and the
 *    best of the rest, `cap` in all. "Best" is `rolloutMoveKindRank`, then
 *    the WIDEST declaration of a block declaration ply (the block that uses
 *    every blocker, enumerated last), then enumeration order.
 *
 *  It reads the list and nothing else — no state, no draw, no table: the
 *  cut costs a pass over the ply's candidates, and the rollout's random
 *  stream is consumed as before it. Ranking a copy of a kept play last
 *  (`collapseInterchangeableMoves`), a draw between equal kinds and the
 *  strongest lone attacker alone were all measured and left out (ADR 0184
 *  § Considered and measured). Returned in enumeration order, so the pick's
 *  own tie-break reads the kept moves as it read the whole list. `moves` is
 *  not mutated. */
export function rolloutProbeCandidates(
    moves: readonly Move[],
    cap: number = ROLLOUT_PROBE_CAP
): Move[] {
    if (moves.length <= cap) return moves.slice();
    const declineAt = moves.findIndex(isRolloutDecline);
    const widestAt = widestDeclarationAt(moves);
    if (moves[0].kind === "declare-attackers") {
        return moves.filter(
            (move, i) => i === widestAt || declarationWidth(move) <= 1
        );
    }
    const ranked: { at: number; rank: number }[] = [];
    for (let i = 0; i < moves.length; i++) {
        if (i === declineAt) continue;
        ranked.push({ at: i, rank: rolloutMoveKindRank(moves[i]) });
    }
    ranked.sort(
        (a, b) =>
            b.rank - a.rank ||
            Number(b.at === widestAt) - Number(a.at === widestAt) ||
            a.at - b.at
    );
    const keep = new Set<number>();
    if (declineAt >= 0) keep.add(declineAt);
    for (let i = 0; i < ranked.length && keep.size < cap; i++) {
        keep.add(ranked[i].at);
    }
    return moves.filter((_, i) => keep.has(i));
}
