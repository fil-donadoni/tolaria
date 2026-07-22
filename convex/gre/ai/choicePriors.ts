// The `priorFor` seam — choice-node ordering priors (PRD #1423, issue #1425).
//
// A choice node's candidate set is opened top-K by PRIOR (see
// `choiceCandidates.ts`). A prior is a soft ordering score in [0, 1]: it biases
// which candidate the tree opens first and adds a decaying bonus to UCB1 — it
// NEVER changes legality and is always washed out by accumulated reward.
//
// The seam is deliberately PLUGGABLE. v1 wires the heuristics the live bot
// already uses at a resolution choice (`src/lib/ai/brain.ts`, ADR 0016 minimal
// policy: "accept iff trivially affordable", "decline a life-for-unknown-card
// pay", "give up the least material"). The DSL semantic layer (issue #1426,
// `OP_VALUERS`) swaps in behind the SAME seam later, with no call-site change —
// that is the whole point of routing every prior through one function.

import type { GameState, PendingChoice } from "../state";
import type { Move } from "../moves";

/** A candidate as seen by a prior function: its stable identity key, the move
 *  it would play, and the generator's structural hints (what the candidate
 *  costs / gives up). Priors read hints rather than re-deriving them so the
 *  generator stays the single place that knows a choice kind's cost shape. */
export type PriorCandidate = {
    key: string;
    move: Move;
    hint?: ChoiceCandidateHint;
};

/** Structural facts a candidate generator hands the prior seam. Every field is
 *  optional — a prior must degrade gracefully when a generator supplies none. */
export type ChoiceCandidateHint = {
    /** Summed board worth of the material this candidate gives up (sacrificed
     *  permanents / discarded cards). 0 when it gives up none. */
    materialGivenUp?: number;
    /** Life this candidate pays (CR 118.4). 0 / undefined when it pays none. */
    lifePaid?: number;
};

/** The pluggable prior seam: score a candidate at a choice node. Higher = try
 *  first. Pure — must never mutate `state`. */
export type ChoicePriorFn = (
    state: GameState,
    choice: PendingChoice,
    candidate: PriorCandidate
) => number;

/** Neutral prior for a candidate no heuristic has an opinion about. Every
 *  branch of `heuristicChoicePrior` is expressed as a deviation from it. */
export const NEUTRAL_PRIOR = 0.5;

/** Board worth (in the evaluator's rough point currency) at which giving up
 *  material drives an accept's prior to the floor. A 12/12 Phyrexian Dreadnought
 *  sits far above it, so "sacrifice the Dreadnought" opens LAST — the search
 *  still explores it and can still choose it on reward. */
const MATERIAL_PRIOR_SCALE = 400;

/** Life total fraction at which paying life stops looking cheap. */
const LIFE_PRIOR_SCALE = 20;

/** Prior floor / ceiling. A candidate is never pruned by its prior — pruning is
 *  the generator's job (`candidates()` is self-pruning) — so priors stay inside
 *  a band that keeps every candidate reachable. */
const PRIOR_MIN = 0.05;
const PRIOR_MAX = 0.95;

function clampPrior(v: number): number {
    return v < PRIOR_MIN ? PRIOR_MIN : v > PRIOR_MAX ? PRIOR_MAX : v;
}

function acceptOf(move: Move): boolean | undefined {
    return move.kind === "may-pay" ||
        move.kind === "land-entry" ||
        move.kind === "draw-replacement"
        ? move.accept
        : undefined;
}

/** v1 prior: the live bot's existing choice heuristics (`brain.ts`, ADR 0016),
 *  restated as an ORDERING score instead of a hard answer.
 *
 *  - `may-pay` (CR 117.3a / 118.4): a cost that gives up nothing but mana/small
 *    life is worth trying first; the more material an accept sacrifices or
 *    discards, the later it opens (brain.ts picks victims worst-first for the
 *    same reason). Declining is always the neutral baseline.
 *  - `land-entry-tapped` (CR 614.12 / ADR 0051, shock lands): paying a couple of
 *    life to enter untapped is the standard play — brain.ts pays iff affordable.
 *  - `draw-replacement` (CR 614 / ADR 0061, Zur's Weirding): brain.ts DECLINES —
 *    paying life to bin an unknown card is speculative. */
export function heuristicChoicePrior(
    _state: GameState,
    choice: PendingChoice,
    candidate: PriorCandidate
): number {
    const accept = acceptOf(candidate.move);
    if (accept === undefined) return NEUTRAL_PRIOR;

    const material = candidate.hint?.materialGivenUp ?? 0;
    const life = candidate.hint?.lifePaid ?? 0;
    const lifeDrag = life / LIFE_PRIOR_SCALE;

    switch (choice.kind) {
        case "may-pay": {
            if (!accept) return NEUTRAL_PRIOR;
            return clampPrior(
                0.75 - material / MATERIAL_PRIOR_SCALE - lifeDrag
            );
        }
        case "land-entry-tapped":
            // Entering untapped is the tempo default; the life is the only cost.
            return accept ? clampPrior(0.7 - lifeDrag) : 0.4;
        case "draw-replacement":
            // Denying an UNKNOWN card for life: speculative, opens second.
            return accept ? clampPrior(0.35 - lifeDrag) : 0.65;
        default:
            return NEUTRAL_PRIOR;
    }
}

let activePriorFn: ChoicePriorFn = heuristicChoicePrior;

/** Install a different prior provider (the DSL semantic layer, or a stub in a
 *  test). Returns the previous provider so a caller can restore it. */
export function setChoicePriorFn(fn: ChoicePriorFn): ChoicePriorFn {
    const previous = activePriorFn;
    activePriorFn = fn;
    return previous;
}

/** Restore the built-in heuristic provider. */
export function resetChoicePriorFn(): void {
    activePriorFn = heuristicChoicePrior;
}

/** Score a choice-node candidate through the currently-installed provider.
 *  The ONLY entry point search / candidate generation may call. */
export function priorFor(
    state: GameState,
    choice: PendingChoice,
    candidate: PriorCandidate
): number {
    return activePriorFn(state, choice, candidate);
}
