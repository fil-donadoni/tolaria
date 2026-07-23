// The `priorFor` seam — choice-node ordering priors (PRD #1423, issue #1425).
//
// A choice node's candidate set is opened top-K by PRIOR (see
// `choiceCandidates.ts`). A prior is a soft ordering score in [0, 1]: it biases
// which candidate the tree opens first and adds a decaying bonus to UCB1 — it
// NEVER changes legality and is always washed out by accumulated reward.
//
// The seam is deliberately PLUGGABLE. v1 wired the heuristics the live bot
// already uses at a resolution choice (`src/lib/ai/brain.ts`, ADR 0016 minimal
// policy: "accept iff trivially affordable", "decline a life-for-unknown-card
// pay", "give up the least material") — kept below as `heuristicChoicePrior`.
// Issue #1433 swaps the DEFAULT provider to `dslChoicePrior`, which reads the
// DSL semantic layer (issue #1426, `OP_VALUERS`) CONTEXT-AWARE: a
// `search-library` find's own script value (what it actually does, not a
// flat per-kind guess), grounded against the REAL board
// (`contextAwareGroundingForChoice`, `candidateValue.ts` — issue #1433
// review finding 2), plus a real-board bonus for a removal-tagged find.
// `heuristicChoicePrior` remains the fallback for every OTHER choice kind —
// `may-pay` (issue #1433 review finding 3: its material is already summed by
// the candidate generator through the same worth functions, so a separate
// DSL leg only duplicates that read less robustly), `land-entry-tapped`,
// `draw-replacement` (a pure cost-payment yes/no with no underlying card
// material) — "heuristics may remain as fallback where no Op maps" (issue
// #1433's acceptance criterion). No call-site change: every consumer still
// goes through the single `priorFor` entry point below.

import type { CardInstanceState, GameState, PendingChoice } from "../state";
import { getOpponentId, getPlayer } from "../state";
import type { Move } from "../moves";
import {
    contextAwareGroundingForChoice,
    libraryTargetWorth,
    permanentWorth,
    scriptOpValueOf,
} from "./candidateValue";
import type { GroundingContext } from "./grounding";

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
    /** Summed latent worth of the material this candidate GAINS — the cards a
     *  library search finds (CR 701.19). 0 for a "fail to find" (CR 701.19c).
     *  The mirror of `materialGivenUp`: same rough point currency, opposite
     *  sign of intent. */
    materialGained?: number;
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

/** Prior of a `search-library` candidate that finds nothing of worth — and so
 *  of "fail to find" (CR 701.19c) itself. Every real find scores above it by
 *  its `materialGained`, which is exactly the ordering first-play urgency
 *  wants; the floor stays inside the band so failing to find is still reachable
 *  (a search that shuffles away a stacked library CAN be the right answer). */
const SEARCH_FIND_PRIOR_FLOOR = 0.3;

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
 *    paying life to bin an unknown card is speculative.
 *  - `search-library` (CR 701.19, fetchlands / tutors): the better the card
 *    found, the earlier that branch opens; failing to find (CR 701.19c) sits at
 *    the bottom of the band but is never pruned. */
export function heuristicChoicePrior(
    _state: GameState,
    choice: PendingChoice,
    candidate: PriorCandidate
): number {
    // CR 701.19 — a library search is not a yes/no answer: it is ranked purely
    // by what it FINDS, so it is scored before the accept/decline dispatch.
    if (choice.kind === "search-library") {
        return clampPrior(
            SEARCH_FIND_PRIOR_FLOOR +
                (candidate.hint?.materialGained ?? 0) / MATERIAL_PRIOR_SCALE
        );
    }

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

// ---------------------------------------------------------------------------
// v2 prior: OP_VALUERS, context-aware (issue #1433)
// ---------------------------------------------------------------------------

/** How much of the OPPONENT's biggest real battlefield threat's worth
 *  (`permanentWorth` — CR 613 effective P/T, live board state) a
 *  removal-tagged candidate's context-aware bonus reads. This is the ONE
 *  genuinely context-aware signal `dslChoicePrior` adds on top of a card's
 *  own (context-free) script value: a Terror found across the table from a
 *  Craw Wurm is a better find than the same Terror across an empty board —
 *  issue #1433's "removal targets the biggest threat" acceptance example.
 *  Deliberately narrow rather than re-deriving full live-amount grounding for
 *  a card that hasn't been cast yet (a library/hand card has no `$X`/`$paid`
 *  binding to read — see `grounding.ts`'s CONTEXT-AWARE doc comment). */
const REMOVAL_TARGET_BONUS_SCALE = 0.5;

/** The biggest real creature `perspectivePlayerId`'s OPPONENT controls right
 *  now, in `permanentWorth`'s currency. 0 with no creatures on the board (a
 *  removal-tagged candidate still scores its own latent worth; it just gets
 *  no urgency bump). */
function biggestOpposingThreat(
    state: GameState,
    perspectivePlayerId: string
): number {
    const opponent = getPlayer(
        state,
        getOpponentId(state, perspectivePlayerId)
    );
    let best = 0;
    for (const c of opponent.battlefield) {
        if (!c.types.includes("Creature")) continue;
        best = Math.max(best, permanentWorth(state, c));
    }
    return best;
}

/** Context-aware bump on top of a card's own script worth: a targeted board-
 *  removal script (`boardRemoval` + `targeted` tags, `opValuers.ts`) reads
 *  urgency from the REAL opposing board. Every other tag is unaffected.
 *  Reads the merged spell+ABILITY script (`scriptOpValueOf`, issue #1433
 *  review finding 1) so an ABILITY-only removal permanent (Icy Manipulator,
 *  Royal Assassin — no spell `effects[]` of their own) is not silently
 *  invisible to the tag check. */
function contextAwareRemovalBonus(
    state: GameState,
    perspectivePlayerId: string,
    card: CardInstanceState,
    ctx: GroundingContext
): number {
    const scripted = scriptOpValueOf(card, ctx);
    if (!scripted) return 0;
    const isTargetedRemoval =
        scripted.tags.includes("boardRemoval") &&
        scripted.tags.includes("targeted");
    if (!isTargetedRemoval) return 0;
    return (
        biggestOpposingThreat(state, perspectivePlayerId) *
        REMOVAL_TARGET_BONUS_SCALE
    );
}

/** `search-library` (CR 701.19): re-reads the REAL library (the choice is
 *  still live — the found cards haven't left it yet) for the candidate's
 *  named ids, and scores their summed `libraryTargetWorth` PLUS the
 *  context-aware removal bonus. Mirrors `heuristicChoicePrior`'s banding
 *  (`SEARCH_FIND_PRIOR_FLOOR` + worth / `MATERIAL_PRIOR_SCALE`) so the two
 *  providers stay on one calibrated scale. Grounds `libraryTargetWorth`'s
 *  noncreature script read with `contextAwareGroundingForChoice` (issue
 *  #1433 review finding 2) — the seam's first live, non-test caller of
 *  `contextAwareGrounding` — so a script whose magnitude depends on the
 *  REAL board (a `count`-scaled amount) prices differently than its
 *  context-free representative-1 floor. */
function dslSearchLibraryPrior(
    state: GameState,
    choice: PendingChoice,
    candidate: PriorCandidate
): number {
    if (candidate.move.kind !== "resolution-choice") return NEUTRAL_PRIOR;
    const ids = candidate.move.cardInstanceIds ?? [];
    if (ids.length === 0) {
        // CR 701.19c — "fail to find" carries no material of its own.
        return clampPrior(SEARCH_FIND_PRIOR_FLOOR);
    }
    const zoneOwner = getPlayer(state, choice.zoneOwnerId ?? choice.playerId);
    const ctx = contextAwareGroundingForChoice(state, choice.playerId);
    let worth = 0;
    for (const id of ids) {
        const card = zoneOwner.library.find((c) => c.id === id);
        if (!card) continue;
        worth +=
            libraryTargetWorth(state, choice.playerId, card, ctx) +
            contextAwareRemovalBonus(state, choice.playerId, card, ctx);
    }
    return clampPrior(SEARCH_FIND_PRIOR_FLOOR + worth / MATERIAL_PRIOR_SCALE);
}

/** v2 prior (issue #1433): reads `OP_VALUERS` context-aware for the choice
 *  kind whose candidates carry real card material with no cheaper structural
 *  hint to lean on (`search-library`'s finds — a library card's worth is
 *  genuinely the card's own script, not a cost paid). Falls back to the v1
 *  heuristic for every other kind, including `may-pay` (issue #1433 review
 *  finding 3): a `may-pay` accept's material is ALREADY summed by the
 *  candidate generator (`mayPayCandidates`, `choiceCandidates.ts`) through
 *  the SAME `permanentWorth`/`prospectiveCardWorth` this module would
 *  otherwise re-derive — a separate `dslMayPayPrior` leg would only
 *  recompute `hint.materialGivenUp` from scratch (and, unlike the hint,
 *  silently score an unresolvable instance id as "free" rather than falling
 *  back to the hint), so deleting it and reading `heuristicChoicePrior`'s
 *  `hint`-driven band directly is both simpler and strictly more robust.
 *  This IS the "heuristics may remain as fallback where no Op maps" the
 *  acceptance criteria call for, not a separate escape hatch. */
export const dslChoicePrior: ChoicePriorFn = (state, choice, candidate) => {
    switch (choice.kind) {
        case "search-library":
            return dslSearchLibraryPrior(state, choice, candidate);
        default:
            return heuristicChoicePrior(state, choice, candidate);
    }
};

let activePriorFn: ChoicePriorFn = dslChoicePrior;

/** Bumped on every `setChoicePriorFn`/`resetChoicePriorFn` call (issue
 *  #1520). `priorFor` reads the module-level `activePriorFn`, so it is only
 *  pure ACROSS TIME while nothing swaps the provider — true throughout a real
 *  search (the provider is never swapped mid-run) but not in a test that
 *  installs a stub between two calls over the same `(state, choice)`. A
 *  downstream cache (`choiceCandidates`' one-slot memo) reads this counter
 *  instead of assuming purity it can't verify. */
let priorFnGeneration = 0;

/** Install a different prior provider (a stub in a test, or a rollback to
 *  `heuristicChoicePrior`). Returns the previous provider so a caller can
 *  restore it. */
export function setChoicePriorFn(fn: ChoicePriorFn): ChoicePriorFn {
    const previous = activePriorFn;
    activePriorFn = fn;
    priorFnGeneration++;
    return previous;
}

/** Restore the default DSL-derived provider (`dslChoicePrior`, issue
 *  #1433). */
export function resetChoicePriorFn(): void {
    activePriorFn = dslChoicePrior;
    priorFnGeneration++;
}

/** Current prior-provider generation (issue #1520) — see `priorFnGeneration`. */
export function getChoicePriorGeneration(): number {
    return priorFnGeneration;
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
