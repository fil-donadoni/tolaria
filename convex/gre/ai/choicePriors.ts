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
import type { Color } from "../../cards/types";
import {
    contextAwareGroundingForChoice,
    graveyardRecursionAccessFor,
    libraryTargetWorth,
    permanentWorth,
    scriptOpValueOf,
} from "./candidateValue";
import type { GroundingContext } from "./grounding";
import { searchFindDestination } from "./searchDestination";
import { isNoOpChoiceAnswer } from "./dominance";
import { observedOpponentColors } from "./observedColors";

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
    /** Life this candidate pays (CR 119.4). 0 / undefined when it pays none. */
    lifePaid?: number;
    /** Summed latent worth of the material this candidate GAINS — the cards a
     *  library search finds (CR 701.23). 0 for a "fail to find" (CR 701.23b).
     *  The mirror of `materialGivenUp`: same rough point currency, opposite
     *  sign of intent. */
    materialGained?: number;
    /** Set when this candidate IS a genuine PROTECTION-colour-mode pick
     *  (issue #2306, narrowed by review finding 1) — an `option-pick` /
     *  `trigger-mode` candidate whose option carried
     *  `PendingChoice.options[].protectionColor`, threaded onto the
     *  candidate's hint by `optionPickCandidates`' `toCandidate`.
     *  Deliberately NOT every option carrying `EffectMode.color`: that field
     *  is a UI rendering tag shared by `protectionColorModes` (dodge a
     *  colour) AND `colorChoiceModes`/`COLOR_OPTIONS` ("become a colour" — a
     *  different, sometimes opposite, intent — out of scope per the issue).
     *  `"C"` (colourless, Giver of Runes) is a legal value but carries no
     *  colour-EVIDENCE opinion — `colorModePrior` scores it neutral rather
     *  than against the opponent's footprint. Absent for a non-colour modal
     *  option (Primal Clay's body modes) AND for a "become a colour" pick. */
    colorMode?: Color;
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
 *  of "fail to find" (CR 701.23b) itself. Every real find scores above it by
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

// ---------------------------------------------------------------------------
// Colour-mode prior (issue #2306) — "protection from the colour of your
// choice" and its siblings (`protectionColorModes`), scored against the
// opponent's OBSERVED colour footprint instead of the flat NEUTRAL_PRIOR
// every `option-pick` candidate fell to before (no branch existed for a
// `resolution-choice` move — `acceptOf` returns `undefined` for it, so every
// colour mode was indistinguishable at this seam).
// ---------------------------------------------------------------------------

/** How much of the prior BAND (`PRIOR_MIN`..`PRIOR_MAX`) a colour mode's
 *  SHARE of the opponent's total observed evidence claims. A colour with
 *  ZERO evidence sits at `PRIOR_MIN`; a colour that is the opponent's ENTIRE
 *  footprint sits at `PRIOR_MAX`; an even split across N shown colours sits
 *  proportionally between — never a hard filter, `choiceCandidates` still
 *  opens every mode (CHOICE_TOP_K comfortably covers 5-6 colour modes), so a
 *  low-share colour is still explorable and still choosable on real reward
 *  (the "lethal threat on the stack" case). */
function colorModePrior(
    state: GameState,
    choice: PendingChoice,
    candidate: PriorCandidate
): number {
    const color = candidate.hint?.colorMode;
    // No colour hint (a non-colour modal option) or colourless (CR 105.2a —
    // "protection from colourless" has no colour-EVIDENCE opinion, and must
    // stay pickable per the issue's acceptance criteria): neutral, same as
    // every other kind this seam has no opinion about.
    if (color === undefined || color === "C") return NEUTRAL_PRIOR;
    const opponentId = getOpponentId(state, choice.playerId);
    const evidence = observedOpponentColors(state, opponentId);
    const total = Object.values(evidence).reduce((sum, n) => sum + (n ?? 0), 0);
    // Edge case (acceptance criteria): no colour evidence at all — every mode
    // stays at the neutral baseline, any pick is acceptable, nothing stalls.
    if (total <= 0) return NEUTRAL_PRIOR;
    const share = (evidence[color] ?? 0) / total;
    return clampPrior(PRIOR_MIN + share * (PRIOR_MAX - PRIOR_MIN));
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
 *  - `search-library` (CR 701.23, fetchlands / tutors): the better the card
 *    found, the earlier that branch opens; failing to find (CR 701.23b) sits at
 *    the bottom of the band but is never pruned.
 *  - `option-pick` / `trigger-mode` colour modes (issue #2306): scored by
 *    `colorModePrior` against the opponent's observed colour footprint,
 *    checked BEFORE the accept/decline dispatch below — a `resolution-choice`
 *    move has no `.accept`, so `acceptOf` returns `undefined` and every
 *    colour mode would otherwise fall through to the flat NEUTRAL_PRIOR. */
export function heuristicChoicePrior(
    state: GameState,
    choice: PendingChoice,
    candidate: PriorCandidate
): number {
    // CR 701.23 — a library search is not a yes/no answer: it is ranked purely
    // by what it FINDS, so it is scored before the accept/decline dispatch.
    if (choice.kind === "search-library") {
        return clampPrior(
            SEARCH_FIND_PRIOR_FLOOR +
                (candidate.hint?.materialGained ?? 0) / MATERIAL_PRIOR_SCALE
        );
    }
    if (choice.kind === "option-pick" || choice.kind === "trigger-mode") {
        return colorModePrior(state, choice, candidate);
    }
    // CR 702.35a / 702.88a (issue #2983) — a reflexive cast window is not a
    // yes/no `accept` move either: its two halves are a `cast-spell` and a
    // dedicated decline Move, so `acceptOf` returns `undefined` for both and
    // every candidate would otherwise fall to the flat `NEUTRAL_PRIOR`,
    // leaving cast-vs-decline pure rollout noise.
    if (choice.kind === "madness-cast" || choice.kind === "rebound-cast") {
        return castWindowPrior(choice, candidate);
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

/** CR 702.35a / 702.88a (issue #2983) — prior for a reflexive CAST WINDOW
 *  candidate: the Madness window ("cast it for its madness cost or put it into
 *  your graveyard") and the Rebound window ("you may cast this card from exile
 *  without paying its mana cost").
 *
 *  Both open the CAST above the decline, because in both the decline is the
 *  branch that throws value away and the cast is the branch that spends
 *  something to keep it — that asymmetry is structural, not card knowledge:
 *
 *    * Madness: declining BINS the card (`declineMadness`, gre/madness.ts).
 *      The card is leaving the player's hand either way; the only question is
 *      whether it leaves to the graveyard or onto the stack. The cast is
 *      therefore favoured, but only mildly — the madness cost is real mana that
 *      could buy something else this turn.
 *    * Rebound: the recast is FREE (CR 702.88a) and the window never comes
 *      back — declining leaves the card exiled forever (CR 702.88c). A free
 *      spell is close to strictly better than no spell, so this opens higher
 *      than Madness's.
 *
 *  Neither is a filter. A cast the generator could not build never reaches this
 *  seam at all (it emits the decline alone), and a cast that IS built but plays
 *  badly loses on reward like any other branch — `PRIOR_MIN`/`PRIOR_MAX` keep
 *  the decline reachable in both directions. */
function castWindowPrior(
    choice: PendingChoice,
    candidate: PriorCandidate
): number {
    const isDecline =
        candidate.move.kind === "madness-decline" ||
        candidate.move.kind === "rebound-decline";
    if (choice.kind === "rebound-cast") {
        return isDecline ? 0.25 : 0.8;
    }
    return isDecline ? 0.4 : 0.65;
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

/** `search-library` (CR 701.23): re-reads the REAL library (the choice is
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
        // CR 701.23b — "fail to find" carries no material of its own.
        return clampPrior(SEARCH_FIND_PRIOR_FLOOR);
    }
    const zoneOwner = getPlayer(state, choice.zoneOwnerId ?? choice.playerId);
    const ctx = contextAwareGroundingForChoice(state, choice.playerId);
    // Issue #3041 — the SAME destination the candidate generator ranked and
    // admitted on (`choiceCandidates.ts`), derived by the same function, so the
    // ordering here can never disagree with the admission there.
    const destination = searchFindDestination(state, choice);
    const pricing = {
        destination,
        ...(destination === "graveyard"
            ? {
                  recursionAccess: graveyardRecursionAccessFor(
                      state,
                      zoneOwner.id
                  ),
              }
            : {}),
    };
    // The removal bonus prices "what this card would do WHEN CAST at the
    // opposing board", so it is exactly as destination-blind as the worth was:
    // a Swords to Plowshares buried in a graveyard kills nothing, and adding
    // the bonus on top of a near-floor graveyard worth would lift it back over
    // the reanimation target this fix exists to rank first.
    //
    // The gate is the GRAVEYARD destination specifically, NOT "every zone the
    // card could be cast from" — `"exile"` (Jester's Cap, Lobotomy) keeps the
    // bonus even though the card is not castable from there either. That is
    // deliberate and is the same narrowness the worth itself has: this fix
    // changes graveyard-bound pricing and leaves every other destination
    // byte-identical, so exile's own (separate) mis-pricing stays exactly as it
    // was rather than being half-corrected here on the way past.
    const buriedInGraveyard = destination === "graveyard";
    let worth = 0;
    for (const id of ids) {
        const card = zoneOwner.library.find((c) => c.id === id);
        if (!card) continue;
        worth += libraryTargetWorth(state, choice.playerId, card, ctx, pricing);
        if (!buriedInGraveyard) {
            worth += contextAwareRemovalBonus(
                state,
                choice.playerId,
                card,
                ctx
            );
        }
    }
    return clampPrior(SEARCH_FIND_PRIOR_FLOOR + worth / MATERIAL_PRIOR_SCALE);
}

// ---------------------------------------------------------------------------
// Degenerate-branch penalty (issue #1888 item 3)
// ---------------------------------------------------------------------------

/** Prior for a candidate PROVED to resolve to no change at all — an empty
 *  selection on an optional pick that nothing downstream reads (Chrome Mox
 *  resolving its imprint trigger having imprinted nothing). Pinned to the band
 *  floor rather than removed: this is still an ordering score, so the branch
 *  opens LAST and the search can still choose it on reward. Was `NEUTRAL_PRIOR`
 *  — indistinguishable from every answer that does something. */
const DEGENERATE_PRIOR = PRIOR_MIN;

/** Whether this candidate is the provably-does-nothing branch of the choice.
 *
 *  The probe is the `dominance.ts` one (issue #1887), applied one level down —
 *  the SAME exact-equality proof on a clone, not a second parallel prober. It
 *  is deliberately gated to the EMPTY-SELECTION shape before any clone is made:
 *  the probe costs a clone plus a whole-`GameState` deep compare, and priors are
 *  scored for every candidate at every choice ply, so it may only ever be paid
 *  for the at-most-one candidate per node that could plausibly be degenerate.
 *  A non-empty answer moves cards by construction and can never prove out.
 *
 *  That shape gate bounds the probe per VISIT; what bounds it per SEARCH is
 *  `dominance.ts`' per-decision memo (`beginDominanceDecision`, opened by
 *  `searchWithTrace`). This function runs at every in-tree choice-node visit of
 *  every iteration — without the memo the probe count would be O(iterations),
 *  the #1905 review-finding-3 regression (PR #1914 review finding 1). With it,
 *  each distinct choice identity is proved once per decision and every later
 *  visit reads the cached verdict. */
function isDegenerateChoiceCandidate(
    state: GameState,
    choice: PendingChoice,
    candidate: PriorCandidate
): boolean {
    const move = candidate.move;
    if (move.kind !== "resolution-choice") return false;
    if ((move.cardInstanceIds?.length ?? 0) > 0) return false;
    // CR 701.23b — "fail to find" always SHUFFLES, so a search-library empty
    // pick is never a no-op. Skipping the probe for that kind keeps the one
    // high-traffic choice node free of a clone it can only ever answer "no".
    if (choice.kind === "search-library") return false;
    return isNoOpChoiceAnswer(state, choice, move);
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
    if (isDegenerateChoiceCandidate(state, choice, candidate)) {
        return DEGENERATE_PRIOR;
    }
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
