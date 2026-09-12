// ISMCTS search for the vs-AI Bot (ADR 0001, issue #112).
//
// `search(state, playerId, budget, seed)` upgrades the bot from greedy 1-ply
// (issue #111) to real lookahead: Single-Observer Information-Set Monte Carlo
// Tree Search with determinization. One persistent tree is grown over many
// iterations; each iteration re-determinizes the hidden information
// (`determinize`), descends the tree by UCB1 restricted to the moves legal in
// THAT world, expands one new move, runs a truncated rollout scored by the
// `evaluate` heuristic (issue #111), and backpropagates. After the budget is
// spent it returns the most-visited root move.
//
// Reuse, not reinvention (acceptance criterion): the search NEVER models the
// rules itself. Move legality comes from `enumerateMoves`, and a chosen move is
// applied through the SAME GRE resolution the server runs — spells go on the
// stack and resolve via `resolveTopOfStack`; priority/phase advancement mirrors
// the `passPriority` mutation (`advancePhase`, `drainAutoPasses`,
// `checkStateBasedActions`); combat damage is applied by the real phase machine
// (`advancePhase` → `performPhaseEntry`) once both players pass through the
// damage step. The bot still plays only through existing mutations; the server
// stays the sole authority (CR 720).
//
// Determinism: every random choice draws from a single seeded stream
// (`makeRng(seed)`), so `search` with a fixed seed and an iteration budget is
// reproducible — which is what the tests pin. A wall-clock `timeMs` budget is
// available for responsiveness in production but makes the result clock-
// dependent; tests use the iteration budget.
//
// Adversarial backup: `evaluate` is scored once at the leaf from the bot's
// perspective and mapped to a reward in [0, 1] (`reward`). Each tree edge stores
// the reward from the perspective of the player who MOVED on it (bot keeps `r`,
// the opponent keeps `1 − r`), so UCB1's "maximize" rule makes every node act in
// its own mover's interest — the opponent minimizes the bot's eval, as a real
// adversary would.
//
// Material survives a decided position (issue #138): the reward is BANDED so a
// won/lost outcome dominates ordering while the surviving material still
// discriminates within the band, and each edge ALSO accumulates the raw,
// saturation-proof `materialMargin`. Final root selection (`selectRootMove`)
// picks the most-visited move but, among candidates UCB1 left within a few
// percent of each other in visits and equal in win-probability, prefers the one
// that keeps the most material — so a free chump attack never ties "no attacks"
// on rollout noise.

import type {
    CardInstanceState,
    GameState,
    PendingChoice,
    StackItem,
} from "./state";
import {
    moveCard,
    removeFromZone,
    resolveTopOfStack,
    emitPermanentEntered,
    emitSpellCastEvent,
    processPendingActionTriggers,
    getOpponentId,
    tapPermanent,
} from "./state";
import type { Color } from "../cards/types";
import { observedOpponentColors } from "./ai/observedColors";
import { checkStateBasedActions } from "./sba";
import {
    advancePhase,
    drainAutoPasses,
    emitAttackersDeclaredEvents,
    emitBlockersConfirmedEvents,
    applyAllCombatDamage,
    buildAutoDamageAssignments,
    finalizeDrawReplacementPay,
    isSorceryTimingFor,
    wasCastOffSorceryTiming,
} from "./phases";
import { cloneGameState } from "./clone";
import { predictCombatOutcome } from "./dangerClock";
import { getEffectiveBlockGraph, recordBlockedAttackers } from "./banding";
import {
    markAttacking,
    markDeclaredBlockers,
    recordAttackerDeclared,
} from "./combat";
import { enumerateMoves, type Move } from "./moves";
// issue #2283 — the shared origin classification + raised-selection commit.
import {
    applyRaisedTargetFinalization,
    pendingTargetOrigin,
    raisedPendingTargetOwedBy,
} from "./pendingTargetOrigin";
import {
    manaTapSacrificesSource,
    manaValue,
    mayBeSacrificedForMana,
} from "./constants";
import { getInstanceManaCost } from "../cards";
import { morphTurnUpPaymentPlan } from "./morph";
import { applyCastModeCharacteristics } from "./castMode";
import { turnFaceUp } from "./faceDown";
import {
    applyActivationCostsForSearch,
    applyAdditionalCostLegForSearch,
    applyKickerPermanentLegForSearch,
    applyRetraceCastForSearch,
    applyDelveExileForSearch,
    applyCastCostPicksForSearch,
} from "./applyMove";
import { markGraveyardPermanentCastUsed } from "./rules";
import { additionalCostPaymentSnapshot } from "./kicker";
import {
    castSourceForSearch,
    findCastSourceCard,
    graveyardCastMechanism,
    graveyardCastStackFlags,
    reboundCastStackFlags,
} from "./castCost";
// CR 702.35a / 702.88a-c (issue #2983) — the reflexive cast windows' own pure
// resolvers, so the in-tree accept and decline are the EXACT functions the
// `announceCast` / `submitMadnessDecline` / `submitReboundDecline` mutations
// drive rather than a sandbox restatement of them.
import { consumeMadnessCastChoice, declineMadness } from "./madness";
import { consumeReboundCastChoice, declineRebound } from "./rebound";
// CR 602.2a / 602.5 (issue #1920) — the shared shape of an activated ability's
// stack item and the shared activation tally, so the search's push is the same
// object the mutation path commits.
import {
    buildActivatedAbilityStackItem,
    recordActivation,
} from "./activationCommit";
import { resolvePlayLandSourceZone } from "./playLand";
import { stampModalBackFaceForPlay } from "./transform";
import {
    evaluate,
    evaluateBreakdown,
    declaredBlockDelta,
    declaredCombatDelta,
    lethalUnblockedDelta,
    hasCastableInstant,
    hasCastableFlashPermanent,
    materialMargin,
    type PositionBreakdown,
} from "./evaluate";
import { describeMove } from "./describeMove";
import { determinize } from "./determinize";
import type { DeckKnowledgeBySeat } from "./deckKnowledge";
import { makeRng } from "./rng";
import { hasCastableInstantHint } from "./heldInteraction";
import {
    isCreature,
    hasManaAbility,
    manaGateBattlefields,
    hasInstantSpeed,
} from "./constants";
import { tryGetDefinition } from "../cards";
import { getManaSubstitutions } from "./state";
import { buildAutoTapSources, solveSmartAutoTap } from "./autoTap";
import { COMPANION_SUMMON_COST } from "./companion";
// Choice-node spine (PRD #1423, issue #1425).
import {
    choiceCandidates,
    selectOpeningCandidate,
    type ChoiceCandidate,
} from "./ai/choiceCandidates";
import {
    MAX_CHOICE_BRANCH_WORK,
    MAX_CHOICE_DEPTH,
    definitionChoiceDepth,
} from "./ai/choiceDepth";
import { misdirectedTargetCount } from "./ai/beneficence";
import {
    beginDominanceDecision,
    endDominanceDecision,
    isSelfConfinedFutileMove,
} from "./ai/dominance";
// Activation-timing discipline (issue #1890): the single authority on whether an
// activation could just as well happen in a later, better-informed window.
import {
    effectiveAbilityOf,
    effectiveActivatedAbilityEntryOf,
    isDeferrableStackAbility,
    isTransientOnlyAbility,
    spendsStandingPermanent,
} from "./ai/abilityTiming";
// Root-decision telemetry (issue #1893, map #1892) — off by default.
import {
    getRootDecisionSink,
    type RootDecisionMechanism,
    type SearchStats,
    type SearchStopReason,
} from "./ai/decisionTelemetry";
// Ladder A/B config seam (issue #1924) — null in live play, so every knob
// below stays at its production default outside a ladder run.
import {
    EMPTY_DISABLED_RULES,
    getSearchVariant,
    resolveActionPriors,
    resolveDisabledRootRules,
    resolveEvalWeights,
    resolveOpponentModel,
    type ActionPriorConfig,
    type OpponentModel,
} from "./ai/searchVariant";
import {
    applyLandEntrySubmit,
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
    applyRandomRevealAck,
} from "./pendingChoiceSubmit";
// Explicit calibration surface (issue #2683) — `runSearchWithTrace` resolves
// the active vector ONCE (`resolveEvalWeights(getSearchVariant())`) and
// threads it down as an explicit parameter through the whole search; nothing
// below this file's entry point reads `getSearchVariant()` for a weight.
import {
    DEFAULT_EVAL_WEIGHTS,
    type EvalWeights,
    rewardPerMarginPoint,
    terminalMagnitude,
} from "./ai/evalWeights";

/** Search budget: stop at `iterations` tree iterations, or once `timeMs` of
 *  wall-clock has elapsed (whichever comes first). At least one must be set —
 *  `DEFAULT_BUDGET` provides both. `now` is injectable for deterministic tests
 *  of the time bound.
 *
 *  `minIterations` (issue #2685) turns on the EARLY-STOP rule: once this many
 *  iterations have completed, the loop stops before `iterations`/`timeMs` when
 *  the root pick is provably settled (see `rootDecisionSettled`). Defaults to
 *  0 — the rule is always active but only ever fires when the visit/reward
 *  counts say the pick cannot change, so a budget that omits it (the blade
 *  suite, every existing test) keeps running to `iterations` on any contested
 *  decision and stops early only on an already-decided one. The rule reads only
 *  visit/reward counts, never the clock, so a fixed-iterations test stays
 *  bit-reproducible. */
export type SearchBudget = {
    iterations?: number;
    timeMs?: number;
    now?: () => number;
    minIterations?: number;
};

/** The single shipped difficulty preset for this slice (CR-agnostic tuning).
 *  A lobby selector that exposes multiple presets is a separate slice (#114). */
// ADR 0015: the turn-boundary rollout plays a full round per playout (longer
// than the old 8-ply horizon), so the wall-clock ceiling is raised to ~1.5s to
// let the 400-iteration budget actually complete. Still well under human
// decision pace, so the opponent stays fluid.
export const DEFAULT_BUDGET: SearchBudget = { iterations: 400, timeMs: 1500 };

// `weights.ucbC` (issue #2683, was the module const `UCB_C`): the UCB1
// exploration constant. `weights.reactivePriorC` (was `REACTIVE_PRIOR_C`):
// weight of the soft reactive prior added to UCB1 (ADR 0021 slice 3, issue
// #223), sized to meaningfully bias EXPLORING an instant-speed response in
// its window when the edge is barely visited, yet — because it decays as
// 1/(1+visits) — to fall below the UCB1 exploration term within a handful of
// visits, so it can never dominate the accumulated reward.
/** Rollout horizon, in EXTRA full bot turns beyond the first (ADR 0015). The
 *  rollout always plays forward to the start of the bot's NEXT turn — a complete
 *  round in which BOTH players had symmetric opportunity to act — then this many
 *  additional bot-turn-starts before scoring. `0` = score at the bot's next turn
 *  start (the baseline). A turn-clock horizon, unlike a fixed ply count, judges
 *  every candidate after the same game-clock progress, removing the own-turn
 *  action bias a ply horizon gives "do something now" over "pass". */
const ROLLOUT_EXTRA_BOT_TURNS = 0;
/** Hard cap on turn-boundary crossings inside a single rollout — guards against
 *  a stall loop (a board that never advances the active player back to the bot,
 *  e.g. mutual passing across empty turns until someone decks) and bounds the
 *  rollout length when the bot's turn never recurs. */
const MAX_ROLLOUT_TURNS = 6;
/** Backstop ply cap inside a rollout, on top of the turn cap, so a single
 *  pathological turn with a runaway move list can't spin forever. */
const MAX_ROLLOUT_PLIES = 300;
/** Hard cap on plies applied while descending the tree in one iteration —
 *  guards against a pathological no-progress cycle (e.g. mutual passing across
 *  empty turns until someone decks). */
const MAX_TREE_DEPTH = 40;
// `weights.rolloutEpsilon` (issue #2683, was `ROLLOUT_EPSILON`): chance the
// rollout policy plays a uniform-random move instead of the immediate-best
// one — keeps playouts from collapsing to a single line.
//
// `weights.rolloutEpsilonReactive` (was `ROLLOUT_EPSILON_REACTIVE`): lower
// exploration epsilon on a REACTIVE COMBAT line (ADR 0021, issue #229): a
// declared combat where a player holds castable interaction. The multi-step
// hold→attack→block→respond ambush is a narrow, response-conditioned line —
// at the flat 0.25 epsilon a random move (skipping the in-response pump, or a
// nonsense block) dilutes it to a minority playout, so its high-variance mean
// stays just below the low-variance sorcery-speed dump. Dropping the random
// rate when interaction is live lets the sane reactive line (the
// `selectRolloutMove` default policy now casts the pump in its window) play
// out reliably, so the held line's real value surfaces. Still > 0, so the
// tree is not collapsed to a single line.
//
// `weights.rolloutGuardrailPenalty` (was `ROLLOUT_GUARDRAIL_PENALTY`): soft
// penalty subtracted from a discouraged move's reward in the rollout default
// policy (ADR 0020 §4). Small — a fraction of the reward band — so it only
// breaks ties / suppresses no-payoff lines: any move with real value (a
// lethal dork attack, a must-cast instant) clears it easily. Pure policy
// bias; the move stays legal and explorable by the tree.
//
// `weights.terminalBand` (was `TERMINAL_BAND`): width of the reward band
// reserved, at each terminal extreme, for the surviving material margin
// (issue #138). A won position always outranks every non-won one and a lost
// one ranks below all, but WITHIN the band the material still discriminates:
// a win that threw a creature away for nothing scores below a win that kept
// it, so a free chump attack never ties "no attacks". A flat `return 1` for
// every win erased that signal.
//
// `weights.materialFull` (was `MATERIAL_FULL`): material margin (in
// `evaluate` units) that fills a half-band. Kept LINEAR up to this cap — not
// `tanh` — so a single creature's worth of material shifts the reward by a
// fixed, decision-relevant amount regardless of how far ahead the bot already
// is. `tanh` saturates near a decided position and was the root cause: the
// creature delta vanished into the flat tail. Forge-scale (ADR 0018): a
// vanilla 2/2 is worth ~170, so this cap (~3 creatures) keeps one creature's
// worth a meaningful, non-saturating fraction of the band.

/** Reward gained per `evaluate` margin point in the OPEN band of
 *  `rewardFromValue` — its linear slope. Kept exported at the PRODUCTION
 *  vector's value (issue #2683: `rewardPerMarginPoint(DEFAULT_EVAL_WEIGHTS)`,
 *  byte-identical to the old `(1 − 2·TERMINAL_BAND) / (2·MATERIAL_FULL)`) for
 *  the decision telemetry (issue #1893, map #1892 evidence 1): dividing a
 *  reward gap by this converts it back into margin points, the currency
 *  `evaluate` and the map reason in. A non-default weights vector's own slope
 *  is `rewardPerMarginPoint(weights)`, computed fresh where it matters
 *  (`rewardFromValue` below). */
export const REWARD_PER_MARGIN_POINT =
    rewardPerMarginPoint(DEFAULT_EVAL_WEIGHTS);

/** Map a material margin to [-1, 1], linear (constant slope) until it saturates
 *  at ±`weights.materialFull`. Linear is deliberate: the discriminating
 *  quantity is a fixed material delta, which must move the reward by the same
 *  amount whether the absolute margin is small or large. */
function materialSignal(margin: number, weights: EvalWeights): number {
    const x = margin / weights.materialFull;
    return x < -1 ? -1 : x > 1 ? 1 : x;
}

/** Calibrated margin → win-probability slope (issue #1929, map #1892 step 3):
 *  P(win | margin m) = σ(CALIBRATED_REWARD_K · m), fitted on the ladder
 *  self-play corpus by `bun scripts/fit-reward-mapping.ts` (one-parameter
 *  logistic MLE, intercept pinned to 0 by game symmetry).
 *
 *  MEASURED 2026-08-25 on the two decision-tier corpora #2747 unblocked —
 *  the `--orientations 1` null run (340 games, 7 739 samples, k = 9.188e-4)
 *  and the `placebo` run (680 games, 15 569 samples, k = 1.039e-3), pooled:
 *  1 020 games, 23 308 samples. Two independent corpora agreeing to 12% is
 *  the reproducibility check; the value below is the pooled fit.
 *
 *  WHAT IT SAYS, and why it does NOT become the default (findings:
 *  docs/research/reward-calibration.md): 75% win probability sits at ~1 100
 *  margin points — six vanilla 2/2s — where the production linear clip
 *  declares certainty at 500. The honest curve is FLATTER than the guess it
 *  would replace, because the eval margin barely predicts the winner at all
 *  (log-loss 0.665 against 0.693 for a coin flip; ~0.692 — no information —
 *  before turn 8). Swapping it in therefore WIDENS the indifference band at
 *  margin 0 from 100 points to 400 and cuts the mean reward slope over real
 *  positions to 0.33×, which is the #1893 pathology amplified, not fixed.
 *  MEASURED on two matched legs of the decision-telemetry corpus (identical
 *  seeds/decks/budget, 1 162 vs 1 139 root decisions): the share of picks the
 *  SEARCH decides falls 16.7% → 5.9%, and 93.2% of decisions reach the
 *  selection rules as a tie to break, up from 81.6%.
 *
 *  Kept behind the variant flag as the measurement it is: the constant is
 *  refitted by the same script once `evaluate` itself carries more signal
 *  (#2686 eval fidelity, then the fitted eval of map step 5), which is where
 *  the calibration becomes worth landing.
 *
 *  Exported at the production value (issue #2683: `DEFAULT_EVAL_WEIGHTS`'s
 *  `calibratedRewardK`) so `scripts/fit-reward-mapping.ts` and existing tests
 *  keep a plain top-level constant; `calibratedSignal` below reads
 *  `weights.calibratedRewardK` directly so a non-default vector's own fit is
 *  honoured. */
export const CALIBRATED_REWARD_K = DEFAULT_EVAL_WEIGHTS.calibratedRewardK;

/** Calibrated replacement for `materialSignal` in the OPEN band: the fitted
 *  win probability rescaled to [-1, 1]. The terminal bands keep the linear
 *  material tie-break — outcome dominance and the within-band surviving-
 *  material discrimination (issue #138) are properties the calibration must
 *  not disturb; what it replaces is the mid-game margin RESOLUTION. */
function calibratedSignal(margin: number, weights: EvalWeights): number {
    return 2 / (1 + Math.exp(-weights.calibratedRewardK * margin)) - 1;
}

export type Edge = {
    move: Move;
    /** The tree key this edge is stored under (its key in `Node.children`).
     *  At a choice node this is the candidate's STABLE IDENTITY, so the move
     *  above — captured in the determinization that OPENED the edge — can be
     *  re-resolved against any later world (`rootMoveFor`, `selectRootMove`).
     *  At a priority node it is the structural `moveKey` of `move` itself. */
    key: string;
    /** Player who chose this move (perspective the rewards are stored in). */
    mover: string;
    node: Node;
    visits: number;
    totalReward: number;
    /** Sum of leaf material margins (mover perspective), accumulated alongside
     *  `totalReward` (issue #138). Saturation-proof, so it breaks ties between
     *  candidates whose win/loss outcome is identical but whose surviving
     *  material differs. */
    totalMargin: number;
    /** Times this move was AVAILABLE during selection (ISMCTS availability). */
    avail: number;
};

export type Node = {
    children: Map<string, Edge>;
    /** RAW `policyValue` per tree key, memoized for this node (issue #2684).
     *
     *  Only ever populated when a variant turns `actionPriors` on — the field
     *  stays `undefined` in production, so the node costs exactly what it did
     *  before. The cache is what makes the knob affordable: `policyValue`
     *  clones the world and runs a full `evaluate()` per candidate, and a main
     *  phase offers 75–90 of them, so recomputing at every visit of every node
     *  would cost far more than the search it improves. Keyed by tree key, so
     *  a later determinization contributing a key this node has not seen pays
     *  for THAT key only. Bot-perspective, like `policyValue` itself; the
     *  mover-side flip happens at normalisation. */
    policyValues?: Map<string, number>;
};

function newNode(): Node {
    return { children: new Map() };
}

/** Stable structural key for a move (moves are plain data). Exported since
 *  issue #3400: a Verdict names its candidates by this key, so the record in
 *  git stays a key plus a description and the moves themselves are
 *  re-enumerated from the position at fit time. */
export function moveKey(move: Move): string {
    return JSON.stringify(move);
}

// ---------------------------------------------------------------------------
// Whose decision is it, and reward shaping
// ---------------------------------------------------------------------------

/** The player who owes a decision in `state`, or null when none does (game
 *  over, or a mid-resolution continuation this move model doesn't enumerate).
 *  Mirrors `enumerateMoves`' gating so the returned id always yields a non-empty
 *  move list at an actionable window. Exported so the pre-search gate
 *  (`shouldThink`, issue #113) reuses the EXACT same window definition. */
export function decidingPlayer(state: GameState): string | null {
    if (state.gameOver) return null;

    if (state.phase === "MULLIGAN") {
        const m = state.mulligan;
        if (m && !m.bottoming) return m.declaringPlayerId;
        return null;
    }

    const combat = state.combat;
    if (state.phase === "DECLARE_ATTACKERS" && combat && !combat.confirmed) {
        return state.activePlayerId;
    }
    if (
        state.phase === "DECLARE_BLOCKERS" &&
        combat &&
        combat.confirmed &&
        !combat.blockersConfirmed
    ) {
        return getOpponentId(state, state.activePlayerId);
    }

    if (
        state.pendingCast ||
        state.pendingActivation ||
        state.pendingCompanionPay
    ) {
        return null;
    }

    // CR 603.3d / 115.7 / 707.10b (issue #2283) — an ENGINE-RAISED target
    // selection is a real decision node: its owner picks the trigger's /
    // retarget's targets and `enumerateMoves` surfaces the submissions. An
    // ANNOUNCED one (`"cast"` / `"ability"`) stays a non-decision — the
    // executor drives it atomically inside one announcement sequence. Mirrors
    // `enumerateMoves` exactly, including the choice-outranks-target
    // precedence (CR 608.2 / 101.4, `computeExpectedInput`), so the two
    // surfaces can never disagree about whether a window is decidable.
    if (state.pendingTarget) {
        if (state.pendingChoices?.length) return null;
        return pendingTargetOrigin(state.pendingTarget.kind) === "raised"
            ? state.pendingTarget.playerId
            : null;
    }

    // A live mid-resolution choice is an in-tree DECISION NODE (PRD #1423,
    // issue #1425): its chooser — the head of the engine-ordered queue, APNAP
    // already applied at enqueue (CR 101.4) — owes the decision. Opponent
    // resolution-choices are ordinary adversarial nodes over the determinized
    // world (no chance nodes). A kind with no registered candidate generator
    // yields no candidates, and the window stays a non-decision exactly as
    // before — this mirrors `enumerateMoves` so the two can never disagree.
    const headChoice = state.pendingChoices?.[0];
    if (headChoice) {
        return choiceCandidates(state, headChoice).length > 0
            ? headChoice.playerId
            : null;
    }

    return state.priorityPlayerId;
}

/** Map an `evaluate` score (bot perspective) to a reward in [0, 1].
 *
 *  Three monotone bands keep the win/loss OUTCOME dominant while never erasing
 *  material (issue #138):
 *    * won   → [1 − BAND, 1], higher with more surviving material;
 *    * lost  → [0, BAND];
 *    * open  → (BAND, 1 − BAND), material-driven.
 *  The material map is linear (see `materialSignal`), so losing a creature for
 *  nothing costs the same slice of reward whether the bot is even or far ahead —
 *  the suicidal-attack signal no longer saturates away.
 *
 *  `weights` (issue #2683) defaults to `DEFAULT_EVAL_WEIGHTS` for callers
 *  outside the search (tests, other modules); `scoreLeaf` below always passes
 *  the search's own resolved vector explicitly.
 *
 *  There is NO per-combo term here (ADR 0102, issue #3138): the deleted
 *  `comboAnnotations.ts` boost was a function of the STATE, identical before
 *  and after the activation it was meant to encourage, and at its top stage it
 *  saturated the material signal — so more search converged AWAY from the
 *  combo (2/5 → 1/5 → 0/5 at 400/1200/4000 iterations). The replacement is the
 *  CR 732 loop shortcut offered as a Move (PRD #2687), whose payoff the
 *  evaluation sees one ply later with no card knowledge at all. */
export function reward(
    state: GameState,
    botId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    return rewardFromValue(evaluate(state, botId, weights), weights);
}

/** The reward-band shaping applied to an `evaluate` value, factored out of
 *  `reward` so the rollout default policy can shape a combat-augmented value
 *  (ADR 0021 slice 2) through the IDENTICAL band — terminal extremes reserve
 *  `weights.terminalBand` for the surviving material margin, the open middle
 *  is linear in the material signal. `v` must already have been produced by
 *  `evaluate(.., weights)` with the SAME vector — the `±weights.winScore`
 *  offset below undoes exactly the offset `evaluate` applied.
 *
 *  Exported for ONE assertion (issue #3138): `reward(state) ===
 *  rewardFromValue(evaluate(state))`, i.e. the reward carries no addend the
 *  band map cannot account for. That is exactly the invariant the deleted
 *  `comboAnnotations.ts` layer violated — it added a state-dependent bonus on
 *  top of the band — and ADR 0102 rules out ever adding another. */
export function rewardFromValue(v: number, weights: EvalWeights): number {
    const terminal = terminalMagnitude(weights);
    if (v >= terminal) {
        const material =
            0.5 + 0.5 * materialSignal(v - weights.winScore, weights);
        return 1 - weights.terminalBand + weights.terminalBand * material;
    }
    if (v <= -terminal) {
        const material =
            0.5 + 0.5 * materialSignal(v + weights.winScore, weights);
        return weights.terminalBand * material;
    }
    // Open band: variant-selectable margin mapping (issue #1929) — production
    // default is the linear clip; the ladder A/Bs the calibrated logistic.
    const signal =
        getSearchVariant()?.rewardMapping === "calibrated"
            ? calibratedSignal(v, weights)
            : materialSignal(v, weights);
    const material = 0.5 + 0.5 * signal;
    return weights.terminalBand + (1 - 2 * weights.terminalBand) * material;
}

// ---------------------------------------------------------------------------
// Search-side move application (reuses the real GRE resolution primitives)
// ---------------------------------------------------------------------------

function findCreature(
    state: GameState,
    id: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const c = p.battlefield.find((x) => x.id === id);
        if (c) return c;
    }
    return undefined;
}

/** Coarse mana model (same as the greedy sandbox, issue #111): mark the planned
 *  sources tapped so spent mana is reflected in the leaf position.
 *
 *  Issue #2420 — an `abilityId`-carrying entry ACTIVATES the source's own
 *  non-tap mana ability (Urza's `tapOtherFilter`, Farrelite Priest's pure
 *  `cost.mana`) rather than tapping the source: `cardInstanceId` itself is
 *  never tapped by this payment (CR 602.1); only the permanent(s) named in
 *  `tapOtherIds`, if any, are. Mirrors the identical fix in `applyMove.ts`'s
 *  own `applyTapPlan` — kept as a separate copy (issue #111's "same as the
 *  greedy sandbox" note above), so both need the same fix. */
function applyTapPlan(
    state: GameState,
    playerId: string,
    tapPlan: {
        cardInstanceId: string;
        abilityId?: string;
        manaChoiceIndex?: number;
        tapOtherIds?: string[];
    }[]
): void {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;
    // CR 605.1a / 118.3 (Breach probe) — a mana ability paid by SACRIFICING
    // its source (Black Lotus, Basal Thrull, the Mirage sac-lands, Lion's Eye
    // Diamond) puts the permanent in the GRAVEYARD; `tapSourceIntoPayment`
    // (`convex/game.ts`) does exactly that on the real path. This model used
    // to only set `isTapped`, so inside the tree the source sat tapped on the
    // battlefield forever and never reached the graveyard — which made every
    // graveyard-as-resource line structurally invisible to the search at ANY
    // depth, not merely beyond its horizon: a Black Lotus could never become
    // Underworld Breach escape fodder, so the Lotus loop that powers storm
    // could not be assembled. Guarded by the cheap printed-definition
    // prefilter, so an ordinary board of lands and {T} rocks pays one cached
    // lookup per tap and nothing else.
    const sacrificed: string[] = [];
    for (const tap of tapPlan) {
        if (tap.abilityId) {
            for (const otherId of tap.tapOtherIds ?? []) {
                const other = player.battlefield.find((c) => c.id === otherId);
                if (other) other.isTapped = true;
            }
            continue;
        }
        const src = player.battlefield.find((c) => c.id === tap.cardInstanceId);
        if (!src) continue;
        if (
            mayBeSacrificedForMana(src) &&
            manaTapSacrificesSource(
                src,
                player.id,
                manaGateBattlefields(state),
                tap.manaChoiceIndex
            )
        ) {
            sacrificed.push(src.id);
            continue;
        }
        src.isTapped = true;
    }
    // Moved after the loop so a plan naming the same source twice cannot make
    // the second lookup miss (the planner never emits one — see
    // `manaConverterParity.bot.test.ts` invariant B — but this model must not
    // depend on that).
    for (const id of sacrificed) {
        moveCard(player, id, "battlefield", "graveyard");
    }
}

/** Mirror the `passPriority` mutation: advance the pass cycle, resolving the
 *  stack or advancing the phase when both players have passed, then drain
 *  auto-passes and apply SBA. `passerId` is the player passing now. */
function passInSearch(state: GameState, passerId: string): void {
    // A pass during the combat-damage step first resolves the turn-based
    // combat damage (CR 510.2) — the real engine applies it via the
    // damage-assignment confirm / auto-pass path, which this search-side pass
    // stands in for. Single-block / unblocked positions need no manual
    // assignment, so the auto assignments are authoritative.
    const combat = state.combat;
    if (
        combat &&
        combat.damageConfirmed === false &&
        (state.phase === "FIRST_STRIKE_DAMAGE" ||
            state.phase === "COMBAT_DAMAGE")
    ) {
        const kind =
            state.phase === "FIRST_STRIKE_DAMAGE" ? "first-strike" : "regular";
        applyAllCombatDamage(
            state,
            buildAutoDamageAssignments(state, kind),
            kind
        );
        combat.damageConfirmed = true;
        checkStateBasedActions(state);
    }

    state.passCount += 1;

    if (state.passCount >= 2 && state.stack.length > 0) {
        resolveTopOfStack(state);
        if ((state.pendingChoices?.length ?? 0) > 0) {
            state.priorityPlayerId = state.pendingChoices![0].playerId;
        } else if (state.pendingTarget) {
            state.priorityPlayerId = state.pendingTarget.playerId;
        } else {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
        }
    } else if (state.passCount >= 2 && state.stack.length === 0) {
        advancePhase(state);
    } else {
        state.priorityPlayerId = getOpponentId(state, passerId);
    }

    drainAutoPasses(state);
    checkStateBasedActions(state);
}

/** Apply `move` for `playerId` in place, reusing the real GRE resolution and
 *  priority machinery. Unlike the greedy sandbox (`applyMoveForSearch`), spells
 *  go on the stack WITHOUT auto-resolving and combat is left for the phase
 *  machine — so the opponent gets real priority to respond and the tree can find
 *  instant responses / multi-step combat lines.
 *
 *  An `activate-ability` move behaves the same way (issue #1920): its costs are
 *  paid and the ability goes on the stack unresolved, so the opponent gets a real
 *  response window and the tree sees the payoff a ply later. A MANA ability is
 *  the one exception — it never uses the stack (CR 605.3c) and the search models
 *  it through the tap plan instead.
 *
 *  Documented simulation limits (server stays authoritative, so inexactness only
 *  costs move quality): coarse mana (tap-plan only), so an activation's
 *  `notedManaSpent` (CR 106.10) and the mana-value snapshot of an additional
 *  sacrifice (CR 601.2f) are not reconstructed on the search's stack item. */
export function applyMoveInSearch(
    state: GameState,
    playerId: string,
    move: Move
): void {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;

    switch (move.kind) {
        case "pass":
            passInSearch(state, playerId);
            return;

        case "mulligan":
            // Handled only at the root (see `search`); never reached mid-rollout
            // because no phase re-enters MULLIGAN. Treat as a no-op for safety.
            return;

        // ---- Choice-node answers (PRD #1423, issue #1425) --------------------
        // A live `PendingChoice` is an in-tree decision node; its answer is
        // applied through the SAME pure resolvers the executor mutations drive
        // (`pendingChoiceSubmit.ts` / `phases.ts`), so the search can never
        // diverge from the authoritative path. Each resolver already resumes
        // the suspended resolution (`resolveTopOfStack` when the queue empties)
        // and hands priority to whoever owes the next decision, so the playout
        // simply continues past the node.
        case "may-pay": {
            applyMayPaySubmit(state, {
                playerId,
                accept: move.accept,
                ...(move.sacrificeIds
                    ? { sacrificeIds: move.sacrificeIds }
                    : {}),
                ...(move.discardIds ? { discardIds: move.discardIds } : {}),
            });
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "land-entry": {
            // CR 614.12 / ADR 0051 — shock land: no stack item, the resolver
            // resumes the active player's priority window itself.
            applyLandEntrySubmit(state, { playerId, accept: move.accept });
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "draw-replacement": {
            // CR 614 / ADR 0061 — Zur's Weirding. Turn-based draw-step choice
            // (again no stack item); mirrors the `submitDrawReplacementPay`
            // mutation, which calls the same resolver + SBA check.
            finalizeDrawReplacementPay(state, move.accept);
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "random-reveal-ack": {
            // CR 705.2 (ADR 0023, issue #1511) — the coin-flip/reveal
            // acknowledge: the outcome was already drawn and persisted when
            // the reveal was raised, so this carries no choice data. Applied
            // through the SAME resolver the `submitRandomRevealAck` mutation
            // drives; it drops the queue head and resumes the suspended
            // resolution (`resolveTopOfStack` when the queue empties), so the
            // playout simply continues past the node instead of halting.
            applyRandomRevealAck(state, {
                playerId,
                stackItemId: move.stackItemId,
                choiceId: move.choiceId,
            });
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "madness-decline":
        case "rebound-decline": {
            // CR 702.35a / 702.88c (issue #2983) — decline a reflexive CAST
            // WINDOW. Before this, neither kind reached this switch at all:
            // the two choices had no candidate generator, so `enumerateMoves`
            // returned nothing while one was the head choice and no move of
            // either kind was ever built. Now that they ARE decision nodes,
            // the decline is a branch the tree plays — and this switch has no
            // `default`, so without these cases it would apply NOTHING: the
            // choice would stay at the head of the queue, the same node would
            // be re-expanded, and the playout would spin on it instead of
            // moving past the window.
            //
            // Applied through the SAME pure resolvers the two decline
            // mutations drive (`declineMadness` / `declineRebound`,
            // gre/{madness,rebound}.ts), followed by the identical CR 117.3c
            // priority reset those mutations perform — the reflexive ability
            // is done, so priority returns to the ACTIVE player, not to the
            // decliner. Copying that reset is what keeps a declined window
            // from handing the tree a position the server would never produce.
            if (move.kind === "madness-decline") {
                declineMadness(state);
            } else {
                declineRebound(state);
            }
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "resolution-choice": {
            // Generic (non-yes/no) choice-node answer — `option-pick`
            // (CR 700.2 / 601.2b modal spells, CR 614.12 "as it enters, choose
            // …" body picks, issue #1428) and `search-library` (CR 701.23
            // fetchlands / tutors, issue #1429; an empty `cardInstanceIds` is
            // CR 701.23b's "fail to find"). Applied through the SAME validated
            // resolver the `submitResolutionChoice` mutation drives
            // (`applyPendingChoiceSubmit`), so the search can never diverge from
            // the authoritative path. It already resumes the suspended
            // resolution (`resolveTopOfStack` when the queue empties) and hands
            // priority to whoever owes next; the extra drain/SBA calls below
            // mirror the yes/no-family cases for safety.
            applyPendingChoiceSubmit(state, {
                playerId,
                stackItemId: move.stackItemId,
                step: move.step,
                choiceId: move.choiceId,
                cardInstanceIds: move.cardInstanceIds,
                // CR 701.22 / 701.25 / 701.44a (issue #2996) — an `order-top`
                // answer partitions the looked-at cards, and the un-kept half
                // travels here. Dropping it would submit a kept list that does
                // not cover `candidateIds`, which the resolver rejects
                // ("order-top must place every looked-at card once") — so the
                // search would apply nothing and spin on the same node.
                ...(move.secondZoneIds
                    ? { secondZoneIds: move.secondZoneIds }
                    : {}),
            });
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "submit-target": {
            // CR 603.3d / 115.7 / 707.10b (issue #2283) — answer an
            // ENGINE-RAISED target selection. Applied through the SAME
            // authority the `selectTargets` mutation reaches
            // (`applyRaisedTargetFinalization`), so the tree cannot commit a
            // raised selection differently from the server. The origin is
            // re-checked here rather than trusted from the move: a determinized
            // world can have advanced past the selection the move was
            // enumerated against, and silently writing targets onto an
            // ANNOUNCED selection would corrupt a half-built announcement.
            const pt = raisedPendingTargetOwedBy(state, playerId);
            if (!pt) return;
            pt.selected = [...pt.selected, ...move.targets];
            applyRaisedTargetFinalization(state, pt);
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "play-land": {
            // CR 305.9 — hand is the normal source, but a play-from-graveyard
            // (Icetill Explorer) or play-from-top-of-library (Courser of
            // Kruphix) permission makes those legal sources too, and the
            // enumerator now offers them. Resolve the actual zone through the
            // shared resolver rather than assuming hand: a hard-coded "hand"
            // made `moveCard` THROW (`Card <id> not found in hand`) the moment
            // such a move reached this leaf. `null` means no permitted source
            // still holds the card (a stale move) — skip it rather than throw.
            const sourceZone = resolvePlayLandSourceZone(
                state,
                player,
                move.cardInstanceId
            );
            if (sourceZone === null) return;
            // CR 601.3 (#1156) — a cross-player exile grant (Dauthi
            // Voidwalker) leaves the card in the OPPONENT's exile, which
            // `moveCard` (single-player zones only) cannot move. That case has
            // never been reachable in this coarse leaf; skip it rather than
            // throw, leaving the position unchanged for evaluation.
            if (
                sourceZone === "exile" &&
                !player.exile.some((c) => c.id === move.cardInstanceId)
            ) {
                return;
            }
            // CR 712.12 — the face is chosen BEFORE the card is put onto the
            // battlefield, so the stamp precedes the zone move here exactly as
            // it does on the real path (`stampChosenFace`, `gre/playLand.ts`)
            // — the stamper's own contract says the card must not be on the
            // battlefield yet. Without it the coarse leaf would put an Instant
            // onto the battlefield, count no land drop, and evaluate a
            // position the real engine never produces.
            const sourceCard = (
                sourceZone === "library-top"
                    ? player.library
                    : player[sourceZone]
            ).find((c) => c.id === move.cardInstanceId);
            if (move.face === "back" && sourceCard) {
                stampModalBackFaceForPlay(state, sourceCard);
            }
            const card = moveCard(
                player,
                move.cardInstanceId,
                sourceZone === "library-top" ? "library" : sourceZone,
                "battlefield"
            );
            if (card.types.includes("Land")) {
                player.landsPlayedThisTurn =
                    (player.landsPlayedThisTurn ?? 0) + 1;
            }
            // CR 305.2 — mirror the real play-land chokepoint: `wasPlayed`
            // marks a PLAYED land so "whenever you play a land" triggers fire.
            emitPermanentEntered(state, card, { wasPlayed: true });
            processPendingActionTriggers(state);
            // A special action resets the pass cycle (CR 117.3c) and keeps
            // priority with the actor, who may keep acting.
            state.passCount = 0;
            checkStateBasedActions(state);
            return;
        }

        case "summon-companion": {
            // CR 116.2 / 702.139a — the companion summon special action. Coarse
            // mana model (see file header): taps a representative source set
            // for the {3} without draining the pool coin-exact. No stack item
            // (CR 116.2a), so — like `play-land` — this is a special action
            // that resets the pass cycle and keeps priority with the actor.
            const companion = player.companion;
            if (companion && !companion.used) {
                const subs = getManaSubstitutions(state, playerId);
                const sources = buildAutoTapSources(
                    player.battlefield,
                    manaGateBattlefields(state)
                );
                const plan = solveSmartAutoTap(
                    player.manaPool,
                    COMPANION_SUMMON_COST,
                    subs,
                    sources
                );
                if (plan) {
                    for (const step of plan) {
                        const src = player.battlefield.find(
                            (c) => c.id === step.cardId
                        );
                        if (src) src.isTapped = true;
                    }
                }
                player.hand.push({ ...companion.instance, zone: "hand" });
                companion.used = true;
            }
            state.passCount = 0;
            checkStateBasedActions(state);
            return;
        }

        case "turn-face-up": {
            // CR 116.2b / 702.37e — the turn-face-up special action. Coarse
            // mana model (see file header): taps a representative source set
            // for the morph cost without draining the pool coin-exact.
            // Legality AND affordability were established by `canTurnFaceUp` at
            // enumeration time. No stack item (CR 116) — so, like `play-land`
            // and `summon-companion`, this resets the pass cycle and keeps
            // priority with the actor.
            //
            // CR 708.8 — `turnFaceUp` mutates the permanent in place; nothing
            // re-enters the battlefield, so no ETB trigger of its own or of any
            // other permanent can fire. Structural, not a suppression flag.
            const permanent = player.battlefield.find(
                (c) => c.id === move.cardInstanceId
            );
            if (permanent) {
                const plan = morphTurnUpPaymentPlan(state, player, permanent);
                if (plan) {
                    const tapped = new Set(plan.map((step) => step.cardId));
                    for (const src of player.battlefield) {
                        if (tapped.has(src.id)) src.isTapped = true;
                    }
                }
                turnFaceUp(state, permanent);
            }
            state.passCount = 0;
            checkStateBasedActions(state);
            return;
        }

        case "cast-spell": {
            // CR 702.35a / 702.88a (issue #2983) — a cast that ACCEPTS an open
            // reflexive cast window consumes that window's pending choice, in
            // the SAME two calls and the SAME order the `announceCast` mutation
            // makes them (`convex/game.ts`), and for the same reason: the
            // choice blocks priority, so leaving it in the queue would put the
            // spell on the stack with its own window still open — a position
            // the server can never produce, in which the tree would then be
            // offered the window's candidates all over again for a card that
            // has already left exile.
            //
            // Both are no-ops unless the head choice is THIS card's window for
            // THIS player, so an ordinary cast made while some unrelated choice
            // sits in the queue is untouched.
            consumeMadnessCastChoice(state, playerId, move.cardInstanceId);
            consumeReboundCastChoice(state, playerId, move.cardInstanceId);
            // CR 702.66b / 601.2g (issue #1661) — pay the delve exile BEFORE
            // the tap plan runs (`applyDelveExileForSearch`'s forced-minimum
            // calc needs the caster's mana still untapped, mirroring the
            // real announce-time computation) and before the spell leaves
            // hand, mirroring `tryAutoCommitPendingCast`'s real-path order
            // (`convex/gre/activation.ts`).
            // CR 601.3 (issue #2980) — the zone the Move DECLARES, not the
            // hand: a hand-only lookup skipped this whole pre-cast cost block
            // for every graveyard and exile cast the enumerator offers, so an
            // escape cast's exile went uncharged and the spell reached the
            // stack for free.
            const preCastSpell = findCastSourceCard(
                state,
                player,
                move.cardInstanceId,
                move.castFromZone
            );
            if (preCastSpell) {
                applyDelveExileForSearch(
                    state,
                    player,
                    preCastSpell,
                    move.chosenX
                );
            }
            applyTapPlan(state, playerId, move.tapPlan);
            // CR 107.4f / 702.33a (issue #2081) — pay the LIFE this move
            // chose to cover with life: Phyrexian pips (2 per pip) and/or a
            // paid Kicker's life leg (`kickerLifeCost`, folded into
            // `move.payLife` by `moves.ts` at enumeration time). The greedy
            // sandbox (`applyMoveForSearch`, `applyMove.ts`) already deducted
            // this field for Phyrexian mana; the ISMCTS tree never did — an
            // uncharged `payLife` makes any life-paying variant free HERE,
            // the exact bug class this issue exists to close for Kicker (and,
            // as a byproduct, closes it for the pre-existing Phyrexian case
            // this tree never charged either).
            if (move.payLife && move.payLife > 0) {
                player.life -= move.payLife;
            }
            // CR 601.2b / 601.2h / 118.8 — charge the CASTER-CHOSEN additional
            // cost leg in the ISMCTS tree too, for the same reason the greedy
            // sandbox does (`applyAdditionalCostLegForSearch`'s doc): the two
            // legs of "discard a card or pay 3 life" differ only in their cost,
            // so an uncharged leg makes the choice pure rollout noise.
            applyAdditionalCostLegForSearch(
                state,
                playerId,
                move.cardInstanceId,
                move.additionalCostLegId,
                move.chosenX
            );
            // CR 702.33a / 601.2f (issue #2081) — pay a paid Kicker's
            // PERMANENT leg (sacrifice/return), mirroring the greedy sandbox
            // (`applyMove.ts`'s `applyKickerPermanentLegForSearch` doc) —
            // TWO independent reimplementations of "build a StackItem from a
            // cast" (issue #2473), so a cost paid in one and not the other is
            // a divergence between the greedy selector and ISMCTS.
            if (move.kickerPayments && preCastSpell) {
                const kickerCardDef = tryGetDefinition(
                    (preCastSpell.card as { id?: string }).id ?? ""
                );
                if (kickerCardDef) {
                    applyKickerPermanentLegForSearch(
                        state,
                        playerId,
                        kickerCardDef,
                        move.kickerPayments
                    );
                }
            }
            // CR 601.2f / 701.21 / 701.13 (issue #2135) — pay the mandatory
            // additional-cost parks (filtered sacrifice + Drought, and the exile
            // additional cost) before the spell leaves its zone, mirroring the
            // greedy sandbox (`applyMoveForSearch`). The picks ride on the move
            // (`castCostPicks`), so the tree charges exactly what the executor
            // submits.
            const castCostOut: {
                additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
            } = {};
            let castCostsPaid = true;
            if (move.castCostPicks && preCastSpell) {
                castCostsPaid = applyCastCostPicksForSearch(
                    state,
                    playerId,
                    preCastSpell,
                    tryGetDefinition(
                        (preCastSpell.card as { id?: string }).id ?? ""
                    ) ?? undefined,
                    move.additionalCostLegId,
                    move.castCostPicks,
                    castCostOut,
                    {
                        castFromZone: move.castFromZone,
                        chosenX: move.chosenX,
                    }
                );
            }
            // CR 702.138a escape (issue #2980) — the exile cost could not be
            // paid from the zone the Move named: a STALE Move (the
            // graveyard changed between enumeration and application).
            // Skip it rather than put the spell on the stack for free —
            // escape exiles nothing on resolution, so an uncharged
            // escape cast is recastable forever.
            if (!castCostsPaid) return;
            // CR 702.81a (issue #2358) — a RETRACE cast leaves the GRAVEYARD,
            // not the hand, and destroys a land card from hand on the way. The
            // discard is what BOUNDS the line: retrace exiles nothing, so the
            // spell returns to the graveyard on resolution (CR 608.2m) and is
            // recastable, and only the shrinking supply of lands stops the tree
            // recasting it forever.
            const retraceZone = applyRetraceCastForSearch(
                state,
                playerId,
                move.cardInstanceId
            );
            // CR 601.3 / 400.7 (issue #2971) — the zone this cast leaves and
            // the player whose zone it is, through the shared resolver. A
            // hard-coded `"hand"` threw `Card <id> not found in hand` for every
            // graveyard and exile cast the enumerator now offers, and cannot
            // express a cross-player exile grant at all. `null` = a stale Move:
            // skip it, mirroring the `play-land` leaf above.
            const castSource = castSourceForSearch(
                state,
                player,
                move.cardInstanceId,
                move.castFromZone,
                retraceZone
            );
            if (castSource === null) return;
            const castFromZone = castSource.zone;
            // CR 702.139 (issue #1392, Lurrus) — read the mechanism while the
            // card is still IN the graveyard, then charge the once-per-turn
            // permanent permission at commit exactly as every real commit site
            // does. Without it this tree — the chokepoint every rollout, blade
            // scenario and self-play game routes through — recasts the same
            // permanent every turn for free.
            const castMechanism =
                castFromZone === "graveyard"
                    ? graveyardCastMechanism(
                          state,
                          castSource.owner,
                          castSource.owner.graveyard.find(
                              (c) => c.id === move.cardInstanceId
                          )!,
                          playerId
                      )
                    : undefined;
            const spellCard = removeFromZone(
                state,
                castSource.owner,
                move.cardInstanceId,
                castFromZone,
                playerId
            );
            if (castMechanism === "permanent-permission") {
                markGraveyardPermanentCastUsed(state, playerId);
            }
            const stackItem: StackItem = {
                ...spellCard,
                castById: playerId,
                ...(move.targets.length > 0 ? { targets: move.targets } : {}),
                ...(move.chosenX !== undefined
                    ? { chosenX: move.chosenX }
                    : {}),
                ...(move.chosenModeId
                    ? { chosenModeId: move.chosenModeId }
                    : {}),
                // CR 702.33 / 702.27a (issue #2081) — snapshot the payment
                // record onto the stack item, mirroring the greedy sandbox
                // (`applyMove.ts`) and the real commit paths
                // (`PendingCast.kickerPayments` / `.buybackPaid` →
                // `StackItem`), so a resolving Kicker/Buyback spell reads
                // `wasKicked` / `{ additionalCostPaid }` / the Buyback return-to-hand
                // redirect correctly on THIS, the chokepoint every rollout and
                // all self-play route through.
                // CR 702.33d / 702.175a (ADR 0085) — partitioned by keyword at
                // the write, exactly as the real commit paths partition it
                // (`game.ts`), so the sandbox's resolving spell reads the same
                // kicked-ness the mutation would have produced.
                ...additionalCostPaymentSnapshot(
                    tryGetDefinition(
                        (spellCard.card as { id?: string }).id ?? ""
                    ),
                    move.kickerPayments
                ),
                ...(move.buybackPaid ? { buybackPaid: move.buybackPaid } : {}),
                // CR 118.8 / 608.2h — the additional-cost victim snapshot the
                // cost payment above collected, stamped exactly as
                // `tryCommitCast` stamps it, so a spell reading the victim back
                // at resolve (`getAdditionalSacrificeMv` — Metamorphosis,
                // Sacrifice, Burnt Offering) produces its real effect on THIS,
                // the chokepoint every rollout and all self-play route through.
                ...(castCostOut.additionalSacrificeSnapshot
                    ? {
                          additionalSacrificeSnapshot:
                              castCostOut.additionalSacrificeSnapshot,
                      }
                    : {}),
                // CR 307.1 / 117.1a / 601.3a (issue #2473) — the ISMCTS
                // in-tree `cast-spell` executor is the SECOND wholesale
                // reimplementation of "build a StackItem from a cast" (the
                // greedy 1-ply sandbox `applyMoveForSearch` in
                // `applyMove.ts` is the first) and, unlike it, is the
                // chokepoint every rollout, every blade scenario and all
                // self-play route through. It never calls into `game.ts`, so
                // it needs its own stamp or the bot simulates a game in which
                // the flag is universally absent. Evaluated on `state`
                // immediately PRE-push (the cost payment above has already
                // been applied, exactly as the real commit paths do), so it
                // reads the same pre-cast board the mutation path reads at
                // announcement.
                ...(wasCastOffSorceryTiming(state, playerId)
                    ? { castOffSorceryTiming: true }
                    : {}),
                // CR 702.34 / 702.138 / 702.81a / 702.88a (issue #2971) — the
                // zone-dependent stack flags, read from the SAME two helpers
                // every real commit site spreads (`gre/castCost.ts`) rather
                // than the single hand-written retrace flag this tree carried
                // before. Flashback's `exileOnResolve` is the one that BOUNDS
                // the line: without it the tree models a flashback card as
                // infinitely recastable, the same unbounded-recast failure the
                // retrace land discard was written to prevent.
                ...graveyardCastStackFlags(state, spellCard, castFromZone),
                ...reboundCastStackFlags(spellCard, castFromZone),
            };
            // CR 601.2b (issue #2796) — the characteristics of the CAST MODE
            // the caster chose (Bestow's Aura rewrite, Morph's face-down 2/2,
            // Dash's and Evoke's markers), through the single census both
            // search executors share (`gre/castMode.ts`). This leaf used to
            // keep its own partial copy: it stamped morph and nothing else, so
            // a bestow line resolved into a plain 1/1 creature and was
            // indistinguishable from the printed-cost cast at every depth and
            // every budget — the root pick between them fell to rollout noise,
            // which is how the bot came to bestow a +1/+1 Aura onto the
            // OPPONENT's creature (issue #2796), and an evoked creature was
            // modelled as one that stays.
            applyCastModeCharacteristics(
                state,
                stackItem,
                move.alternativeCostId
            );
            state.stack.push(stackItem);
            // CR 117: the caster gets priority but auto-passes it (no Ctrl), so
            // the opponent gets to respond before the spell resolves.
            state.passCount = 0;
            state.priorityPlayerId = playerId;
            state.singleShotAutoPass = playerId;
            // CR 601.2i / 603.3 (issue #3026) — the SPELL_CAST choke point, in
            // the same position and the same order the mutation path puts it
            // (`commitPendingCast`, `convex/game.ts`): after the push and the
            // priority bookkeeping, BEFORE the auto-pass drain. Reaching it is
            // what makes `spellsCastThisTurn` (Storm, ADR 0052), the caster's
            // own per-turn tally (issue #1343, connive / Ledger Shredder) and
            // the lifetime `spellsCastThisGame` (issue #790) count inside the
            // tree at all — this leaf hand-builds its StackItem and used to
            // push it without ever announcing the cast, so the search modelled
            // a game in which nobody had ever cast anything: storm always
            // copied zero times and no "whenever you cast" trigger existed.
            // `collectCastTriggers` runs inside it, so the storm / self-cast
            // trigger lands ABOVE the spell in the same atomic step.
            emitSpellCastEvent(state, stackItem);
            // CR 603.3 — flush the battlefield-watching cast triggers the event
            // just queued BEFORE the drain, for the reason `commitPendingCast`
            // spells out: the drain can reach two consecutive passes and start
            // resolving the very spell whose trigger has not been placed yet.
            processPendingActionTriggers(state);
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "activate-ability": {
            // CR 602.2a (issue #1920) — the ability goes ON THE STACK, exactly
            // as a cast spell does above, so the search can see its PAYOFF.
            // Before this the case applied the COSTS only: the effect never
            // reached the stack, `policyValue`'s one-resolution lookahead had
            // nothing to resolve, and every activation evaluated at best equal
            // to `pass` (strictly worse once any term could see the spent
            // cost). That is also why the board-side flexibility term of issue
            // #1890 item 3 was blocked — a symmetric credit for HOLDING an
            // option, over an invisible payoff for SPENDING it, is a
            // deterministic decline in the reactive window.
            //
            // The SOURCE is resolved BEFORE the costs are paid, because paying
            // can remove it from its zone (a self-sacrifice cost, a
            // graveyard-source `exileThis`) while the stack item must still be
            // a snapshot of it — the same order, and the same retained
            // reference, that the mutation path uses (`activateAbilityOnState`,
            // `convex/gre/activation.ts`).
            const source = findActivationSource(state, move.cardInstanceId);
            // CR 113.1 (issue #2468) — the ENTRY, not just the template: when
            // the ability reached `source` through a grant (an Aura's
            // `activated-grant` static effect, `grantActivatedAbility` /
            // `grantActivatedAbilityPermanent`), the granting card's
            // definition id has to ride along to the push below, or
            // `resolveTopOfStack` cannot find the template to resolve and the
            // item pops as a silent no-op.
            const activatedEntry = source
                ? effectiveActivatedAbilityEntryOf(source, move.abilityId)
                : undefined;
            const activated = activatedEntry?.ability;
            applyTapPlan(state, playerId, move.tapPlan);
            // CR 602.1 / 118 (issue #2155) — every non-mana cost leg, paid
            // through the SAME helper the greedy sandbox
            // (`applyMoveForSearch`) uses and applying exactly the cards
            // `executor.ts` will name to the server: the `{T}` cost, a
            // self-sacrifice, a graveyard-source `exileThis` (issue #2339),
            // and the four deferred legs the move carries in `costPicks`
            // (sacrificeFilter / tapOtherFilter / discardFilter /
            // exileFromGraveyard). Before this the ISMCTS tree applied the tap
            // plan only, so those four were free HERE while the greedy
            // sandbox and the live bot paid them — an activation whose payoff
            // the search also cannot see then tied `pass` exactly and won on
            // rollout noise (#2422 Sylvan Safekeeper, #2415 Iron-Shield Elf).
            // `paid` is false when a cost leg could not be met (CR 118 — a
            // short `removeCounter`, too little life, no last-drawn card in
            // hand). The helper changes NOTHING in that case, and the push is
            // declined below: an activation the payer cannot afford must not
            // buy its effect in the tree. `enumerateAbilityMoves` gates all
            // three, so this is the fail-closed backstop for the hand-built
            // moves this exported function also accepts (issue #1920 review
            // round 2 — the round-2 version skipped the unpayable leg silently
            // and kept the payoff, which is how the bot came to rank a Thallid
            // activation the server rejects above `pass`).
            // CR 118.1 / 608.2h — the one cost by-product the pushed item needs
            // back: the snapshot of a card exiled from a graveyard to pay the
            // cost, gone by resolution (Necropolis reads it as X).
            const costOut: {
                additionalSacrificeSnapshot?: StackItem["additionalSacrificeSnapshot"];
            } = {};
            const paid = applyActivationCostsForSearch(
                state,
                playerId,
                move,
                costOut
            );
            // CR 605.3c — a MANA ability never uses the stack: it resolves
            // immediately and is payment plumbing the search already models
            // through the tap plan. Pushing one would park an item nothing ever
            // resolves. `enumerateAbilityMoves` already refuses to emit a
            // `!useStack` ability as a macro-move (`moves.ts`), so this gate is
            // fail-closed defence for the hand-built moves this exported
            // function also accepts (tests, blade setup steps).
            if (paid && source && activated?.useStack) {
                // CR 602.2a — the item is built by the SAME authority the three
                // mutation commit sites use (`activationCommit.ts`), so the
                // fields `resolveTopOfStack` reads cannot drift between the
                // tree and live play. The announcement data all rides on the
                // move, plus `grantedSourceCardId` (CR 113.1) off the entry
                // resolved above when the ability came from a grant — without
                // it `resolveTopOfStack` cannot find the granted template and
                // the item pops as a no-op (issue #2468). The two fields that
                // do NOT ride the move are derived server-side during payment.
                // `notedManaSpent` (CR 106.10 — needs an exact pool delta, and
                // `applyTapPlan` taps sources without draining the pool
                // coin-exact) is deliberately absent. The additional-cost
                // victim snapshot (CR 118.1 / 608.2h) is reconstructed for the
                // GRAVEYARD-EXILE leg only, through the cost helper's
                // out-collector above — an ability that reads it back
                // (Necropolis' X) would otherwise resolve for zero in the tree
                // and never be played. The SACRIFICE leg's snapshot stays
                // unreconstructed: `applySacrificeSelection`'s victim is chosen
                // inside the helper and its effective POWER (CR 613 layer 7c,
                // Freyalise Supplicant) is not recoverable after removal.
                state.stack.push(
                    buildActivatedAbilityStackItem(source, {
                        castById: playerId,
                        abilityId: move.abilityId,
                        ...(move.targets.length > 0
                            ? { targets: move.targets }
                            : {}),
                        ...(move.chosenModeId
                            ? { chosenModeId: move.chosenModeId }
                            : {}),
                        ...(move.chosenX !== undefined
                            ? { chosenX: move.chosenX }
                            : {}),
                        ...(activatedEntry?.grantedSourceCardId
                            ? {
                                  grantedSourceCardId:
                                      activatedEntry.grantedSourceCardId,
                              }
                            : {}),
                        // Issue #2943 — the origin travels with the def id for
                        // the same reason: an ability-COPY grant resolved
                        // against `grantTemplates[]` finds nothing and the
                        // tree scores the move as a no-op.
                        ...(activatedEntry?.grantedAbilityOrigin
                            ? {
                                  grantedAbilityOrigin:
                                      activatedEntry.grantedAbilityOrigin,
                              }
                            : {}),
                        ...(costOut.additionalSacrificeSnapshot
                            ? {
                                  additionalSacrificeSnapshot:
                                      costOut.additionalSacrificeSnapshot,
                              }
                            : {}),
                    })
                );
                // CR 602.5 — the per-turn activation tally, recorded at the same
                // moment the mutation path records it. Without it a rollout
                // re-activates an `oncePerTurn` ability without limit (the
                // enumerator's gate reads this map) and over-rates it.
                recordActivation(
                    state,
                    source,
                    move.abilityId,
                    !!activated.cost.tap
                );
                // CR 603.3 — flush the ABILITY_ACTIVATED queued above so a
                // "non-tap ability activated" punisher lands ON TOP of the
                // freshly pushed ability, exactly as the mutation path orders
                // it. Must run BEFORE the auto-pass drain, which could
                // otherwise start resolving the ability first. No-op for a {T}
                // ability, and no-op when nothing is watching.
                processPendingActionTriggers(state);
            }
            state.passCount = 0;
            state.priorityPlayerId = playerId;
            state.singleShotAutoPass = playerId;
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "activate-granted-ability": {
            // CR 113.1b / 605.3a (issue #2903) — activate a PLAYER-level granted
            // ability (Channel's "Pay 1 life: Add {C}."), mirroring the
            // `activatePlayerAbility` mutation's payment+effect path so the tree
            // charges the cost AND credits the mana the same way live play does.
            // The template is a reference resolved through the card-definition
            // lookup — there is no instance to read it off.
            const grant = player.grantedAbilities?.find(
                (g) => g.id === move.grantedAbilityInstanceId
            );
            const template = grant
                ? tryGetDefinition(
                      grant.sourceCardId
                  )?.activatedAbilities?.find((a) => a.id === move.abilityId)
                : undefined;
            if (!template || !grant) return;
            // Fail-closed: a player grant's MANA cost is paid from the pool and
            // no shipped player grant carries one (the enumerator skips such
            // templates), so a hand-built move with one must not be credited
            // free mana here.
            if (template.cost.mana) return;
            // CR 119.4 — pay the life cost (the one leg the move's affordability
            // gate at enumeration time already vouched for; fail-closed backstop
            // for hand-built moves, mirroring `applyActivationCostsForSearch`).
            if (template.cost.life !== undefined) {
                player.life -= template.cost.life;
            }
            if (!template.useStack) {
                // CR 605.3b — a mana ability never uses the stack: resolve its
                // effect immediately (add the mana) and keep priority with the
                // actor, so the bot can chain activations or cast off the fresh
                // pool. Mirrors the mutation's minimal `addMana`-only context.
                template.effect?.({
                    addMana: (amount) => {
                        for (const [color, count] of Object.entries(amount)) {
                            if (
                                color !== "X" &&
                                typeof count === "number" &&
                                count > 0
                            ) {
                                player.manaPool[color] =
                                    (player.manaPool[color] ?? 0) + count;
                            }
                        }
                    },
                });
                state.passCount = 0;
                checkStateBasedActions(state);
                return;
            }
            // Stack path (a future granted non-mana ability; Channel is the only
            // grant today and is a mana ability) — mirror the mutation's
            // synthesized stack item. The enumerator already skips targeted /
            // conditional / tap / sacrifice templates, so this is a plain push.
            const stackItem: StackItem = {
                id: `granted-${grant.id}`,
                card: { id: grant.sourceCardId },
                controllerId: playerId,
                ownerId: playerId,
                zone: "stack",
                types: tryGetDefinition(grant.sourceCardId)?.types ?? [],
                subtypes: tryGetDefinition(grant.sourceCardId)?.subtypes ?? [],
                staticAbilities: [],
                isTapped: false,
                castById: playerId,
                abilityId: move.abilityId,
            };
            state.stack.push(stackItem);
            state.passCount = 0;
            state.priorityPlayerId = getOpponentId(state, playerId);
            state.singleShotAutoPass = playerId;
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "declare-attackers": {
            // CR 508.1g / 701.43d — carry the move's optional exert choices
            // into the sandbox declaration; `emitAttackersDeclaredEvents` below
            // pays them and batches their linked "when you do" triggers with
            // the attack triggers, so the search sees both the payoff and the
            // missed untap the server would produce.
            const declaredExertIds = (move.exertIds ?? []).filter((id) =>
                move.attackerIds.includes(id)
            );
            const combat = (state.combat = {
                attackerIds: [...move.attackerIds],
                ...(declaredExertIds.length > 0
                    ? { exertedIds: declaredExertIds }
                    : {}),
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            });
            for (const id of combat.attackerIds) {
                const atk = findCreature(state, id);
                if (!atk) continue;
                markAttacking(state, atk);
                // CR 506.3 — the shared declaration record, so the SEARCH's
                // model of a declaration matches the server's exactly and the
                // bot can see "no creatures attacked this turn" effects
                // (issue #1944).
                recordAttackerDeclared(state, atk);
                if (!atk.staticAbilities.includes("vigilance")) {
                    // CR 708.9 / ADR 0013 — face-down attacker turns up on tap.
                    tapPermanent(state, atk);
                }
            }
            // CR 508.1m (issue #3222) — the attack triggers, the exact mirror
            // of `emitBlockersConfirmedEvents` in the branch below and of what
            // the `confirmAttackers` path does on the server. Without it every
            // ATTACKERS_DECLARED ability — battle cry's pump, exalted's,
            // annihilator's sacrifice, a token-making attack trigger — was
            // invisible to the search: the bot weighed a swing at the printed
            // P/T and never saw what attacking with the creature actually buys.
            // The emission owns its own priority/passCount reset when it places
            // something on the stack; the unconditional reset below is the
            // no-trigger case and agrees with it.
            emitAttackersDeclaredEvents(state);
            // CR 508 — active player gets priority after attackers are declared.
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "declare-blockers": {
            if (state.combat) {
                const byBlocker: Record<string, string[]> = {};
                for (const { blockerId, attackerId } of move.assignments) {
                    (byBlocker[blockerId] ??= []).push(attackerId);
                }
                state.combat.blockerAssignments = byBlocker;
                // CR 509.1a — the ONE blocker-marking chokepoint, which also
                // re-materializes the statics whose condition reads
                // `isBlocking` (Snow Devil). Must run BEFORE `drainAutoPasses`
                // below, exactly as in the `confirmBlockers` mutation: the
                // drain can reach `advancePhase`'s CR 510.4 first-strike-step
                // skip decision with no intervening SBA pass (issue #1826).
                markDeclaredBlockers(state);
                state.combat.pendingBlockerId = undefined;
                state.combat.blockersConfirmed = true;
                recordBlockedAttackers(state);
                emitBlockersConfirmedEvents(state);
            }
            // CR 509.2 — active player gets priority after blockers are declared;
            // combat damage applies when both pass into the damage step.
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Rollout (truncated playout)
// ---------------------------------------------------------------------------

/** A scored leaf: the bounded `reward` (drives UCB1) plus the saturation-proof
 *  material `margin` (breaks outcome-equal ties), both from the bot's view. */
type Leaf = { reward: number; margin: number };

/** Score a stable leaf from the bot's perspective. */
function scoreLeaf(
    state: GameState,
    botId: string,
    weights: EvalWeights
): Leaf {
    return {
        reward: reward(state, botId, weights),
        margin: materialMargin(state, botId, weights),
    };
}

/** Play `state` forward to a stable leaf with a cheap policy, then score it.
 *  Policy: with probability `ROLLOUT_EPSILON` a uniform-random legal move,
 *  otherwise the reactive-aware `selectRolloutMove` default policy (ADR 0021
 *  slice 2). Mutates `state` (caller owns it).
 *
 *  Horizon (ADR 0015): the rollout stops at the START of the bot's next turn
 *  (a full round; `ROLLOUT_EXTRA_BOT_TURNS` adds further bot-turn-starts),
 *  NOT after a fixed ply count. Scoring every candidate at the same game-clock
 *  boundary — after both players have had a symmetric chance to act — removes
 *  the action bias of a ply horizon, where "act on my own turn" was scored
 *  before the opponent's reply but "pass" was scored after the opponent
 *  developed. `MAX_ROLLOUT_TURNS` / `MAX_ROLLOUT_PLIES` bound stall loops. */
/** The exploration epsilon to use at `state` (ADR 0021, issue #229). Drops to
 *  `ROLLOUT_EPSILON_REACTIVE` on a reactive combat line — a declared combat in
 *  which EITHER player holds castable interaction — so the narrow ambush /
 *  cautious-block line plays out reliably instead of being diluted by random
 *  moves; the flat `ROLLOUT_EPSILON` otherwise. Pure read of `state`. */
function rolloutEpsilonFor(state: GameState, weights: EvalWeights): number {
    // A reactive combat line: any combat phase (the attack declaration that
    // baits the block, the block, and the response window) while SOME player
    // holds castable interaction. Covering the whole combat — not only a
    // confirmed exchange — keeps the bait attack and the in-response pump from
    // being randomised away, which is what dilutes the narrow ambush /
    // cautious-block line to a minority playout.
    const inCombat =
        state.phase === "DECLARE_ATTACKERS" ||
        state.phase === "DECLARE_BLOCKERS" ||
        state.phase === "COMBAT_DAMAGE" ||
        state.phase === "BEGINNING_OF_COMBAT" ||
        state.phase === "END_OF_COMBAT";
    if (!inCombat) return weights.rolloutEpsilon;
    const anyHeld = state.players.some((p) => hasCastableInstantHint(p));
    return anyHeld ? weights.rolloutEpsilonReactive : weights.rolloutEpsilon;
}

function rollout(
    state: GameState,
    botId: string,
    rng: () => number,
    weights: EvalWeights
): Leaf {
    const startTurn = state.turn;
    let lastTurn = state.turn;
    let botTurnStarts = 0;

    for (let ply = 0; ply < MAX_ROLLOUT_PLIES; ply++) {
        if (state.gameOver) break;

        // Turn-boundary horizon: a fresh bot-turn START is the active player
        // being the bot right after a turn crossing (not the bot turn the
        // rollout began in). Stop once we've reached enough of them.
        const turnChanged = state.turn !== lastTurn;
        lastTurn = state.turn;
        if (turnChanged && state.activePlayerId === botId) {
            botTurnStarts += 1;
            if (botTurnStarts > ROLLOUT_EXTRA_BOT_TURNS) break;
        }
        // Stall cap: the bot's turn never recurs (e.g. it lost priority forever
        // on a degenerate board) — score wherever we got to.
        if (state.turn - startTurn >= MAX_ROLLOUT_TURNS) break;

        const pid = decidingPlayer(state);
        if (!pid) break;
        const moves = enumerateMoves(state, pid);
        if (moves.length === 0) break;

        let chosen: Move;
        if (moves.length === 1 || rng() < rolloutEpsilonFor(state, weights)) {
            chosen = moves[Math.floor(rng() * moves.length)];
        } else {
            chosen = selectRolloutMove(state, pid, botId, moves, rng, weights);
        }
        applyMoveInSearch(state, pid, chosen);
    }
    return scoreLeaf(state, botId, weights);
}

/** Rollout default-policy guardrail (ADR 0020 §4). Returns true for a move the
 *  greedy default policy should AVOID modelling as typical play, because a
 *  competent player would not normally make it:
 *
 *    * attacking with a creature worth more held back — a mana producer (it taps
 *      out of being a source / blocker for marginal chip damage); and
 *    * casting a holdable instant at sorcery speed — the mover's own main phase,
 *      where the effect could be kept for a reactive window instead.
 *
 *  This biases the DEFAULT POLICY only — never legality. The move stays in the
 *  legal set and the tree can still explore it (the `ROLLOUT_EPSILON` random
 *  branch and UCB1 both reach it), so genuinely correct lines — a lethal dork
 *  attack, a must-cast instant — remain available; they simply have to earn it
 *  through reward rather than being modelled as the default. */
export function isDiscouragedRolloutMove(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (move.kind === "declare-attackers") {
        if (move.attackerIds.length === 0) return false;
        const player = state.players.find((p) => p.id === pid);
        if (!player) return false;
        // A mana producer is worth more as a source / blocker than as a chip
        // attacker; discourage swinging with one.
        return move.attackerIds.some((id) => {
            const c = player.battlefield.find((x) => x.id === id);
            // CR 106.1 (issue #1889) — the controller's battlefield resolves a
            // board-conditional output, so a mana creature currently producing
            // ZERO isn't protected as if it were a real source.
            return (
                !!c &&
                isCreature(c) &&
                hasManaAbility(c, undefined, player.battlefield)
            );
        });
    }
    if (move.kind === "cast-spell") {
        const player = state.players.find((p) => p.id === pid);
        const card = player?.hand.find((c) => c.id === move.cardInstanceId);
        const cardId = (card?.card as { id?: string } | undefined)?.id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        // Instant timing (CR 601.3a / 702.8): an Instant OR a Flash permanent —
        // both are "still castable in a later, more informed window" by
        // construction (that IS what instant speed means), so a sorcery-speed
        // cast here is discouraged on the same terms either way (issue #2248).
        if (
            !def ||
            !hasInstantSpeed({
                types: def.types,
                staticAbilities: def.staticAbilities ?? [],
            })
        )
            return false;
        // Sorcery-speed window: the mover is the active player at a main phase,
        // where the card could instead be held for a reactive moment.
        const atSorcerySpeed =
            pid === state.activePlayerId &&
            (state.phase === "PRECOMBAT_MAIN" ||
                state.phase === "POSTCOMBAT_MAIN");
        if (atSorcerySpeed) return true;
        // Premature combat trick (ADR 0021 slice 3): the active attacker casting
        // an instant BEFORE the opponent has committed blocks dumps the trick
        // early and forfeits the ambush. The competent line is to hold priority,
        // let blocks be declared, and respond then. Discouraged in the default
        // policy only — the tree still explores a genuine pre-block cast (e.g.
        // pushing lethal), it just isn't modelled as typical play.
        const combat = state.combat;
        const preBlockAsAttacker =
            pid === state.activePlayerId &&
            !!combat &&
            combat.confirmed &&
            !combat.blockersConfirmed &&
            combat.attackerIds.length > 0;
        return preBlockAsAttacker;
    }
    if (move.kind === "activate-ability") {
        // Activated-ability mirror of the two `cast-spell` cases above (issue
        // #1890 item 1). The reasoning is IDENTICAL and so is the scope: this is
        // never a per-card rule — the only inputs are the ability's declared
        // timing (`useStack`, `sorcerySpeedOnly`, a loyalty cost, a phase
        // restriction; `isDeferrableStackAbility`) and, for the third case, the
        // engine's own `animatesSelf` marker.
        const source = findPermanentOnBattlefield(state, move.cardInstanceId);
        if (!source) return false;
        const ability = effectiveAbilityOf(source, move.abilityId);
        // A mana ability is payment plumbing, not a play (CR 605.3a), and an
        // ability that CANNOT be used later carries nothing to defer.
        if (!ability || !isDeferrableStackAbility(ability)) return false;

        // (a) Pointless self-animation after the mover's own combat — issue
        // #1890 item 4, shared with the root tie-break.
        if (isPointlessSelfAnimation(state, pid, move)) return true;

        // (b) Sorcery-speed window: the mover is in ITS OWN sorcery window — a
        // main phase of its own turn, empty stack, holding priority (CR 307.5,
        // the template CR 602.5d's "activate only as a sorcery" points at).
        // There an instant-speed activation could instead be kept for a reactive
        // moment (the opponent's removal, a declared block); Mother of Runes'
        // protection spent in the precombat main with nothing to protect against
        // is the observed misplay.
        //
        // `isSorceryTimingFor` is the engine's single authority on that window
        // (`phases.ts`, already the gate `moves.ts` applies to `sorcerySpeedOnly`)
        // — re-deriving it here is how the two drift apart.
        //
        // The empty-stack clause inside it is load-bearing, not decoration: a
        // main phase with something ON the stack is already a RESPONSE window,
        // and that is exactly where an activation belongs (cracking a fetchland
        // in response to a trigger — the `blade` charter entry). Without it this
        // branch fired there too and turned the answer into a `pass`.
        if (isSorceryTimingFor(state, pid)) return true;

        // (c) Premature use before blocks (ADR 0021 slice 3, the same case the
        // `cast-spell` branch calls out): an activation that could ambush a
        // block is worse spent before blockers are declared.
        const combat = state.combat;
        return (
            pid === state.activePlayerId &&
            !!combat &&
            combat.confirmed &&
            !combat.blockersConfirmed &&
            combat.attackerIds.length > 0
        );
    }
    return false;
}

/** Whether `move` animates its own source (`ActivatedAbility.animatesSelf` — the
 *  manland marker the move enumerator already reads) at a point in `pid`'s OWN
 *  turn where the resulting body can no longer matter (issue #1890 item 4).
 *
 *  An `animatesSelf` ability buys a creature BODY and nothing else, so it is
 *  worth something only while that body can still attack or block. Once the
 *  mover is the ACTIVE player and the turn has reached `END_OF_COMBAT` or later,
 *  there is no attack left this turn (their combat is over — UNLESS CR 500.8
 *  says otherwise, see the `extraPhases` carve-out below) and an active player
 *  never blocks on their own turn; the animation only exposes a land to removal
 *  and combat damage. This is the observed "Mishra's Factory animated after its
 *  own combat" misplay, and the reason it wins on noise is that the saturating
 *  reward band cannot see that small negative.
 *
 *  Deliberately NOT expressed as a refinement of `ai/dominance.ts` (issue #1887).
 *  That module's contract is an EXACT-EQUALITY proof: a move is dropped only when
 *  applying it changes nothing but the mover's own cost. An animation genuinely
 *  changes the board — a land becomes a 2/2 — so calling it futile is a judgement
 *  about the remainder of the turn, not a proof. Admitting that reasoning there
 *  would regress the very property #1887 exists to hold, so it lives here, in the
 *  policy guardrail and the outcome-equality tie-break, where "probably not worth
 *  it" is the stated currency. Per-card-agnostic: the only inputs are the engine's
 *  `animatesSelf` marker, the phase, and who is active. Pure. */
function isPointlessSelfAnimation(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (move.kind !== "activate-ability") return false;
    if (pid !== state.activePlayerId) return false;
    if (
        state.phase !== "END_OF_COMBAT" &&
        state.phase !== "POSTCOMBAT_MAIN" &&
        state.phase !== "END_STEP"
    ) {
        return false;
    }
    // CR 500.8 (issue #2886) — "their combat is over" is FALSE at the
    // END_OF_COMBAT exit while an extra combat is still owed: `advancePhase`
    // pops `state.extraPhases` at exactly that exit and re-enters
    // BEGINNING_OF_COMBAT, so the body this activation buys does get an attack
    // after all. POSTCOMBAT_MAIN / END_STEP keep the original reading — the
    // queue is ONLY ever consumed at the END_OF_COMBAT exit, so an entry still
    // sitting there once the turn is past it is dead (`advanceTurn` discards
    // it) and the animation is as pointless as it ever was.
    if (state.phase === "END_OF_COMBAT" && state.extraPhases?.length) {
        return false;
    }
    const source = findPermanentOnBattlefield(state, move.cardInstanceId);
    if (!source) return false;
    return effectiveAbilityOf(source, move.abilityId)?.animatesSelf === true;
}

/** The permanent `instanceId` names, on either battlefield, or undefined. */
function findPermanentOnBattlefield(
    state: GameState,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === instanceId);
        if (found) return found;
    }
    return undefined;
}

/** The card an `activate-ability` move names, in whichever zone the ability
 *  functions from (CR 113.6):
 *
 *    * a BATTLEFIELD permanent, on EITHER battlefield (CR 113.3c — "any player
 *      may activate" is enumerated off the opponent's board),
 *    * a GRAVEYARD card, for an ability that opts into functioning there
 *      (CR 702.129a — Ashen Ghoul, Eternalize), and
 *    * a HAND card, for an `activateFromHand` ability (CR 702.29a — Cycling,
 *      Harvester of Misery; CR 702.49a — Ninjutsu).
 *
 *  The hand branch became LIVE in issue #2390, which gave
 *  `enumerateAbilityMoves` the hand scan it had never had; until then it
 *  existed for symmetry only. It was previously omitted
 *  on the grounds that pushing a hand-source ability would put an item on the
 *  stack while its `discardThis` cost went unpaid — true when it was written,
 *  and no longer: `applyActivationCostsForSearch` pays that leg (issue #1920
 *  review, finding 2). Cost and push now cover the same three zones, which is
 *  the invariant worth holding — a zone one of them knows about and the other
 *  does not is exactly how an ability gets resolved for free. */
function findActivationSource(
    state: GameState,
    instanceId: string
): CardInstanceState | undefined {
    const permanent = findPermanentOnBattlefield(state, instanceId);
    if (permanent) return permanent;
    for (const p of state.players) {
        const found = p.graveyard.find((c) => c.id === instanceId);
        if (found) return found;
    }
    for (const p of state.players) {
        const found = p.hand.find((c) => c.id === instanceId);
        if (found) return found;
    }
    return undefined;
}

/** The combat-aware leaf value the rollout policy scores a probed move on, from
 *  `botId`'s view (ADR 0021 slice 2). Two reactive corrections over a plain
 *  `evaluate` of the post-move snapshot, both POLICY-only (the shared leaf
 *  magnitudes / reward band stay untouched):
 *
 *   * A cast spell only goes on the STACK in `applyMoveInSearch` — unresolved, so
 *     a pre-resolution leaf sees the card leave hand but never its effect, and a
 *     1-ply policy would never value a removal / answer. The policy looks one
 *     resolution deep so it can SEE the effect: a kill makes casting pay, while a
 *     no-payoff trick (a temporary buff, excluded from material) still scores
 *     below holding. An ACTIVATED ability is the same object since issue #1920
 *     (it now reaches the stack too), so it gets the same one-resolution
 *     lookahead: without it a ping deals no damage and a protection grants
 *     nothing at this depth, every activation is pure cost, and the board-side
 *     flexibility term would price an option the policy can never see spent.
 *     A resolution that SUSPENDS on a mid-resolution choice (CR 608.2 / 101.4)
 *     leaves the item on the stack and the choice queued, and issue #3293
 *     measured what scoring it there costs: the probe sees "the creature has
 *     ENTERED" without "and is then sacrificed", because the sacrifice is a
 *     later Op of the same resolution. So a suspended resolution is now SETTLED
 *     first (`settleStackForBreakdown`, issue #3194's seam — it answers only
 *     choices the mover itself owns), and only when the probe can finish it in
 *     ISOLATION: the suspended item must be the sole thing on the stack. With
 *     another announcement underneath, finishing this one either resolves that
 *     announcement too — which prices the move against a board it did not cause
 *     — or commits a choice whose right answer depends on it (Mother of Runes'
 *     colour pick under a Lightning Bolt is both at once, and both readings
 *     rank `pass` above an activation the policy must be neutral on,
 *     `activationTiming.bot.test.ts`, issue #1890). In that case the lookahead
 *     still sees no payoff, exactly as before, and the deeper tree answers the
 *     choice as an in-tree decision node.
 *   * A just-declared block is scored on the pre-damage snapshot, so every block
 *     assignment looks identical. `declaredBlockDelta` folds the actual exchange
 *     in so the policy can tell a sane block from a bad one (the attacker side
 *     already gets this from `evaluate`'s `declaredCombatDelta`, ADR 0020 §3).
 *
 *  Exposed as a named seam (like `selectRolloutMove` / `selectRootMove` /
 *  `isDiscouragedRolloutMove`) so the MARGIN between two candidates is
 *  assertable directly. A test that re-derived it — clone, apply, resolve,
 *  `evaluate` — would be asserting its own copy of the policy rather than the
 *  policy, and would stay green if this function stopped resolving. */
export function policyValue(
    probe: GameState,
    botId: string,
    move: Move,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
    moverId?: string
): number {
    return policyValueOfSettled(
        policyProbeState(probe, move, weights, moverId),
        botId,
        weights
    );
}

/** The SETTLED STATE half of `policyValue` (issue #3400) — the 1-ply probe
 *  itself: the one-resolution lookahead for a cast/activation, plus the
 *  mover-owned settle of a suspended resolution. Everything above the
 *  `evaluate` call, and nothing else.
 *
 *  Split out, rather than copied, because the Verdict → Eval Pair bridge
 *  (`ai/verdicts/`, PRD #3397) needs the STATE the policy scores, not the
 *  scalar it returns: a feature vector is a per-term breakdown of that state.
 *  A bridge that rebuilt the probe — clone, apply, resolve — would be reading
 *  its own copy of the policy and would stay green if this one stopped
 *  resolving, which is the exact reason `policyValue` was exposed as a seam in
 *  the first place. Mutates `probe` in place (`resolveTopOfStack`) and may
 *  return a DIFFERENT state than the argument (the settled branch), exactly as
 *  the inlined code did. */
export function policyProbeState(
    probe: GameState,
    move: Move,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
    moverId?: string
): GameState {
    if (
        (move.kind === "cast-spell" || move.kind === "activate-ability") &&
        probe.stack.length > 0
    ) {
        resolveTopOfStack(probe);
    }
    // Issue #3293 — a SUSPENDED resolution is not a ply boundary, and scoring
    // one is how the policy learns to want a body that is already dead.
    //
    // A `choice`/`mayPay` Op suspends its stack item mid-resolution (CR 608.2,
    // `resolutionStep`), so a state carrying a pending choice is one Op into an
    // effect whose LATER Ops are the ones that pay for it. Flash is the shape
    // that surfaced it: "put a creature onto the battlefield" has happened, the
    // "sacrifice it unless you pay" has not, so the 1-ply probe scores a free
    // creature — measured 234.5 against 233.95 for passing, on a line whose
    // settled value is −24. The greedy policy takes that bait at the choice
    // node AND, from the `pass` branch, casts the same spell later in the
    // rollout for the same reason, so passing never looks better either.
    //
    // Settling is only ever through a choice THIS mover owns
    // (`settleStackForBreakdown`, issue #3194 — the opponent's answer is not
    // the mover's to assume), bounded by `MAX_CHOICE_DEPTH` and the shared
    // branch-work budget, and it leaves a state with no pending choice exactly
    // as it was: a resolution that already completed has nothing to settle, so
    // every position that is not mid-resolution scores byte-identically.
    let settled = probe;
    // The settle applies to a resolution the probe can finish IN ISOLATION:
    // the suspended item is the only thing on the stack. That is the whole
    // shape this fix is for — the mover's own spell resolving with nothing
    // underneath it — and the restriction is what keeps the probe from pricing
    // a move against an announcement it did not cause. With another item below,
    // finishing this one either resolves the opponent's spell too (measured:
    // the policy then ranks `pass` above a Mother of Runes activation it must
    // be neutral on) or commits a choice whose right answer depends on that
    // spell resolving. Both are worse information than stopping.
    const suspendedItemId = probe.pendingChoices?.[0]?.stackItemId;
    const suspendedDepth =
        probe.stack.length === 1 && suspendedItemId === probe.stack[0].id
            ? 0
            : -1;
    if (moverId && suspendedDepth >= 0) {
        settled = settleStackForBreakdown(
            probe,
            moverId,
            weights,
            0,
            { left: MAX_CHOICE_BRANCH_WORK },
            // THIS resolution and its consequences, never the stack under it:
            // everything below the suspended item is somebody else's
            // announcement, and settling it would price this move against a
            // board the move did not cause.
            suspendedDepth
        );
    }
    return settled;
}

/** The SCORING half of `policyValue` (issue #3400): the leaf evaluation of an
 *  already-settled probe state, plus the two combat corrections the 1-ply
 *  policy applies on top of it. Takes the state `policyProbeState` produced.
 *
 *  Separate from the probe so the same settled state can be scored under
 *  SEVERAL weight vectors without re-running the resolution — what the Eval
 *  Pair feature vector does to read one unweighted unit count per fittable
 *  weight (`ai/verdicts/features.ts`). */
export function policyValueOfSettled(
    settled: GameState,
    botId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    let v = evaluate(settled, botId, weights);
    const combat = settled.combat;
    if (
        combat &&
        combat.confirmed &&
        !combat.blockersConfirmed &&
        combat.attackerIds.length > 0 &&
        hasCastableInstant(settled, settled.activePlayerId)
    ) {
        // Don't PRE-JUDGE the attacker's combat while the attacker holds a
        // castable trick (ADR 0021 slice 3): the held instant may swing the
        // exchange, and the competent line is to wait for blocks and respond.
        // `evaluate` folds in the pre-block predicted exchange (`declaredCombatDelta`,
        // ADR 0020 §3), which reads the attacker as walking into the block —
        // making the policy either dump the pump early or decline the bait.
        // Strip it so the policy holds priority and lets the actual combat (with
        // the trick) resolve downstream. Policy-only, so the shared leaf
        // magnitudes / reward band are untouched.
        v -= declaredCombatDelta(settled, botId, weights);
    }
    // Fold the declared block exchange in for ANY move taken at a confirmed,
    // pre-damage block — `declaredBlockDelta` reads effective P/T, so it covers
    // the block declaration itself AND a combat trick just cast in response (the
    // resolved pump is live this turn). No-op when no block is confirmed.
    //
    // `lethalUnblockedDelta` (issue #1489) reaches this sum EXACTLY ONCE, via
    // `evaluate` above: it is deliberately not inside `declaredBlockDelta`, so
    // this third consumer of the term cannot double it to ±2·WIN_SCORE.
    return v + declaredBlockDelta(settled, botId, weights);
}

/** The reactive-aware rollout DEFAULT POLICY (ADR 0021 slice 2, issue #222): the
 *  move maximizing the mover's combat-aware immediate reward (1-ply lookahead),
 *  with an RNG tie-break. Each candidate is probed on a clone so `state` is
 *  untouched. Three reactive properties, all soft (policy bias, never legality):
 *
 *    * holds a pure instant at sorcery speed when there is no payoff — the
 *      ADR 0020 §4 guardrail penalty plus the slice-1 flexibility term make
 *      dumping it score below passing;
 *    * casts a held instant in a reactive window when it pays — a removal /
 *      combat answer that improves the leaf wins on reward and is chosen;
 *    * makes the sane block — `policyValue` folds the declared block exchange in,
 *      so a profitable block out-scores a bad one or no block.
 *
 *  Exposed as a named seam (like `selectRootMove` / `isDiscouragedRolloutMove`)
 *  so it is unit-testable in isolation without running a full search.
 *  Deterministic given the `rng` stream. */
export function selectRolloutMove(
    state: GameState,
    pid: string,
    botId: string,
    moves: Move[],
    rng: () => number,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): Move {
    const moverIsBot = pid === botId;
    let bestScore = -Infinity;
    let best: Move[] = [];
    for (const move of moves) {
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, pid, move);
        // `policyValue` is from the bot's view; flip for the opponent so each
        // mover greedily maximizes ITS own reward (a competent opponent).
        const r = rewardFromValue(
            policyValue(probe, botId, move, weights, pid),
            weights
        );
        let moverReward = moverIsBot ? r : 1 - r;
        if (isDiscouragedRolloutMove(state, pid, move)) {
            moverReward -= weights.rolloutGuardrailPenalty;
        }
        // Setup-attack bonus (ADR 0021 slice 3): nudge the default policy to
        // ATTACK when it holds a castable trick, so the rollout actually plays
        // out the ambush instead of declining the bait. Small — it tips an
        // even-looking setup (an attacker that merely trades) without forcing a
        // clearly-losing one (a creature that just dies in the block), the
        // mirror of the pre-block guardrail.
        if (isAmbushSetupAttack(state, pid, move)) {
            moverReward += weights.rolloutGuardrailPenalty;
        }
        if (moverReward > bestScore) {
            bestScore = moverReward;
            best = [move];
        } else if (moverReward === bestScore) {
            best.push(move);
        }
    }
    return best[Math.floor(rng() * best.length)];
}

// ---------------------------------------------------------------------------
// One ISMCTS iteration
// ---------------------------------------------------------------------------

/** UCB1 selection score for `edge` (issue #2683: `weights.ucbC` is the SOLE
 *  source of the exploration constant — no `getSearchVariant()` read here;
 *  the caller already resolved the active vector once, at the top of the
 *  search, via `resolveEvalWeights`). */
function ucb1(edge: Edge, weights: EvalWeights): number {
    const exploit = edge.totalReward / edge.visits;
    const explore =
        weights.ucbC * Math.sqrt(Math.log(edge.avail) / edge.visits);
    return exploit + explore;
}

/** Whether `move` casts an instant-speed answer in a REACTIVE window — a combat
 *  step or the opponent's turn, i.e. anywhere but the mover's OWN main phase
 *  (the exact mirror of the ADR 0020 §4 sorcery-speed definition). These are the
 *  windows where holding a trick to respond pays. */
export function isReactiveInstantCast(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (move.kind !== "cast-spell") return false;
    const ownMain =
        pid === state.activePlayerId &&
        (state.phase === "PRECOMBAT_MAIN" || state.phase === "POSTCOMBAT_MAIN");
    if (ownMain) return false;
    const player = state.players.find((p) => p.id === pid);
    const card = player?.hand.find((c) => c.id === move.cardInstanceId);
    const cardId = (card?.card as { id?: string } | undefined)?.id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def) return false;
    return hasInstantSpeed({
        types: def.types,
        staticAbilities: def.staticAbilities ?? [],
    });
}

/** Whether `move` is a non-empty ATTACK by a mover that holds a castable instant
 *  — the SETUP half of the `hold → attack → opponent blocks → cast in response`
 *  line. The leaf scores such an attack on the pre-trick exchange (it can read
 *  as a creature walking into death), so without a nudge the tree never explores
 *  the attack and the reactive subtree behind it is unreachable. Gated on
 *  holding a live trick so it never fires on a plain empty-handed attack (e.g.
 *  the suicidal-chump episode stays correct). */
function isAmbushSetupAttack(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    return (
        move.kind === "declare-attackers" &&
        move.attackerIds.length > 0 &&
        hasCastableInstant(state, pid)
    );
}

/** Whether `move` is HOLDING PRIORITY (a pass) at a pre-block combat step while
 *  the active player has attackers declared and a castable instant in hand — the
 *  MIDDLE of the ambush line: wait for the opponent to commit blocks before
 *  spending the trick. The leaf scores waiting as if the un-pumped attacker just
 *  dies to the block, so the search would rather pump pre-emptively (forfeiting
 *  the ambush) than wait; this nudge keeps the wait explored so the block-step
 *  response behind it is reachable.
 *
 *  Second shape (issue #2248): holding priority in the mover's OWN main phase
 *  — no combat pending at all — while holding an affordable FLASH PERMANENT.
 *  The leaf scores the flash body only once it is ON the battlefield, so the
 *  "wait for the opponent's end step, cast it there, keep the option open in
 *  the meantime" line is otherwise never explored: nothing makes the tree
 *  prefer an unopened `pass` over the immediately-scoring `cast-spell`.
 *  Deliberately narrow — `hasCastableFlashPermanent`, not `hasCastableInstant`
 *  — so this does not turn into a general "consider passing on my own turn"
 *  bias: a hand with a plain instant, or no affordable flash card, or no mana
 *  open, does not qualify, and a `play-land` / `declare-attackers` edge is a
 *  DIFFERENT edge with its own UCB score entirely — this only adds `pass` to
 *  the set of branches the search bothers to explore, it never prefers `pass`
 *  over them (`reactivePrior` decays with visits and never enters
 *  `selectRootMove`).
 *
 *  The two shapes are phase-disjoint by construction, not by an ad-hoc
 *  ordering: `state.combat` is torn down at the END_OF_COMBAT step's exit
 *  (`endCombatStep`, `phases.ts`), so by the time `state.phase` reads
 *  `PRECOMBAT_MAIN`/`POSTCOMBAT_MAIN` there is no confirmed combat left to
 *  match the first branch — a position can satisfy at most one of the two
 *  `if`s below, never both and never neither incorrectly. */
function isReactiveHold(state: GameState, pid: string, move: Move): boolean {
    if (move.kind !== "pass") return false;
    if (pid !== state.activePlayerId) return false;
    const combat = state.combat;
    if (combat && combat.confirmed && !combat.blockersConfirmed) {
        if (combat.attackerIds.length > 0 && hasCastableInstant(state, pid)) {
            return true;
        }
    }
    const ownMain =
        state.phase === "PRECOMBAT_MAIN" || state.phase === "POSTCOMBAT_MAIN";
    if (!ownMain) return false;
    return hasCastableFlashPermanent(state, pid);
}

/** Soft progressive-bias prior added to an edge's UCB1 score (ADR 0021 slice 3,
 *  issue #223). It biases the search to EXPLORE the reactive line — the attack
 *  that BAITS a block, holding priority to WAIT for that block, and the
 *  instant-speed RESPONSE in its window — so the otherwise-too-sparse
 *  `hold → attack → block → respond` subtree accrues the visits its real value
 *  needs to surface. The
 *  bonus DECAYS as `REACTIVE_PRIOR_C / (1 + visits)`, so it can never dominate an
 *  edge's accumulated reward: a genuine no-payoff line is washed out once
 *  visited. Pure bias — NEVER a hard expansion rule, never a legality change.
 *  Zero for every other move. */
export function reactivePrior(
    state: GameState,
    pid: string,
    move: Move,
    visits: number,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    if (
        !isReactiveInstantCast(state, pid, move) &&
        !isAmbushSetupAttack(state, pid, move) &&
        !isReactiveHold(state, pid, move)
    ) {
        return 0;
    }
    return weights.reactivePriorC / (1 + visits);
}

/** Weight of a choice-node prior in UCB1 selection (PRD #1423, issue #1425;
 *  `weights.choicePriorC`, was `CHOICE_PRIOR_C`). Like `reactivePriorC` this
 *  is a DECAYING bias (`/(1 + visits)`), so an ordering hint can never outvote
 *  an edge's accumulated reward — a prior that ranked a candidate wrongly is
 *  washed out after a handful of visits. */
function choicePriorBonus(
    prior: number,
    visits: number,
    weights: EvalWeights
): number {
    return prior <= 0 ? 0 : (weights.choicePriorC * prior) / (1 + visits);
}

/** A move paired with the tree key it is stored under and its ordering prior.
 *
 *  The KEY is why this type exists. At a choice node the key is the candidate's
 *  STABLE IDENTITY (card names / choice semantics, never a per-world instance
 *  id, PRD #1423) — so the same semantic answer accumulates statistics across
 *  determinizations instead of splitting into a fresh edge per world. At an
 *  ordinary priority node it is `priorityMoveKey` — the historical structural
 *  `moveKey`, EXCEPT for a non-observer mover's hand-sourced card id, stabilized
 *  the same way (issue #1520) — with a zero prior. */
export type KeyedMove = { move: Move; key: string; prior: number };

/** Structural key for an ordinary priority move, stabilized against
 *  hidden-hand reshuffling for a NON-OBSERVER mover (issue #1520). Plain
 *  `moveKey` embeds every field verbatim, including `cardInstanceId` — stable
 *  for the SEARCHING bot's own moves (`determinize` never touches its own
 *  hand) but not for the OPPONENT: `determinizeOpponent` freely reshuffles
 *  which physical card object lands in the opponent's hand each iteration, so
 *  two functionally-identical duplicates (two copies of the same card) can
 *  supply a DIFFERENT id for the "same" semantic move across worlds —
 *  splitting one decision's statistics across determinizations exactly the
 *  way PRD #1423 already fixed for choice nodes. Swaps a hand-sourced
 *  `cardInstanceId` for the card's DEFINITION id — the invariant that
 *  actually identifies the semantic move; every other field (battlefield
 *  ids, mana taps, targets) is public and already world-stable, so it is
 *  left untouched. A no-op for the bot's own moves, and for any
 *  `cardInstanceId` that isn't sourced from `pid`'s hand (a battlefield
 *  permanent activating its own ability). Currently inert in live play (the
 *  production adapter fills the opponent's hidden zones with opaque
 *  placeholders that carry no real card identity to collapse — see
 *  `determinize.ts`'s production note) but load-bearing in CI/self-play,
 *  which searches over full-information states with real duplicate cards. */
function priorityMoveKey(
    state: GameState,
    pid: string,
    botId: string,
    move: Move
): string {
    if (pid === botId) return moveKey(move);
    if (
        move.kind !== "play-land" &&
        move.kind !== "cast-spell" &&
        move.kind !== "activate-ability"
    ) {
        return moveKey(move);
    }
    const player = state.players.find((p) => p.id === pid);
    const handCard = player?.hand.find((c) => c.id === move.cardInstanceId);
    const defId = handCard && (handCard.card as { id?: string }).id;
    if (!defId) return moveKey(move);
    return moveKey({ ...move, cardInstanceId: defId });
}

/** The keyed decision set for `pid` in `state`: the choice node's candidates
 *  when a choice is live, else the ordinary enumerated moves — deduplicated
 *  by key (issue #1520): stabilizing a hand-sourced id onto the shared card
 *  DEFINITION id can make two distinct duplicate-card moves collapse to the
 *  same key within one enumeration; keep the first (deterministic within
 *  this call) as the representative, since a duplicate's own id is
 *  interchangeable by construction. Exported as a test seam (mirrors
 *  `reactivePrior`/`isReactiveInstantCast` above) so the determinization
 *  statistics test can assert on tree keys without driving a full search. */
export function keyedMovesFor(
    state: GameState,
    pid: string,
    botId: string
): KeyedMove[] {
    const headChoice = state.pendingChoices?.[0];
    if (headChoice && headChoice.playerId === pid) {
        return choiceCandidates(state, headChoice) as ChoiceCandidate[];
    }
    const seen = new Set<string>();
    const keyed: KeyedMove[] = [];
    // NOT pruned (issue #1905 review finding 3). This runs at EVERY tree node
    // of every iteration; probing here cost 42.6% of a 300-iteration search's
    // wall clock — an iteration-budgeted search, so a straight ~1.75× think-time
    // regression. Dominance pruning happens ONCE, at the root
    // (`searchWithTrace`), and the root verdict is carried into the tree's root
    // layer as a deny-set — see `iterate`'s `prunedRootKeys`.
    for (const move of enumerateMoves(state, pid)) {
        const key = priorityMoveKey(state, pid, botId, move);
        if (seen.has(key)) continue;
        seen.add(key);
        keyed.push({ move, key, prior: 0 });
    }
    return keyed;
}

/** Floor under every normalised action prior (issue #2684). The rule is BIAS,
 *  NEVER DELETION: a candidate the policy ranks dead last still carries a
 *  strictly-positive prior, so its PUCT term still grows as `√(parentVisits)`
 *  and it is opened eventually — late, never removed. A hard top-K here (the
 *  obvious cheaper design, and what `choiceCandidates` does at a CHOICE node
 *  where the candidate set is semantically small) would cut exactly the lines
 *  a 1-ply policy is worst at: sacrifice-then-payoff and combo-piece-first,
 *  whose first move evaluates as a loss. 5% of the mass on the worst move is
 *  cheap insurance against that. */
const ACTION_PRIOR_FLOOR = 0.05;

/** Normalised action priors over `keyed`, one entry per tree key, summing to 1
 *  (issue #2684).
 *
 *  Three steps, in order:
 *
 *  1. RAW — `policyValue` on a probe clone per candidate, the same 1-ply
 *     lookahead `selectRolloutMove` uses, so the prior and the rollout default
 *     policy agree on what "good" means. Memoized into `cache` (a `Node`'s
 *     `policyValues` in the search proper), which is the only reason the knob
 *     is affordable at all — see `Node.policyValues`.
 *  2. MOVER PERSPECTIVE — `policyValue` is always from the BOT's view, so an
 *     opponent node's priors are the complement (`1 − r`), mirroring
 *     `selectRolloutMove`'s `moverIsBot ? r : 1 - r`. Without the flip the
 *     search would bias the opponent toward moves that help the bot.
 *  3. NORMALISE — min–max over the node's candidate set, then floored and
 *     rescaled to sum to 1. Min–max rather than a plain sum because the reward
 *     mapping compresses a whole main phase's worth of candidates into a narrow
 *     band around 0.5: dividing those by their sum yields a near-uniform prior
 *     that biases nothing. Min–max recovers the RANKING regardless of how
 *     compressed the band is, which is all a prior is for. A degenerate set
 *     (every candidate identical) falls back to uniform.
 *
 *  Exported as a test seam (like `reactivePrior` / `policyValue`) so the prior
 *  vector is assertable directly, with the same code path the search runs. */
export function computeActionPriors(
    state: GameState,
    pid: string,
    botId: string,
    keyed: KeyedMove[],
    weights: EvalWeights,
    cache?: Map<string, number>
): Map<string, number> {
    const moverIsBot = pid === botId;
    const scores: number[] = [];
    for (const k of keyed) {
        let raw = cache?.get(k.key);
        if (raw === undefined) {
            const probe = cloneGameState(state);
            applyMoveInSearch(probe, pid, k.move);
            raw = policyValue(probe, botId, k.move, weights, pid);
            cache?.set(k.key, raw);
        }
        const r = rewardFromValue(raw, weights);
        scores.push(moverIsBot ? r : 1 - r);
    }
    const out = new Map<string, number>();
    if (keyed.length === 0) return out;
    let min = Infinity;
    let max = -Infinity;
    for (const value of scores) {
        if (value < min) min = value;
        if (value > max) max = value;
    }
    const span = max - min;
    if (!(span > 1e-12)) {
        const uniform = 1 / keyed.length;
        for (const k of keyed) out.set(k.key, uniform);
        return out;
    }
    const floored: number[] = [];
    let total = 0;
    for (const value of scores) {
        const q =
            ACTION_PRIOR_FLOOR +
            (1 - ACTION_PRIOR_FLOOR) * ((value - min) / span);
        floored.push(q);
        total += q;
    }
    for (let i = 0; i < keyed.length; i++) {
        out.set(keyed[i].key, floored[i] / total);
    }
    return out;
}

/** The PUCT exploration term for one candidate (issue #2684):
 *  `c · prior · √(parentVisits) / (1 + childVisits)`, the AlphaZero form.
 *
 *  Unlike `reactivePrior` / `choicePriorBonus` — which decay as `1/(1+visits)`
 *  against a FIXED numerator and are therefore washed out after a handful of
 *  visits — this term's numerator grows with the parent's visit count, which is
 *  what guarantees a never-opened child is eventually opened no matter how low
 *  its prior. That guarantee is the whole reason the knob can bias without a
 *  beam. */
function puctBonus(
    prior: number,
    parentVisits: number,
    childVisits: number,
    config: ActionPriorConfig
): number {
    return (
        (config.c * prior * Math.sqrt(Math.max(parentVisits, 1))) /
        (1 + childVisits)
    );
}

/** One PUCT step at an ordinary priority node (issue #2684). Returns `true`
 *  when it EXPANDED a new child (and therefore already rolled out and
 *  backpropagated — the caller must return), `false` when it descended into an
 *  existing child (which it has pushed onto `path`).
 *
 *  The structural difference from the historical rule this replaces (only when
 *  the knob is on) is that opened and unopened children compete in ONE argmax.
 *  The old rule expands an untried child whenever one exists, so a node with 90
 *  legal moves burns its first 90 iterations opening them one at a time and no
 *  line is ever deepened inside a 400-iteration budget — the exact failure
 *  telemetry #1893 measured as a 19.7% search-decided share. Here an unopened
 *  child's estimate is FIRST-PLAY URGENCY — the node's own mean reward minus
 *  `config.fpu` — plus its PUCT bonus, so once one child looks good the search
 *  deepens it instead of mechanically opening the 40th sibling.
 *
 *  Determinism: every term is a pure function of the world, the tree and the
 *  resolved weights; ties fall to the first candidate in `keyed` order (the
 *  enumeration order), so no RNG is consumed here at all. The seeded stream is
 *  still the sole source of randomness in the search — it is simply not spent
 *  on the expansion pick the way `selectOpeningCandidate` spends it. */
function puctDescend(
    node: Node,
    world: GameState,
    pid: string,
    botId: string,
    keyed: KeyedMove[],
    path: Edge[],
    rng: () => number,
    weights: EvalWeights,
    config: ActionPriorConfig
): boolean {
    let cache = node.policyValues;
    if (!cache) {
        cache = new Map();
        node.policyValues = cache;
    }
    const priors = computeActionPriors(
        world,
        pid,
        botId,
        keyed,
        weights,
        cache
    );

    // Parent statistics for the PUCT numerator and the FPU baseline. Every
    // child of a node shares one mover, so their stored rewards are in one
    // perspective and the mean is meaningful. Children keyed by a move that is
    // illegal in THIS world still count — they are visits this node really
    // received, which is what `√(parentVisits)` is measuring.
    let parentVisits = 0;
    let parentReward = 0;
    for (const edge of node.children.values()) {
        parentVisits += edge.visits;
        parentReward += edge.totalReward;
    }
    // No child opened yet → no mean to discount, so the FPU baseline is a
    // constant across candidates and the pick reduces to the highest prior.
    const fpuValue =
        (parentVisits > 0 ? parentReward / parentVisits : 0) - config.fpu;

    let bestVal = -Infinity;
    let bestKeyed: KeyedMove | null = null;
    let bestEdge: Edge | null = null;
    for (const k of keyed) {
        const edge = node.children.get(k.key);
        const visits = edge?.visits ?? 0;
        // ISMCTS availability: this edge WAS available in this world. Bumped
        // BEFORE scoring, exactly as the historical selection loop does, so
        // `ucb1`'s `ln(avail)` reads the same count under either rule.
        if (edge) edge.avail += 1;
        // EXPLOIT: the edge's own mean, or FIRST-PLAY URGENCY — the node's own
        // mean minus `config.fpu` — for a child nobody has opened.
        //
        // EXPLORE: UCB1's `ucbC·√(ln avail / visits)` for an opened child, and
        // for an unopened one the SAME term evaluated at one visit, against the
        // node's total visits. That symmetry is the whole trick, and getting it
        // wrong is measurable: the first shape of this knob simply added the
        // PUCT term to `ucb1` and gave an unopened child no exploration term at
        // all, so it scored `parentMean − fpu` against an opened sibling's
        // `mean + ~2`, the node never widened past its first child, and four
        // blade `must` entries flipped (three to a bare `pass`). The second
        // shape swung the other way — PUCT REPLACING UCB1's term — and lost six,
        // because this evaluator's reward band is a few hundredths wide, so
        // exploitation cannot discriminate and cutting exploration just makes
        // the search re-derive its own 1-ply prior. Keeping UCB1's exploration
        // for both sides makes `fpu` what it is supposed to be: a small,
        // tunable reluctance to widen, not a widening ban.
        //
        // `choicePriorBonus` is deliberately absent: `k.prior` is 0 for every
        // ordinary priority move (`keyedMovesFor`), and a choice node never
        // reaches this function.
        const val =
            (edge
                ? ucb1(edge, weights)
                : fpuValue +
                  weights.ucbC *
                      Math.sqrt(Math.log(Math.max(parentVisits, 2)))) +
            puctBonus(priors.get(k.key) ?? 0, parentVisits, visits, config) +
            reactivePrior(world, pid, k.move, visits, weights);
        if (val > bestVal) {
            bestVal = val;
            bestKeyed = k;
            bestEdge = edge ?? null;
        }
    }

    // Apply THIS world's move for the selected key (see `iterate`'s note): an
    // edge is keyed by stable identity, so its stored move may name instances
    // from a different determinization.
    applyMoveInSearch(world, pid, bestKeyed!.move);
    if (bestEdge) {
        path.push(bestEdge);
        return false;
    }
    const opened: Edge = {
        move: bestKeyed!.move,
        key: bestKeyed!.key,
        mover: pid,
        node: newNode(),
        visits: 0,
        totalReward: 0,
        totalMargin: 0,
        avail: 1,
    };
    node.children.set(opened.key, opened);
    path.push(opened);
    backpropagate(path, rollout(world, botId, rng, weights), botId);
    return true;
}

/** Grow the tree by one iteration on a freshly-determinized world.
 *
 *  `prunedRootKeys` are the tree keys of the bot's provably-dominated root moves
 *  (issue #1887), proved ONCE by `searchWithTrace` against the real root state
 *  and reused here for every iteration. Applying them at depth 0 is what makes
 *  the prune bite: `selectRootMove` picks among the root's CHILD EDGES, so a
 *  dominated move merely missing from the root `moves` list would still be
 *  opened as a child, still collect visits, and still be selectable. Filtering
 *  the depth-0 candidate set removes it from the tree instead — the same
 *  outcome the old per-node probing bought, at 1/1682 of the probe cost
 *  (issue #1905 review finding 3). */
function iterate(
    root: Node,
    rootState: GameState,
    botId: string,
    rng: () => number,
    weights: EvalWeights,
    prunedRootKeys?: ReadonlySet<string>,
    actionPriors: ActionPriorConfig | null = null,
    deckKnowledge?: DeckKnowledgeBySeat,
    opponentModel: OpponentModel | null = null
): void {
    const world = determinize(
        rootState,
        botId,
        rng,
        deckKnowledge,
        opponentModel
    );
    const path: Edge[] = [];
    let node = root;

    for (let depth = 0; depth < MAX_TREE_DEPTH; depth++) {
        const pid = decidingPlayer(world);
        if (!pid) break;
        let keyed = keyedMovesFor(world, pid, botId);
        // Deny-set, never an allow-set, and never emptying: a world-specific
        // move the root enumeration never saw stays available, and `pass` is
        // never a dominance candidate so the floor always holds.
        if (depth === 0 && pid === botId && prunedRootKeys?.size) {
            const kept = keyed.filter((k) => !prunedRootKeys.has(k.key));
            if (kept.length > 0) keyed = kept;
        }
        if (keyed.length === 0) break;

        // PUCT on the ORDINARY action space (issue #2684) — variant-gated, so
        // production takes neither this branch nor any of its cost. A choice
        // node is left alone: its candidates already carry real priors from
        // `priorFor` and are already opened in prior order by
        // `selectOpeningCandidate`, and its candidate set is already top-K'd.
        const headChoice = world.pendingChoices?.[0];
        const atChoiceNode = !!headChoice && headChoice.playerId === pid;
        if (actionPriors && !atChoiceNode) {
            if (
                puctDescend(
                    node,
                    world,
                    pid,
                    botId,
                    keyed,
                    path,
                    rng,
                    weights,
                    actionPriors
                )
            ) {
                return; // expanded + rolled out
            }
            node = path[path.length - 1].node;
            continue;
        }

        const untried = keyed.filter((k) => !node.children.has(k.key));

        if (untried.length > 0) {
            // Open one unopened branch, then roll out from it. FIRST-PLAY
            // URGENCY (issue #1425): an unopened branch has no statistics, so
            // its prior IS its estimate — a choice node opens its candidates in
            // descending prior order. Priority nodes carry a zero prior and keep
            // the historical uniform-random expansion.
            const pick = selectOpeningCandidate(untried, rng)!;
            applyMoveInSearch(world, pid, pick.move);
            const edge: Edge = {
                move: pick.move,
                key: pick.key,
                mover: pid,
                node: newNode(),
                visits: 0,
                totalReward: 0,
                totalMargin: 0,
                avail: 1,
            };
            node.children.set(pick.key, edge);
            path.push(edge);
            backpropagate(path, rollout(world, botId, rng, weights), botId);
            return;
        }

        // All legal moves are in the tree: bump availability, then UCB-select.
        let bestEdge: Edge | null = null;
        let bestKeyed: KeyedMove | null = null;
        let bestVal = -Infinity;
        for (const k of keyed) {
            const edge = node.children.get(k.key)!;
            edge.avail += 1;
            const val =
                ucb1(edge, weights) +
                reactivePrior(world, pid, edge.move, edge.visits, weights) +
                choicePriorBonus(k.prior, edge.visits, weights);
            if (val > bestVal) {
                bestVal = val;
                bestEdge = edge;
                bestKeyed = k;
            }
        }
        // Apply THIS world's move for the selected key, not the move captured
        // when the edge was first opened: an edge is keyed by stable identity,
        // so its stored move may name instances from a different
        // determinization — true at a choice node AND, since issue #1520, at
        // an opponent priority node whose key stabilized a hand-sourced id.
        applyMoveInSearch(world, pid, bestKeyed!.move);
        path.push(bestEdge!);
        node = bestEdge!.node;
    }

    // Reached a terminal/at-depth leaf without expanding: score it as-is.
    backpropagate(path, scoreLeaf(world, botId, weights), botId);
}

/** Propagate a bot-perspective leaf along the visited edges, each edge storing
 *  it from ITS mover's perspective (bot keeps `r` / `margin`, opponent keeps the
 *  complement `1 − r` / `−margin`). */
function backpropagate(path: Edge[], leaf: Leaf, botId: string): void {
    for (const edge of path) {
        const forMover = edge.mover === botId;
        edge.visits += 1;
        edge.totalReward += forMover ? leaf.reward : 1 - leaf.reward;
        edge.totalMargin += forMover ? leaf.margin : -leaf.margin;
    }
}

// ---------------------------------------------------------------------------
// DecisionTrace (debug-only by-product of a search)
// ---------------------------------------------------------------------------

/** One root move the search weighed, with its tree statistics and the position
 *  it leads to. CLIENT-SIDE DEBUG ONLY — never affects the chosen move. */
export type CandidateTrace = {
    /** Human-readable move label (see `describeMove`). */
    label: string;
    move: Move;
    /** Times this root move was visited (the selection criterion). */
    visits: number;
    /** Mean stored reward in [0, 1], from the bot's perspective. */
    meanReward: number;
    /** Mean accumulated material margin (bot perspective), the saturation-proof
     *  tie-break (issue #138). Negative/low here next to a near-equal
     *  `meanReward` is the signature of a move that throws material away for no
     *  change in outcome — e.g. a suicidal chump attack. */
    meanMargin: number;
    /** ISMCTS availability count. */
    avail: number;
    /** Breakdown of the position this move leads to once its spell/ability has
     *  resolved, from the bot's perspective. The diagnostic field: two target
     *  choices whose `hand`/`power` terms are identical reveal an effect the
     *  search never simulated. When `unavailable` is true this is the
     *  UN-resolved root position instead (the probe couldn't apply the move —
     *  see `unavailable`). */
    eval: PositionBreakdown;
    /** True when `buildTrace` could not re-apply this edge's move to the root
     *  world (issue #1516): `rootMoveFor` falls back to the edge's
     *  determinization-captured move when its key no longer resolves against
     *  the root world, and that fallback can carry instance ids the root
     *  world doesn't have (e.g. an opponent-priority choice edge — the
     *  out-of-scope stable-key gap noted on issue #1516). Applying it then
     *  throws. `eval` is a fallback (the unresolved root position) rather than
     *  the real outcome — treat this candidate's `eval` as uninformative. */
    unavailable?: boolean;
};

/** What the Brain considered for a single decision. A read-only by-product of
 *  one `search`; building it neither consumes the search RNG nor changes the
 *  chosen move. Stays on the client (worker → main thread), never persisted. */
export type DecisionTrace = {
    botId: string;
    /** Label of the move the search ultimately chose. */
    chosen: string;
    /** Iterations actually completed before the loop stopped (renamed from
     *  the old bare `iterations` field, issue #2682 — `iterationsCompleted`
     *  reads unambiguously next to `iterationsRequested`, and the old name
     *  invited exactly the "well obviously it ran the whole budget" reading
     *  that turned out to be false in a real game: the wall clock, not the
     *  iteration cap, is usually what stops `medium`). */
    iterationsCompleted: number;
    /** The budget's target iteration count (`SearchBudget.iterations`, or the
     *  completed count itself when the budget left `iterations` unset). */
    iterationsRequested: number;
    /** Wall-clock milliseconds the search loop actually took. */
    elapsedMs: number;
    /** Which bound ended the loop. */
    stoppedBy: SearchStopReason;
    /** WHICH root rule settled the pick (issue #3388) — the same
     *  `RootDecisionMechanism` the decision-telemetry sink records, surfaced on
     *  the artifact a human actually reads. `"mean-reward"` / `"material-tiebreak"`
     *  mean the search's own argmax decided; anything else names the tie-break
     *  that OVERRODE it, which is the question a trace showing a higher-margin,
     *  higher-visit candidate losing cannot otherwise answer. */
    mechanism: RootDecisionMechanism;
    /** Every root candidate weighed, most-visited first. */
    candidates: CandidateTrace[];
};

/** Resolve `state`'s stack to a stable point so a one-shot eval breakdown
 *  reflects the position AFTER the bot's spell/ability resolves (not the instant
 *  it hits the stack).
 *
 *  It used to STOP at a mid-resolution choice, and that is the whole of issue
 *  #3194: a mode that takes no target and does all its work through
 *  resolution-time choices then probed on a state where its spell was still on
 *  the stack, so every caller below — the resolved-payoff term of the
 *  cast-variant ranking, the extra-turn credit, the wasted-mana hold, the trace
 *  breakdown — measured the COST of casting and none of the effect, and the
 *  variant was compared against siblings measured after a full resolution.
 *
 *  So a choice the MOVER itself owns is now answered rather than stopped at:
 *  the branches are the ones the search would consider at that choice node
 *  (`choiceCandidates`), each is settled recursively, and the one that leaves
 *  `moverId` with the best material margin is taken — the mover is the player
 *  who will make that choice, so its best branch is the outcome the
 *  announcement actually reaches. Bounded twice (`MAX_CHOICE_DEPTH` and the
 *  shared `MAX_CHOICE_BRANCH_WORK` budget), deterministic (candidate order,
 *  first-wins on ties), and unchanged for a choice owned by anyone ELSE — the
 *  opponent's answer is not the mover's to assume.
 *
 *  Without `moverId` the old stop-at-any-choice behaviour is kept verbatim.
 *  Returns the settled state, which may be a BRANCH rather than the argument;
 *  callers own their clone and must use the return value.
 *
 *  Exported (like `blockDeltaOf` and `buildTrace`) as a named seam: whether the
 *  probe resolves THROUGH a choice or stops at it is the whole of issue #3194,
 *  and a test that can only observe it through a whole search would be pinning
 *  rollout noise instead of the mechanism. */
export function settleStackForBreakdown(
    state: GameState,
    moverId?: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
    depth = 0,
    budget: { left: number } = { left: MAX_CHOICE_BRANCH_WORK },
    floorDepth = 0,
    report?: { complete: boolean }
): GameState {
    // Nothing owed: no clone, no work, byte-identical state back. This is the
    // overwhelmingly common case (every position that is not mid-resolution)
    // and it is what keeps the snapshot below off the hot path.
    if (!settleHasWork(state, floorDepth)) {
        if (report) report.complete = true;
        return state;
    }
    // Issue #3388 — the snapshot the BAIL path returns. A settle that cannot
    // finish leaves a state where the announcement's early Ops have been
    // applied and its LATER, paying Ops have not (the body is on the
    // battlefield, the sacrifice that pays for it has not happened), and every
    // caller below feeds what it gets straight to `evaluate`/`materialMargin`.
    // Scoring that partial state is strictly worse information than scoring the
    // un-resolved announcement: it is the announced cost with the payoff
    // deleted, which is precisely how a cast that pays reads as a blank card.
    // So a bail returns the position as it was AT ENTRY — the documented
    // pre-#3194 fallback, which `bestBranchThroughChoice` already took for a
    // null branch and the loop below silently did not.
    //
    // AT ENTRY is the exact limit, and it is worth stating (PR review finding
    // A1): this rewinds the SETTLE's own work, never the caller's. `policyValue`
    // resolves the top of the stack before it settles, and a rollout probing a
    // `resolution-choice` has already advanced the interpreter past the choice
    // in `applyMoveInSearch`, so a bail there still hands back a state one Op
    // into a resolution — the body on the battlefield, the sacrifice unrun.
    // Unchanged from before this issue, and not closable from inside here: the
    // caller owns the clone and the move that half-applied it.
    const before = cloneGameState(state);
    const settled = settleFrom(
        state,
        moverId,
        weights,
        depth,
        budget,
        floorDepth
    );
    if (report) report.complete = settled.complete;
    return settled.complete ? settled.state : before;
}

/** Is anything still owed to the resolution being settled?
 *
 *  Three kinds of owed work, and reading only the first is issue #3388: a stack
 *  item above the floor, a queued player CHOICE, or a half-made announcement
 *  (`pendingTarget` / `pendingCast` / `pendingActivation`). A choice does NOT
 *  imply a non-empty stack — CR 603.3b puts a simultaneous-trigger batch's
 *  ORDERING question to the player BEFORE the triggers go on the stack, so the
 *  sacrifice at the end of a cheat-into-play resolution empties the stack and
 *  immediately raises a `trigger-order` choice with `stack.length === 0`. A loop
 *  conditioned on the stack alone exits right there, and the triggers it exits
 *  on are the entire payoff of the line (three 5/5 tokens off a dies trigger),
 *  so the probe reads the spell as resolving to NOTHING.
 *
 *  The third arm exists so this predicate and `settleFrom` agree on the word
 *  "complete": the loop treats a half-made announcement as a bail, and without
 *  it the entry point's early-out would answer `complete: true` for the same
 *  state (PR review finding A3).
 *
 *  The choice arm is FLOOR-BLIND, deliberately and only safely while every
 *  caller passes `floorDepth: 0` (`policyValue` passes 0 or does not settle at
 *  all; every other call site takes the default). A trigger batch raised as the
 *  stack empties legitimately sits AT the floor, so the floor cannot gate it by
 *  depth — a non-zero floor would have to ask which stack item raised the
 *  choice instead, and there is no caller to measure that against today. */
function settleHasWork(state: GameState, floorDepth: number): boolean {
    return (
        state.stack.length > floorDepth ||
        (state.pendingChoices?.length ?? 0) > 0 ||
        !!state.pendingTarget ||
        !!state.pendingCast ||
        !!state.pendingActivation
    );
}

/** The settle proper: mutates `state`, and says whether it got to the end.
 *
 *  `complete` is the load-bearing half. `false` means the resolution was left
 *  PART-APPLIED — the depth cap, the branch-work budget, a choice owned by
 *  someone else, an answer kind no generator could build, or a throw — and a
 *  part-applied state is not a position: it is the cost of an announcement
 *  with its payoff still queued. Only `settleStackForBreakdown` may hand a
 *  state to a caller, and it hands back the snapshot when this is `false`. */
function settleFrom(
    state: GameState,
    moverId: string | undefined,
    weights: EvalWeights,
    depth: number,
    budget: { left: number },
    floorDepth: number
): { state: GameState; complete: boolean } {
    let guard = 0;
    while (guard++ < 16) {
        if (
            state.pendingTarget ||
            state.pendingCast ||
            state.pendingActivation
        ) {
            return { state, complete: false };
        }
        const head = state.pendingChoices?.[0];
        if (head) {
            if (
                !moverId ||
                head.playerId !== moverId ||
                depth >= MAX_CHOICE_DEPTH
            ) {
                return { state, complete: false };
            }
            const best = bestBranchThroughChoice(
                state,
                moverId,
                weights,
                depth,
                budget,
                floorDepth
            );
            if (!best) return { state, complete: false };
            return { state: best, complete: true };
        }
        // Issue #3293 — `floorDepth` bounds the settle to the items ABOVE a
        // given stack depth: the resolution that suspended, plus whatever it
        // puts on the stack on the way out (a dies trigger the sacrifice
        // fires), and never the announcements that were already underneath it.
        // Without the bound this drains the whole stack, so a probe finishing
        // the mover's own suspended ability would go on to resolve the
        // OPPONENT's spell sitting below — measured on Mother of Runes
        // activating under a Lightning Bolt: the activation branch had the Bolt
        // resolved against it while the `pass` branch (which suspends nothing,
        // so never settles at all) did not, and the policy then ranked `pass`
        // strictly above an activation it must be neutral on
        // (`activationTiming.bot.test.ts`, issue #1890). Zero — the default and
        // every pre-existing caller — is the old drain-the-stack behaviour.
        //
        // Reaching the floor with no choice queued is the SUCCESS exit: every
        // item this resolution put on the stack has resolved.
        if (state.stack.length <= floorDepth) return { state, complete: true };
        resolveTopOfStack(state);
        checkStateBasedActions(state);
    }
    // The iteration guard is a runaway bound, not an exit: a resolution still
    // owing work after 16 steps is unfinished like any other bail.
    return { state, complete: !settleHasWork(state, floorDepth) };
}

/** The settled branch of the head choice that leaves `moverId` best off, or
 *  `null` when none could be COMPLETELY settled (an unsupported answer kind, a
 *  throw, an exhausted work budget, or a branch that bails deeper down) — in
 *  which case the caller keeps the un-resolved state, exactly as before issue
 *  #3194.
 *
 *  A branch that bailed is skipped rather than scored (issue #3388). The argmax
 *  is over MATERIAL MARGIN, and a part-settled branch's margin is measured on a
 *  different quantity from a settled sibling's — the announcement's cost with
 *  its payoff still queued — so mixing the two makes the max fall to whichever
 *  branch happened to stop earliest. That is the same all-or-nothing argument
 *  the budget check below has always made, applied to the other way a branch
 *  can fail to finish. */
function bestBranchThroughChoice(
    state: GameState,
    moverId: string,
    weights: EvalWeights,
    depth: number,
    budget: { left: number },
    floorDepth = 0
): GameState | null {
    const head = state.pendingChoices?.[0];
    if (!head) return null;
    let best: GameState | null = null;
    let bestScore = -Infinity;
    for (const candidate of choiceCandidates(state, head)) {
        // All-or-nothing on the budget (never `break` with a partial argmax):
        // a later sibling that got no budget would be scored on its UNSETTLED
        // state, and the max would then be taken over unlike quantities,
        // biased toward whichever candidates the order happened to reach
        // first. Answering `null` keeps the caller on the un-resolved state,
        // which is at least one consistent measurement.
        if (budget.left-- <= 0) return null;
        const branch = cloneGameState(state);
        let settled: { state: GameState; complete: boolean };
        try {
            applyMoveInSearch(branch, moverId, candidate.move);
            settled = settleFrom(
                branch,
                moverId,
                weights,
                depth + 1,
                budget,
                floorDepth
            );
        } catch {
            continue;
        }
        if (!settled.complete) continue;
        const score = materialMargin(settled.state, moverId, weights);
        if (score > bestScore) {
            bestScore = score;
            best = settled.state;
        }
    }
    return best;
}

/** Build the DecisionTrace from the grown tree. Each candidate's eval breakdown
 *  re-applies the root move on a fresh clone of `rootState` and settles the
 *  stack — O(root children) clones, once, after the search has finished.
 *  Exported (like `blockDeltaOf`) as a named seam so the stale-fallback guard
 *  (issue #1516) is unit-testable against a hand-built tree, without needing a
 *  real search to land on the exact determinization mismatch. */
export function buildTrace(
    root: Node,
    rootState: GameState,
    botId: string,
    stats: SearchStats,
    chosen: Move,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
    mechanism: RootDecisionMechanism = "mean-reward"
): DecisionTrace {
    const candidates: CandidateTrace[] = [];
    for (const edge of root.children.values()) {
        // Same re-resolution the real pick uses (`rootMoveFor`): the stored move
        // may name instances from the determinization that opened the edge, and
        // applying those to the root world would probe (or label) a position the
        // bot could not actually reach.
        const move = rootMoveFor(edge, rootState);
        // Guard parity with the sibling probe (`botExtraTurnGrantDelta`, issue
        // #1516): `rootMoveFor` can still fall back to `edge.move` — captured in
        // a DIFFERENT determinization — when the edge's key no longer resolves
        // against the root world (e.g. an opponent-priority choice edge, the
        // stable-key gap noted out-of-scope on issue #1516). Applying such a
        // move here can throw (a pending-choice submit naming ids the root
        // world doesn't have). This trace is a client-side debug by-product of
        // an ALREADY-SUCCESSFUL search — it must never throw while reporting
        // it, so tolerate the probe failing and mark the edge `unavailable`
        // instead of letting the exception escape `searchWithTrace`.
        let probe = rootState;
        let unavailable = false;
        try {
            probe = cloneGameState(rootState);
            applyMoveInSearch(probe, botId, move);
            probe = settleStackForBreakdown(probe, botId, weights);
        } catch {
            probe = rootState;
            unavailable = true;
        }
        candidates.push({
            label: describeMove(move, rootState),
            move,
            visits: edge.visits,
            meanReward: edge.visits > 0 ? edge.totalReward / edge.visits : 0,
            meanMargin: edge.visits > 0 ? edge.totalMargin / edge.visits : 0,
            avail: edge.avail,
            eval: evaluateBreakdown(probe, botId, weights),
            ...(unavailable ? { unavailable: true } : {}),
        });
    }
    candidates.sort(
        (a, b) => b.visits - a.visits || b.meanReward - a.meanReward
    );
    return {
        botId,
        chosen: describeMove(chosen, rootState),
        iterationsCompleted: stats.iterationsCompleted,
        iterationsRequested: stats.iterationsRequested,
        elapsedMs: stats.elapsedMs,
        stoppedBy: stats.stoppedBy,
        mechanism,
        candidates,
    };
}

// `weights.visitTol` (issue #2683, was the module const `VISIT_TOL`): fraction
// of the top visit count within which two root moves count as "equally
// explored" (issue #138). UCB1's exploration term keeps near-equal candidates
// within a few percent of each other in visits, so the single most-visited
// move is effectively decided by rollout noise — which let a suicidal chump
// attack tie "no attacks". Among candidates this close in visits, the robust
// pick is the higher mean reward, where the (now non-saturating) material
// signal lives. Reduces to plain most-visited when one move is clearly
// dominant (the lethal/response cases keep their pick).
//
// `weights.outcomeEps` (was `OUTCOME_EPS`): two root moves count as the same
// OUTCOME when their mean rewards are within this band — they win/lose/stall
// about as often. Sits below the reward reserved per material point so a
// genuine win-probability difference still wins, while outcome-equal
// candidates fall through to the material tie-break.

/** Robust root selection (issue #138). UCB1 keeps near-equal candidates within a
 *  few percent of each other in visits, so picking the single most-visited move
 *  is decided by rollout noise. Instead: among moves within `VISIT_TOL` of the
 *  top visit count, keep those whose mean reward is within `OUTCOME_EPS` of the
 *  best (the outcome-equal set), then choose the one with the most surviving
 *  material (`totalMargin`). Outcome dominates; material — which never saturates
 *  — breaks the tie a free chump attack would otherwise win on noise. */
/** A declared attack that gains NOTHING: every attacker is fully absorbed (no
 *  blocker dies) and no damage reaches the defender's life. From a player's view
 *  there is no reason to make such an attack even with no risk of losing the
 *  attacker — a creature that attacks without vigilance taps out of defence, so a
 *  neutral attack is already a tempo loss (the only upside, bluffing a trick for
 *  free damage, the bot cannot represent). The check reuses `predictCombatOutcome`
 *  — the same sensible-defender prediction the leaf eval uses — on the post-attack
 *  state. `declare-attackers` is the active player's move (CR 508.1). */
export function isWastefulAttack(state: GameState, move: Move): boolean {
    if (move.kind !== "declare-attackers" || move.attackerIds.length === 0) {
        return false;
    }
    const attackerId = state.activePlayerId;
    const defender = state.players.find((p) => p.id !== attackerId);
    if (!defender) return false;
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, attackerId, move);
    const outcome = predictCombatOutcome(probe, attackerId, defender.id);
    return outcome.deadBlockerIds.length === 0 && outcome.faceDamage === 0;
}

/** Whether `move` is the EMPTY block declaration — the defender declining to
 *  block at all (CR 509.1: declaring no blockers is a legal declaration, not
 *  the absence of one). Structural, no card knowledge: the null baseline every
 *  `blockDeltaOf` reading is measured against. */
export function isEmptyBlockDeclaration(move: Move): boolean {
    return move.kind === "declare-blockers" && move.assignments.length === 0;
}

/** The defender's value of a specific declared block, from `botId`'s view: the
 *  `declaredBlockDelta` of the post-block state (kills gained − blockers lost −
 *  face taken, minus the cautious-block discount). The principled measure of a
 *  block's worth — a clean kill scores highest, a dominated over-commit (a double
 *  chump that loses two creatures to kill nothing) lowest. `declare-blockers` is
 *  the defender's move, i.e. `botId` itself at this decision.
 *
 *  Plus `lethalUnblockedDelta` (issue #1489), folded in HERE rather than inside
 *  `declaredBlockDelta`: this tie-break is the seam the term was measured
 *  against (the linear, lethality-blind life clause rates "take it and die"
 *  ABOVE "chump and live"), but `policyValue` above sums `evaluate` — which
 *  already carries the term — with `declaredBlockDelta`, so folding it into the
 *  latter would show the rollout default policy ±2·WIN_SCORE. Two seams, one
 *  count each. Exactly zero off-pattern, so every non-lethal block is ranked
 *  exactly as before.
 *
 *  Exported as a named seam so the tie-break lens is unit-testable in isolation. */
export function blockDeltaOf(
    state: GameState,
    move: Move,
    botId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    if (move.kind !== "declare-blockers") return -Infinity;
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, botId, move);
    return (
        declaredBlockDelta(probe, botId, weights) +
        lethalUnblockedDelta(probe, botId, weights)
    );
}

// --- Block quality under the opponent model (issue #2876) ------------------
//
// `blockDeltaOf` above is a pure reading of whatever state it is handed, and
// its `cautiousBlockPenalty` term (evaluate.ts, ADR 0021) asks the ATTACKER's
// hand what it could cast this combat. That makes the state it is handed a
// correctness question, not a convenience: `selectRootMove`'s block-quality
// tie-break used to hand it the REAL root position, which on the wire carries
// opaque placeholders for the opponent's hand (`determinize.ts`'s production
// note). Every hidden-information improvement the search has — the imagined
// hand, the Unseen Remainder, Deck Knowledge (issue #2789) — is produced by
// `determinize` and consumed by the tree and the rollouts; a tie-break reading
// the root position instead sees an attacker holding NOTHING castable, so it
// weighs a block as if no trick existed and the Brain blocks into the pump its
// own opponent model had every means to predict. (The attack side never had
// this gap: an attack root leaves the decision to the tree, which does see the
// sampled worlds — the #2789 blade pair says so in as many words.)
//
// The fix is a lens, not a new sampler: `determinize` is already correct and
// unchanged, and the gap is the consumer. The tie-break asks this lens for a
// move's block delta and gets the MEAN over `BLOCK_WORLD_SAMPLES` determinized
// worlds — the same worlds, from the same sampler, with the same deck
// knowledge the search itself was handed. A trick the opponent model says is
// there is priced in every world and moves the mean by the full penalty; one
// it merely admits is priced in the fraction of worlds that deal it, which is
// exactly the hedge `blockCautionFraction` is documented to be.
//
// DETERMINISM (ADR 0070 §2). The worlds come from a SEPARATE stream,
// `makeRng(seed ^ BLOCK_LENS_SEED_SALT)`, never the search's own `rng`.
// Drawing from the search stream would shift every later determinization and
// silently re-roll every existing blade entry; a derived stream keeps a fixed
// seed reproducible while leaving every off-pattern decision byte-identical to
// what it was before this slice.
//
// COST, and its SHAPE. The determinizations are amortised once per decision;
// what is paid per CONTENDER block edge is `weights.blockWorldSamples` calls
// to `blockDeltaOf` instead of one. MEASURED on this machine, per decision, at
// a 400-iteration budget: the blade pair's board (2 candidate declarations)
// costs 1.6 ms against a 433 ms decision, 0.4%; a deliberately wide board (4
// attackers into 4 blockers, 64 enumerated declarations, EVERY one asked)
// costs 54.8 ms against 547 ms, 10.0% — 11.9x the 4.6 ms the pre-#2876 root
// pass paid over the same 64. Off-pattern it is exactly zero: the worlds are
// built LAZILY, on the first move the lens is asked about, and each move's
// mean is memoised by `moveKey`, so every non-combat root — and every block
// root the search settles before the tie-break — allocates no world at all.

/** Salt for the lens's derived RNG stream — any fixed constant works; what
 *  matters is that it is NOT the search's stream (see the note above). */
const BLOCK_LENS_SEED_SALT = 0x2876;

/** The block-quality tie-break's reading of a candidate block. */
export type BlockDeltaLens = (move: Move) => number;

/** Build a `blockDeltaOf` lens that reads DETERMINIZED worlds rather than the
 *  root position (issue #2876). Pure apart from its own memo; the returned
 *  closure is single-decision-scoped, so the memo can never outlive the
 *  position the worlds were sampled from.
 *
 *  Exported as a named seam so the lens is unit-testable without driving a
 *  full search — and so a test can prove the mean MOVES when the opponent
 *  model changes, which is the whole property this slice adds. */
export function makeBlockDeltaLens(
    rootState: GameState,
    botId: string,
    seed: number,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
    deckKnowledge?: DeckKnowledgeBySeat,
    // The ladder's information-REMOVAL arm (issue #2791). `iterate` hands it
    // to `determinize` for the tree's worlds, and the lens MUST sample under
    // the same model: a `blind` variant whose block tie-break kept sampling
    // informed worlds would stop being blind at exactly the seam this lens
    // makes decisive, and every informed-vs-blind number measured through it
    // would be contaminated.
    opponentModel: OpponentModel | null = null
): BlockDeltaLens {
    let worlds: GameState[] | null = null;
    const memo = new Map<string, number>();
    return (move: Move): number => {
        const key = moveKey(move);
        const hit = memo.get(key);
        if (hit !== undefined) return hit;
        if (!worlds) {
            const rng = makeRng(seed ^ BLOCK_LENS_SEED_SALT);
            worlds = Array.from({ length: weights.blockWorldSamples }, () =>
                determinize(rootState, botId, rng, deckKnowledge, opponentModel)
            );
        }
        const mean =
            worlds.reduce(
                (sum, world) => sum + blockDeltaOf(world, move, botId, weights),
                0
            ) / worlds.length;
        memo.set(key, mean);
        return mean;
    };
}

// --- Extra-turn structural credit (issue #244) -----------------------------
// An extra turn's value is "washed out" of the rollout: ADR 0015 terminates
// each rollout at the START of the bot's next turn, and the `extraTurns` queue
// (CR 500.7) is popped at that very turn crossing (phases.ts) — so the granted
// turn is never played out, and a leaf-eval term keyed on `extraTurns` would
// read an already-emptied queue. The value therefore never reaches the root
// edge's mean reward, and the move is BOTH low-reward and under-visited.
//
// Mirror the combat-eval-washed fix: encode the missing value as a STRUCTURAL
// credit at root selection (like the wasteful-attack / hold-trick tie-breaks),
// not a leaf-eval term. The credit is keyed on the EFFECT — a move whose
// resolution adds the bot to `extraTurns` — NOT on a per-card list, so it
// generalises to every legally-castable extra-turn source (Time Walk, Temporal
// Manipulation, …) rather than being the Forge-style per-card valuation we
// rejected. (Activated-ability extra turns, e.g. Time Vault, are out of reach
// here: `applyMoveInSearch` does not put an activated ability's effect on the
// stack, so the probe below sees no grant — a known search-model limit.)
//
// Magnitude is a material-units (ADR 0018) estimate of what an extra turn buys:
// a drawn card + a fresh untap/main phase of tempo + an extra combat. Mapped
// through the SAME open-band transform `rewardFromValue` uses, so the credit
// adds to a stored mean reward (the [0,1] band) on a consistent scale. Tuned
// with the self-play harness (issue #244). `weights.extraTurnValue` (issue
// #2683, was the module const `EXTRA_TURN_VALUE`): ≈ draw (150) + untap/main
// tempo (50) + combat (150).

/** How many extra turns `move` grants `botId` once it resolves (0 if none).
 *  Effect-keyed: clones `state`, applies the move, settles the stack (the same
 *  proven probe `buildTrace` uses), and measures the growth of `botId`'s entries
 *  in `extraTurns` (CR 500.7). Reads the resolved effect, not the card identity,
 *  so it covers any extra-turn spell without a per-card table. */
function botExtraTurnGrantDelta(
    state: GameState,
    move: Move,
    botId: string,
    weights: EvalWeights
): number {
    // Only a resolving spell can add to `extraTurns` in the search effect model.
    if (move.kind !== "cast-spell") return 0;
    const before = (state.extraTurns ?? []).filter((id) => id === botId).length;
    const probe = cloneGameState(state);
    let settled: GameState;
    // Defensive: this probe runs on EVERY root edge during selection. Casting and
    // resolving an arbitrary spell on the clone can throw (e.g. a targeted spell
    // whose move carries no usable target). A throw means no extra-turn grant was
    // realised — treat it as zero rather than letting it break root selection.
    try {
        applyMoveInSearch(probe, botId, move);
        settled = settleStackForBreakdown(probe, botId, weights);
    } catch {
        return 0;
    }
    const after = (settled.extraTurns ?? []).filter(
        (id) => id === botId
    ).length;
    return after - before;
}

/** The structural reward credit (in stored-mean-reward [0,1] units) for a move
 *  that grants the bot extra turns, or 0. Each granted turn is worth
 *  `EXTRA_TURN_VALUE` material-units, mapped through the open band exactly as
 *  `rewardFromValue` maps the material signal — so the credit is "as if the bot
 *  had that much extra surviving material". */
function extraTurnRewardCredit(
    state: GameState,
    move: Move,
    botId: string,
    weights: EvalWeights
): number {
    const grants = botExtraTurnGrantDelta(state, move, botId, weights);
    if (grants <= 0) return 0;
    return (
        (1 - 2 * weights.terminalBand) *
        0.5 *
        materialSignal(grants * weights.extraTurnValue, weights)
    );
}

/** Whether `move` casts a FREE MANA SOURCE — a zero-mana-cost spell that is
 *  itself a mana source (a Mox, Black Lotus, a 0-cost mana artifact). Like a
 *  land (the land-drop tie-break, ADR 0020 §1), such a card has NO option cost
 *  in this engine — there is no bluff or hidden-information value to holding it,
 *  and it costs nothing to play — so deferring it is never right. Its board /
 *  mana development washes out of the rollout exactly as a land drop does, so
 *  `pass` can win the material tie-break on noise (issue: bot prefers `pass`
 *  over `cast Mox Jet`). Effect-keyed (cost 0 + mana ability), NOT a per-card
 *  list, so it covers every free mana source. `caster` is `botId` when known,
 *  else the active player (a 0-cost artifact is cast at sorcery speed). Pure. */
function isFreeManaSourceCast(
    state: GameState,
    move: Move,
    botId?: string
): boolean {
    if (move.kind !== "cast-spell") return false;
    const casterId = botId ?? state.activePlayerId;
    const caster = state.players.find((p) => p.id === casterId);
    const card = caster?.hand.find((c) => c.id === move.cardInstanceId);
    if (!card) return false;
    return manaValue(getInstanceManaCost(card)) === 0 && hasManaAbility(card);
}

/** Whether `move` casts a MANA DORK — a creature with a mana ability (Birds of
 *  Paradise, Llanowar Elves, a Mox-on-legs). The creature analog of the free
 *  mana source above: it develops a mana source / ramps, and a sorcery-speed
 *  creature carries NO instant-speed option value to holding (unlike a held
 *  trick), so deferring it when outcome-equal is never right. Its body + ramp
 *  is realized material that washes out of the rollout horizon, so `pass` can
 *  win the material tie-break on noise (issue: bot sat on Birds of Paradise on
 *  an empty board with a Mox down rather than casting it). Unlike
 *  `isFreeManaSourceCast` the dork costs mana (MV ≥ 1), so it joins the
 *  free-development tie-break only — it is NOT "free" in the literal sense, but
 *  shares the no-option-cost-to-holding rationale. `caster` is `botId` when
 *  known, else the active player. Pure. */
function isManaDorkCast(state: GameState, move: Move, botId?: string): boolean {
    if (move.kind !== "cast-spell") return false;
    const casterId = botId ?? state.activePlayerId;
    const caster = state.players.find((p) => p.id === casterId);
    const card = caster?.hand.find((c) => c.id === move.cardInstanceId);
    if (!card) return false;
    return isCreature(card) && hasManaAbility(card);
}

// --- Self-harm removal guard (issue #365) ----------------------------------
// A one-sided removal / destruction Spell (Disenchant, Swords to Plowshares,
// any `destroy-target` effect) aimed at the caster's OWN beneficial Permanent
// is pure self-harm: the bot loses a useful Permanent for no upside. The leaf
// eval now values non-creature beneficial Permanents (evaluate.ts, issue #365),
// so destroying one DOES register as a material loss — but a thin loss can still
// be buried under rollout noise inside `OUTCOME_EPS`, leaving the self-targeted
// cast outcome-equal with `pass` (the reported trace: destroy-own-Castle at
// meanMargin ~89 vs pass ~87). Legal-target enumeration correctly keeps own
// Permanents (rules-correct, CR 115.4); the friendly-vs-enemy preference is a
// SCORING / SELECTION concern handled here, NOT a legality change.

/** Whether `move` casts a Spell whose targets are all on the CASTER's own
 *  battlefield (every target is a Permanent the bot controls). A no-target or
 *  player-targeting cast returns false. Pure read of `state`. */
function targetsOnlyOwnPermanents(
    state: GameState,
    move: Move,
    botId: string
): boolean {
    if (move.kind !== "cast-spell" || move.targets.length === 0) return false;
    const me = state.players.find((p) => p.id === botId);
    if (!me) return false;
    return move.targets.every((t) => me.battlefield.some((c) => c.id === t.id));
}

/** The change in the bot's own material margin caused by RESOLVING `move`, from
 *  `botId`'s view (negative = the bot is worse off). Probes on a clone exactly
 *  as `botExtraTurnGrantDelta` / `buildTrace` do: apply the move, settle the
 *  stack, and diff `materialMargin` before vs after. Used to detect a cast that
 *  only harms the bot's own board (a self-targeted removal). A throw means the
 *  resolution could not be simulated — treat as no measurable change (0). */
function resolvedMarginDelta(
    state: GameState,
    move: Move,
    botId: string,
    weights: EvalWeights
): number {
    const before = materialMargin(state, botId, weights);
    const probe = cloneGameState(state);
    let settled: GameState;
    try {
        applyMoveInSearch(probe, botId, move);
        settled = settleStackForBreakdown(probe, botId, weights);
    } catch {
        return 0;
    }
    return materialMargin(settled, botId, weights) - before;
}

/** Total floating mana `playerId` holds: the fungible pool plus every
 *  restricted unit (CR 106.4 / 106.6 — Metamorphosis' "spend only to cast
 *  creature spells" mana lives in `restrictedMana`, not `manaPool`). */
function floatingManaOf(state: GameState, playerId: string): number {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return 0;
    let total = 0;
    for (const amount of Object.values(player.manaPool)) total += amount ?? 0;
    for (const unit of player.restrictedMana ?? []) total += unit.amount;
    return total;
}

/** Whether resolving `move` leaves the bot holding floating mana that NOTHING
 *  in the resulting position can spend before it empties (CR 106.4 — unused
 *  mana is lost as the step ends).
 *
 *  Effect-keyed, never card-keyed: the probe asks the position itself whether
 *  a spender exists (any legal cast or activation), so it covers a ritual cast
 *  with an empty hand, Metamorphosis' creature-only mana with no creature
 *  spell to pay for, and anything else shaped like them — and it stops firing
 *  the moment a spender is in hand, which is precisely when the ritual line is
 *  the right play.
 *
 *  Fail-closed at every step: a resolution the sandbox cannot simulate, a
 *  cast that produced no mana at all, or a window the bot does not itself own
 *  all answer `false`, leaving the pick to the ordinary tie-breaks. */
function isWastedManaCast(
    state: GameState,
    move: Move,
    botId: string,
    weights: EvalWeights
): boolean {
    if (move.kind !== "cast-spell") return false;
    const before = floatingManaOf(state, botId);
    let probe = cloneGameState(state);
    try {
        applyMoveInSearch(probe, botId, move);
        probe = settleStackForBreakdown(probe, botId, weights);
    } catch {
        return false;
    }
    // The cast has to have PRODUCED mana — an ordinary spell that merely taps
    // its cost out leaves the pool no fuller than it found it.
    if (floatingManaOf(probe, botId) <= before) return false;
    // CR 117.3c / 601.3a — `enumerateMoves` answers for the player HOLDING
    // priority, and the sandbox leaves it with the opponent (given the window
    // to respond to the spell this probe then resolved past), so asking the bot
    // directly returns an empty list for the wrong reason. Hand priority back
    // so the question asked is the intended one: is there anything this player
    // could pay for with the mana it now holds? Timing legality is unaffected —
    // a sorcery-speed cast is gated on the ACTIVE player and an empty stack
    // inside the enumerator, never on this field.
    const spender = cloneGameState(probe);
    spender.priorityPlayerId = botId;
    const spending = enumerateMoves(spender, botId);
    // An empty list is the enumerator declining the window altogether, not
    // evidence about mana — fail closed.
    if (spending.length === 0) return false;
    return !spending.some(
        (m) => m.kind === "cast-spell" || m.kind === "activate-ability"
    );
}

/** Whether `move` is a SELF-HARM removal cast: it targets only the bot's own
 *  Permanents AND resolving it strictly lowers the bot's material margin (issue
 *  #365). Effect-keyed (the resolved margin drop), NOT a per-card list, so it
 *  covers Disenchant, Swords to Plowshares, and any future one-sided removal —
 *  while a beneficial self-target (a sacrifice-for-value, removing a liability)
 *  raises or holds the margin and is correctly NOT flagged.
 *
 *  Kept as the narrow HOLD trigger only (see the tie-break below). The
 *  friendly-vs-enemy REDIRECT it used to drive is now one term of the general
 *  `castVariantScore` (issue #1888), which also covers the beneficial mirror
 *  (an aura/ramp handed to the opponent) the margin can't see. */
function isSelfHarmRemovalCast(
    state: GameState,
    move: Move,
    botId: string,
    weights: EvalWeights
): boolean {
    if (
        !targetsOnlyOwnPermanents(state, move, botId) &&
        // CAST-only, exactly as the tie-break comment below says this hold is
        // by construction — `targetsOnlyOwnPermanents` rejects every other move
        // kind, and the resolution-time widening (issue #3194) must not quietly
        // undo that. It measured: Mother of Runes' "{T}: target creature you
        // control gains protection from the colour of your choice" is the same
        // SHAPE as the mode this widening was written for — self-confined
        // reach, a mover-owned resolution choice, and a payoff the material
        // margin cannot see — and holding it is wrong. "Hold it for later" is a
        // spell-in-hand affordance; an on-board ability that only hurts the bot
        // loses on reward, not by being held.
        !(
            move.kind === "cast-spell" &&
            reachesOnlyOwnSideThroughChoice(state, move, botId)
        )
    ) {
        return false;
    }
    return resolvedMarginDelta(state, move, botId, weights) < 0;
}

/** The RESOLUTION-TIME twin of `targetsOnlyOwnPermanents` (issue #3194).
 *
 *  That precondition is target-keyed, and that is a blind spot with a whole
 *  card shape in it: a mode that declares NO target requirement at all and
 *  reaches permanents through a choice taken while it resolves (Vision Charm's
 *  "choose a land type and a basic land type") can only ever touch the mover's
 *  own board — and the guard cannot see it, because there is no target to
 *  inspect. Observed on turn 1 with the bot's sole Island as the only land on
 *  either battlefield: the mode could do nothing but re-type its own single
 *  blue source, and passing was free.
 *
 *  So the question is asked of the RESOLUTION instead of the announcement, and
 *  it is asked by `dominance.ts` — the module that already owns the probe, its
 *  normalization and its fail-closed compare (see `isSelfConfinedFutileMove`
 *  for the two quantifiers and for why a tutor, which reaches only the mover's
 *  own zones too, is NOT this shape). What is left here is the cheap gate: a
 *  card whose scripts and closures raise no resolution choice at all cannot be
 *  this shape, and answering from the definition costs one memoized walk
 *  instead of a clone-apply-settle on every cast the bot weighs.
 *
 *  Exported as a named seam: the discriminating pair this predicate draws
 *  (self-only position vs. the same mode against the opponent's lands) is
 *  deterministic here and only statistical at the root. */
export function reachesOnlyOwnSideThroughChoice(
    state: GameState,
    move: Move,
    botId: string
): boolean {
    if (move.kind !== "cast-spell" && move.kind !== "activate-ability") {
        return false;
    }
    if (!announcementCanSuspend(state, move, botId)) return false;
    return isSelfConfinedFutileMove(state, botId, move);
}

/** Memo for the static half of the gate above, keyed by card id: whether ANY
 *  resolution site on the definition raises a resolution-time choice. A pure
 *  function of the catalogue, so it is cached for the process, not per
 *  decision. */
const SUSPENDING_DEFINITION = new Map<string, boolean>();

/** Cheap, static: can this announcement suspend on a resolution choice at all?
 *  `definitionChoiceDepth` reads the card's own scripts and closures, so a
 *  Lightning Bolt answers `false` without a single clone — which is what keeps
 *  the probe below off the common path (it used to run for every cast that was
 *  not self-targeted, the previously O(1) case). */
function announcementCanSuspend(
    state: GameState,
    move: Move,
    botId: string
): boolean {
    const player = state.players.find((p) => p.id === botId);
    if (!player) return false;
    if (move.kind !== "cast-spell" && move.kind !== "activate-ability") {
        return false;
    }
    const instance =
        move.kind === "cast-spell"
            ? player.hand.find((c) => c.id === move.cardInstanceId)
            : player.battlefield.find((c) => c.id === move.cardInstanceId);
    const cardId = (instance?.card as { id?: string } | undefined)?.id;
    if (!cardId) return false;
    const cached = SUSPENDING_DEFINITION.get(cardId);
    if (cached !== undefined) return cached;
    const def = tryGetDefinition(cardId);
    const verdict = def ? definitionChoiceDepth(def) > 0 : false;
    SUSPENDING_DEFINITION.set(cardId, verdict);
    return verdict;
}

// --- Cast-variant ranking (issue #1888, generalises issue #365) -------------
// `enumerateCastMoves` emits one Move per (mode × X × target-tuple), so every
// answer a spell's announcement asks for — which target, which X, which mode —
// arrives at the root as a SIBLING move of the same card. Nothing then ranked
// them: they saturate the reward band together, tie inside `OUTCOME_EPS`, and
// the pick falls to rollout noise. That is one bug with four faces (Wild Growth
// on the opponent's land, Flash of Insight at X = 0, a Vision Charm mode chosen
// by declaration order, the issue-#365 self-targeted removal).
//
// One score ranks them all, and it is deliberately two terms because the two
// signals are blind to different things:
//
//   * `resolvedMarginDelta` — the immediate, deterministic material payoff of
//     THIS variant, probed on a clone. Sees X (more cards drawn / more damage)
//     and mode (mill four vs. a land-type change that moves no material). Blind
//     to a payoff that accrues later.
//   * `misdirectedTargetCount` — the per-Op beneficence sign (`beneficence.ts`).
//     Sees exactly what the margin cannot: an aura whose mana accrues to the
//     HOST's controller is worth the same to the evaluator whichever land it
//     lands on, because the aura permanent is the bot's either way.
//
// The misdirection term is weighted to dominate: among outcome-equal variants
// of the SAME spell, a correctly-directed one is always preferred to a
// misdirected one, whatever the material noise between them. This is a
// PREFERENCE among already-legal, already-outcome-equal siblings — never a
// legality change, and never a suppression: a spell with no correctly-directed
// variant (a "target opponent draws" punisher, which can only point at the
// opponent) has no sibling to be redirected to and is cast unchanged.
// `weights.misdirectionWeight` (issue #2683, was the module const
// `MISDIRECTION_WEIGHT`).

/** Rank of one announcement variant for `botId`: resolved material payoff,
 *  minus a dominating penalty per misdirected target slot. Compared only
 *  against other variants of the SAME announcement, so the absolute scale is
 *  irrelevant. Both terms are move-kind-agnostic, so this ranks an activated
 *  ability's target tuples exactly as it ranks a cast's. */
function castVariantScore(
    state: GameState,
    move: Move,
    botId: string,
    weights: EvalWeights
): number {
    const payoff = resolvedMarginDelta(state, move, botId, weights);
    // Issue #3194 — the third term, and the one the resolved payoff cannot
    // carry on its own. A variant whose whole reach is the MOVER's own side
    // (`reachesOnlyOwnSideThroughChoice`) and which cannot improve the mover's
    // margin on any branch it may choose is worth exactly its cost: it is the
    // announcement's own "do nothing" option, dressed as a mode. Left unranked
    // it TIES with a sibling that reaches the opponent — both read as pure cost
    // whenever the evaluator is blind to what the effect does (a subtype change
    // moves no material at all) — and the pick falls to rollout noise, which is
    // how a self-only re-type of the bot's sole mana source got cast on turn 1.
    // Weighted like a misdirected slot, and for the same reason: among
    // outcome-equal siblings of ONE announcement, the one that can only act on
    // the mover's own board loses to the one that can act on the opponent's,
    // whatever the material noise between them. A variant that reaches the
    // opponent on even ONE branch is never penalised here, so the same mode
    // aimed at an opponent's lands stays a live candidate.
    const selfConfined =
        payoff <= 0 && reachesOnlyOwnSideThroughChoice(state, move, botId);
    return (
        payoff -
        weights.misdirectionWeight *
            (misdirectedTargetCount(state, move, botId) +
                (selfConfined ? 1 : 0))
    );
}

/** Whether `move` is a SIBLING VARIANT of `ref` — the same announcement with a
 *  different answer to one of the questions it asks (mode × X × target-tuple).
 *
 *  A cast's identity is its `cardInstanceId`; an activation's is that PLUS the
 *  `abilityId`, since one permanent's several abilities are genuinely different
 *  announcements, not variants of each other (Garruk's +1 and −1 must not be
 *  ranked against one another here — that is the search's job).
 *
 *  Mode is deliberately NOT required to match (issue #1888 item 4): a modal
 *  spell's modes are candidates to be ranked, not a partition. */
function isCastVariantOf(move: Move, ref: Move): boolean {
    if (move.kind !== ref.kind) return false;
    if (move.kind === "cast-spell" && ref.kind === "cast-spell") {
        return move.cardInstanceId === ref.cardInstanceId;
    }
    if (move.kind === "activate-ability" && ref.kind === "activate-ability") {
        return (
            move.cardInstanceId === ref.cardInstanceId &&
            move.abilityId === ref.abilityId
        );
    }
    return false;
}

/** The move an edge names in the ROOT world — the only world whose instance ids
 *  the caller may legally submit.
 *
 *  `edge.move` was captured in the determinization that OPENED the edge, and at
 *  a choice node the edge is keyed by STABLE IDENTITY (card names), not by those
 *  ids. For a search of a HIDDEN zone the ids therefore need not exist in the
 *  root world at all: `determinize` re-deals the opponent's hand↔library, so a
 *  `search-library` whose `zoneOwnerId` is the opponent (Jester's Cap,
 *  `ice/colorless.ts`) can have the winning edge's cards sitting in the
 *  opponent's HAND in the real state — an illegal submission. `iterate` already
 *  honours this on descent ("apply THIS world's move for the selected key"); so
 *  must the final root pick. Re-resolve the key against the root world's own
 *  candidate set and fall back to the stored move when the key no longer
 *  generates (a card genuinely gone from the real library). */
function rootMoveFor(edge: Edge, rootState?: GameState): Move {
    if (!rootState) return edge.move;
    const headChoice = rootState.pendingChoices?.[0];
    if (!headChoice || headChoice.playerId !== edge.mover) return edge.move;
    const match = choiceCandidates(rootState, headChoice).find(
        (c) => c.key === edge.key
    );
    return match?.move ?? edge.move;
}

/** The colour a `resolution-choice` move answers a PROTECTION colour-mode
 *  choice with — `headChoice.options[].protectionColor` (CR 702.16a,
 *  `protectionColorModes` only), looked up by the SINGLE submitted option id.
 *  `undefined` for a multi-id submission, an id with no colour tag (Primal
 *  Clay's body modes), an id resolving to no option at all, or — issue #2306
 *  review finding 1 — an option whose colour tag exists but is NOT a
 *  protection intent (`colorChoiceModes`/`COLOR_OPTIONS`'s "become a colour"
 *  family, deliberately out of scope: steering it by the opponent's shown
 *  colours is a directional INVERSION for a dodge-a-colour effect, not a
 *  refinement). Reads `.protectionColor`, never the bare `.color` UI tag both
 *  families set. */
function colorModeOfMove(
    move: Move,
    headChoice: PendingChoice
): Color | undefined {
    if (move.kind !== "resolution-choice") return undefined;
    if (move.cardInstanceIds.length !== 1) return undefined;
    return (headChoice.options ?? []).find(
        (o) => o.id === move.cardInstanceIds[0]
    )?.protectionColor;
}

/** Colour-mode tie-break (issue #2306). "Protection from the colour of your
 *  choice" (`protectionColorModes`) grants an UNTIL-END-OF-TURN ability, so
 *  its board effect is gone long before most rollouts reach a scored leaf —
 *  the same reason `evaluateCreature` deliberately excludes a combat trick
 *  from a creature's realized body. Absent an actual live threat to answer
 *  (in which case the real material difference already decides it well
 *  before any tie-break runs — CR 608.2b's fizzle IS a lasting board fact),
 *  every colour mode is therefore genuinely REWARD-TIED: `choicePriorBonus`
 *  (this file) only biases the search's OPENING order and decays too fast to
 *  hold a skewed visit allocation against UCB1's own exploration term
 *  (measured: ~40 visits each across 5 colour modes at `iterations: 200`,
 *  despite a 0.95-vs-0.05 prior split), so the material tie-break above ends
 *  up choosing among genuinely-tied edges on rollout noise unrelated to
 *  colour at all.
 *
 *  Mirrors `castVariantScore`'s ANNOUNCEMENT-VARIANT shape: pulled from the
 *  FULL `pool` on outcome-equality alone (never gated on the `VISIT_TOL`
 *  visit band — a decisively-favoured colour need not have won the visit
 *  race for this to fire), ranking outcome-equal colour-mode contenders by
 *  the SAME opponent-observed-colour evidence the prior itself reads
 *  (`observedOpponentColors`, `ai/observedColors.ts`) so the two can never
 *  disagree about which colour the position favours. Colourless (`"C"`) and
 *  a colour with NO evidence at all both score 0 — never preferred over an
 *  evidenced colour, but no worse than each other, so a no-evidence position
 *  falls through unchanged (any pick stays acceptable).
 *
 *  FLAT-EVIDENCE GUARD (review finding 3). A wide, even manabase (e.g. a
 *  five-colour board) can make every colour's SHARE tie at a positive value
 *  (`untappedProducibleColors` is a `Set`, so a 20-basic five-colour manabase
 *  yields `{W:1,U:1,B:1,R:1,G:1}` — five equal, positive shares). The winner
 *  must beat the RUNNER-UP strictly, not merely score `> 0`: on a tie the old
 *  `>` comparison silently kept `contenders[0]` — pool ITERATION order, not
 *  evidence — while still reporting `mechanism: "colour-mode-evidence"` to
 *  telemetry for a decision the evidence did not actually make. */
function colorModeTiebreak(
    rootState: GameState,
    pool: Edge[],
    bestMean: number,
    mean: (e: Edge) => number,
    weights: EvalWeights
): Edge | null {
    const headChoice = rootState.pendingChoices?.[0];
    if (!headChoice) return null;
    if (
        headChoice.kind !== "option-pick" &&
        headChoice.kind !== "trigger-mode"
    ) {
        return null;
    }
    const evidence = observedOpponentColors(
        rootState,
        getOpponentId(rootState, headChoice.playerId)
    );
    const total = Object.values(evidence).reduce((sum, n) => sum + (n ?? 0), 0);
    if (total <= 0) return null;
    const shareOf = (e: Edge): number => {
        const color = colorModeOfMove(e.move, headChoice);
        if (!color || color === "C") return 0;
        return (evidence[color] ?? 0) / total;
    };
    const contenders = pool.filter(
        (e) => mean(e) >= bestMean - weights.outcomeEps
    );
    if (contenders.length === 0) return null;
    // Track the top share AND the runner-up's, not just the top: a flat
    // manabase can put several contenders at the SAME positive share, and
    // that is a tie the evidence did not break — never pick iteration order.
    // Seeded from -Infinity (never from `contenders[0]`'s own share) so the
    // first element compared against ITSELF cannot masquerade as a tie.
    let winner: Edge | null = null;
    let topShare = -Infinity;
    let runnerUpShare = -Infinity;
    for (const e of contenders) {
        const share = shareOf(e);
        if (share > topShare) {
            runnerUpShare = topShare;
            topShare = share;
            winner = e;
        } else if (share > runnerUpShare) {
            runnerUpShare = share;
        }
    }
    return winner && topShare > 0 && topShare > runnerUpShare ? winner : null;
}

export function selectRootMove(
    root: Node,
    moves: Move[],
    rootState?: GameState,
    botId?: string,
    // Real per-decision iteration/time stats (issue #2682) — supplied only by
    // `runSearchWithTrace`, the sole caller that actually ran a search loop.
    // Every other call site (the whole rest of the test suite) hand-builds a
    // `Node`, so this stays optional and the telemetry record simply omits
    // the fields when absent.
    searchStats?: SearchStats,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
    // The block-quality tie-break's reading of a candidate block (issue
    // #2876). Supplied only by `runSearchWithTrace`, which owns the seed and
    // the deck knowledge the worlds are sampled with; absent everywhere else
    // (every test that hand-builds a `Node`), where the tie-break falls back
    // to reading `rootState` exactly as it did before. The fallback is not a
    // second opinion — a hand-built root has no sampler behind it at all.
    blockLens?: BlockDeltaLens,
    // Issue #3388 — the RULE that settled the pick, written back for the
    // DecisionTrace. The telemetry sink has always carried it, but a sink is
    // installed only by the corpus tooling, so the one artifact a human reads
    // when the bot does something inexplicable — the trace JSON the debug box
    // copies — could not say WHICH of a dozen root rules moved the pick. The
    // issue's own report is that gap: a cast with more visits and a higher
    // `meanMargin` than `pass`, and `pass` chosen, with nothing naming the
    // rule. Optional and write-only, so every existing caller is untouched.
    out?: { mechanism: RootDecisionMechanism },
    greedyMoveKey?: string,
    // Root rules turned OFF for this decision (issue #3399, the moratorium's
    // measuring instrument). Resolved once from the active `SearchVariant` at
    // the top of `runSearchWithTrace` and threaded here; the empty set is
    // production, and every caller that hand-builds a `Node` gets it by
    // default. A disabled rule is a NO-OP, never a different rule: the pick
    // falls through to whatever the stage before it held, which is exactly
    // what "is this rule inert?" has to measure.
    disabledRules: ReadonlySet<RootDecisionMechanism> = EMPTY_DISABLED_RULES
): Move {
    const pool = [...root.children.values()].filter((e) => e.visits > 0);
    if (pool.length === 0) return moves[0];

    const maxVisits = pool.reduce((m, e) => Math.max(m, e.visits), 0);
    const explored = pool.filter(
        (e) => e.visits >= maxVisits * (1 - weights.visitTol)
    );

    const mean = (e: Edge) => e.totalReward / e.visits;
    const meanMargin = (e: Edge) => e.totalMargin / e.visits;
    const bestMean = explored.reduce((m, e) => Math.max(m, mean(e)), -Infinity);
    const contenders = explored.filter(
        (e) => mean(e) >= bestMean - weights.outcomeEps
    );

    let best = contenders[0];
    for (const edge of contenders) {
        if (meanMargin(edge) > meanMargin(best)) best = edge;
    }

    // Decision telemetry (issue #1893, map #1892) — records HOW the final
    // pick was decided, never changes it. `mechanism` tracks the last rule
    // that CHANGED the selected edge; with a single `OUTCOME_EPS` contender
    // the search's own argmax decided, with several the material tie-break
    // did. `finish` is the single exit: it emits the record (only when a
    // sink is installed — live play pays a null check) and returns exactly
    // what every return site returned before, `rootMoveFor(edge, rootState)`.
    // The degenerate empty-pool return above is deliberately not recorded —
    // there was no decision to classify.
    const sink = getRootDecisionSink();
    const ruleOn = (m: RootDecisionMechanism) => !disabledRules.has(m);
    let mechanism: RootDecisionMechanism =
        contenders.length > 1 ? "material-tiebreak" : "mean-reward";
    // Did the mechanism currently attributed actually CHANGE the pick (issue
    // #3399)? For the material tie-break the stage before it is the search's
    // own argmax, so a flip is a pick sitting strictly BELOW `bestMean` —
    // reward traded away for margin. Two outcome-equal edges with the SAME
    // mean are not a change: the reward stage had no opinion between them,
    // and counting that as a flip would count the order `pool` was built in.
    // `mean-reward` has nothing before it and never flips.
    let flipped = contenders.length > 1 && mean(best) < bestMean;
    const finish = (
        edge: Edge,
        mech: RootDecisionMechanism,
        didFlip: boolean
    ): Move => {
        if (out) out.mechanism = mech;
        if (sink) {
            const meansDesc = explored
                .map((e) => mean(e))
                .sort((a, b) => b - a);
            const gapReward =
                meansDesc.length >= 2 ? meansDesc[0] - meansDesc[1] : null;
            sink({
                phase: rootState?.phase ?? "unknown",
                moveKind: edge.move.kind,
                choiceNode: (rootState?.pendingChoices?.length ?? 0) > 0,
                poolSize: pool.length,
                exploredSize: explored.length,
                contenderCount: contenders.length,
                bestMean,
                chosenMean: mean(edge),
                gapReward,
                gapMarginPoints:
                    gapReward === null
                        ? null
                        : gapReward / rewardPerMarginPoint(weights),
                chosenDeficitReward: bestMean - mean(edge),
                mechanism: mech,
                flipped: didFlip,
                pickIsMeanArgmax: mean(edge) === bestMean,
                ...(searchStats ?? {}),
                ...(greedyMoveKey === undefined
                    ? {}
                    : {
                          greedyMoveKey,
                          chosenMoveKey: moveKey(edge.move),
                          greedyAgrees: moveKey(edge.move) === greedyMoveKey,
                      }),
            });
        }
        return rootMoveFor(edge, rootState);
    };

    // Colour-mode tie-break (issue #2306) — see `colorModeTiebreak`'s own doc
    // comment for why a "protection from the colour of your choice" pick needs
    // one at all. Placed BEFORE every move-kind-specific tie-break below: it
    // only ever fires for a `resolution-choice` answering a colour-mode
    // choice, so it cannot collide with the attack/block/cast-variant rules
    // that follow, and firing early keeps this rule visible in `mechanism`
    // rather than silently overwritten by a later, unrelated pass.
    if (rootState && ruleOn("colour-mode-evidence")) {
        const colorPick = colorModeTiebreak(
            rootState,
            pool,
            bestMean,
            mean,
            weights
        );
        if (colorPick && colorPick !== best) {
            best = colorPick;
            mechanism = "colour-mode-evidence";
            flipped = true;
        }
    }

    // Extra-turn structural credit (issue #244). A granted extra turn is washed
    // out of the rollout (ADR 0015 horizon + `extraTurns` popped at the turn
    // crossing), so the move is BOTH low-reward and under-visited — it falls
    // outside the visit band, exactly like the land-drop / hold-trick lines. So
    // pull extra-turn grants from the FULL `pool` (not the visit band) and credit
    // them. When a credited grant out-scores the robust pick on credited mean,
    // cast it. Placed BEFORE the land-drop / hold-trick branches (which `return`
    // early on a `pass`/dump robust pick) so a winning Time Walk pre-empts them —
    // taking the extra turn beats developing a land or holding a trick.
    if (rootState && botId && ruleOn("extra-turn-credit")) {
        const creditCache = new Map<Edge, number>();
        const creditOf = (e: Edge) => {
            let c = creditCache.get(e);
            if (c === undefined) {
                c = extraTurnRewardCredit(rootState, e.move, botId, weights);
                creditCache.set(e, c);
            }
            return c;
        };
        const credited = (e: Edge) => mean(e) + creditOf(e);
        const grants = pool.filter((e) => creditOf(e) > 0);
        if (grants.length > 0) {
            const bestGrant = grants.reduce((m, e) =>
                credited(e) > credited(m) ? e : m
            );
            if (credited(bestGrant) > credited(best))
                return finish(
                    bestGrant,
                    "extra-turn-credit",
                    bestGrant !== best
                );
        }
    }

    // Wasteful-attack tie-break. The material tie-break above can pick a purely
    // neutral attack (fully absorbed, kills nothing, no face damage) over staying
    // back, because a survived attacker leaves board material unchanged and the
    // tiny realised differences are rollout noise within `OUTCOME_EPS`. Attacking
    // for an at-best-neutral result is strictly dominated by holding — the swing
    // taps a blocker out of defence for no gain. So when the robust pick is a
    // wasteful attack, drop it (and any other wasteful attack) and keep the
    // best-material contender that is NOT wasteful: a productive attack (deals
    // damage / kills) or simply staying back. Fires only among outcome-equal
    // contenders, so an attack with real value out-rewards the field and never
    // reaches here.
    if (
        rootState &&
        ruleOn("wasteful-attack") &&
        isWastefulAttack(rootState, best.move)
    ) {
        // Pull the alternative from the FULL pool on outcome-equality alone (not
        // the `VISIT_TOL` visit band), as the hold-trick rule does: staying back
        // is the lower-variance, lower-visit line, so UCB explores the neutral
        // swing more and pushes the defensive option out of the visit band even
        // when the two are outcome-equal. Among outcome-equal, NON-wasteful
        // alternatives, keep the best-material one.
        const productive = pool.filter(
            (e) =>
                mean(e) >= bestMean - weights.outcomeEps &&
                !isWastefulAttack(rootState, e.move)
        );
        if (productive.length > 0) {
            const prev = best;
            best = productive.reduce((m, e) =>
                meanMargin(e) > meanMargin(m) ? e : m
            );
            if (best !== prev) {
                mechanism = "wasteful-attack";
                flipped = true;
            }
        }
    }

    //
    // THE EMPTY DECLARATION IS ALWAYS A CONTENDER (issue #3086 fallout, the
    // #2147 life-dependent entry). Declining to block is not a rival block —
    // it is the BASELINE `blockDeltaOf` is defined against (kills gained minus
    // blockers lost minus face taken), so excluding it leaves the tie-break
    // ranking declared blocks against each other with the null option missing,
    // and the only survivor of "every block here is a pure material loss" gone.
    // It is excluded exactly when the gate is least trustworthy. `outcomeEps`
    // is a band on MEAN REWARD, and reward carries material only inside
    // +/-`materialFull` (`materialSignal` clips): in a position already a
    // thousand-odd points behind, every leaf maps to the same clipped reward,
    // so the reward spread between "chump" and "decline" is not a material
    // reading at all — it is the residue of which rollouts happened to reach a
    // terminal. MEASURED on the #2147 board (4 x Craw Wurm into a lone Grizzly
    // Bears, defender at 40): leaf `evaluate` prefers declining by 125 points
    // and `blockDeltaOf` by 120, while mean reward prefers the chump by 0.035
    // at EVERY budget from 400 to 3200 iterations — a stable gap under the 0.05
    // gate, so the correct move survived only while sampling noise stayed
    // small enough to keep it inside the band, and a search-model change that
    // moved the noise (PR #3092's restored declare-blockers priority window)
    // flipped it. Admitting the baseline unconditionally is also the same
    // shape every other rule in this function already uses -- the lower-
    // variance, lower-visit line is pulled from the FULL pool -- and it does
    // not make the bot block-shy: `blockDeltaOf` folds in
    // `lethalUnblockedDelta`, worth +/-2 x `winScore`, so a block that stops
    // lethal still out-scores declining by a margin nothing here can reach
    // (blade charter scenario 4, the same board at 20 life, still blocks).
    // Block-quality tie-break. A block decision is decided by the same material
    // tie-break / rollout noise, which cannot tell a clean kill-block from a
    // wasteful over-commit: a double chump that loses two creatures to kill
    // nothing leaves the same board as a single chump in most rollouts, so it can
    // win on noise. `declaredBlockDelta` is the principled measure of a declared
    // block's worth, so among outcome-equal block contenders keep the highest —
    // it preserves a genuinely good block (a kill / favourable trade scores top)
    // while rejecting a dominated over-commit. Pulled from the full pool on
    // outcome-equality (not the visit band), as the hold-trick rule is: the
    // lighter block is the lower-variance, lower-visit line.
    if (
        rootState &&
        botId &&
        ruleOn("block-quality") &&
        best.move.kind === "declare-blockers"
    ) {
        const blocks = pool.filter(
            (e) =>
                e.move.kind === "declare-blockers" &&
                (mean(e) >= bestMean - weights.outcomeEps ||
                    isEmptyBlockDeclaration(e.move))
        );
        if (blocks.length > 0) {
            const prev = best;
            // The determinized lens when the caller had a sampler (issue
            // #2876) — the SAME worlds, deck knowledge included, that the tree
            // and the rollouts reason over. Reading `rootState` here is what
            // made every opponent model structurally invisible to a block.
            const deltaOf = (e: Edge) =>
                blockLens
                    ? blockLens(e.move)
                    : blockDeltaOf(rootState, e.move, botId, weights);
            best = blocks
                .map((e) => ({ e, delta: deltaOf(e) }))
                .reduce((m, x) => (x.delta > m.delta ? x : m)).e;
            if (best !== prev) {
                mechanism = "block-quality";
                flipped = true;
            }
        }
    }

    // Announcement-variant tie-break (issue #1888, generalises issue #365).
    // When the robust pick names targets, rank it against every outcome-equal
    // SIBLING variant of the same announcement — the other targets, the other X
    // values, the other modes — by `castVariantScore` and take the best. This
    // subsumes the #365 friendly-vs-enemy redirect (a self-targeted removal
    // scores below its enemy-targeted sibling on the resolved margin term) and
    // adds the beneficial mirror the margin is blind to (an aura handed to the
    // opponent scores below the same aura on the bot's own permanent, on the
    // beneficence term).
    //
    // Both announcement sites qualify (PR #1914 review finding 3): a cast
    // (CR 601.2c) and an ACTIVATED ability (CR 602.2b). Every term is
    // move-kind-agnostic — `resolvedMarginDelta` probes any move,
    // `misdirectedTargetCount` reads `move.targets` against an `EffectOp[]` —
    // so restricting to casts only left Garruk Wildspeaker's "+1: Untap two
    // target lands" free to untap the OPPONENT's lands on rollout noise.
    //
    // Pulled from the FULL `pool` on outcome-equality alone (not the visit
    // band), as the land-drop / hold-trick rules are: the alternative is the
    // lower-variance, lower-visit line. Because it fires ONLY among
    // outcome-equal siblings, a variant with REAL value out-rewards the field
    // and never reaches here.
    if (
        rootState &&
        botId &&
        (best.move.kind === "cast-spell" ||
            best.move.kind === "activate-ability")
    ) {
        if (ruleOn("announcement-variant")) {
            const scoreCache = new Map<Edge, number>();
            const scoreOf = (e: Edge) => {
                let s = scoreCache.get(e);
                if (s === undefined) {
                    s = castVariantScore(rootState, e.move, botId, weights);
                    scoreCache.set(e, s);
                }
                return s;
            };
            const variants = pool.filter(
                (e) =>
                    mean(e) >= bestMean - weights.outcomeEps &&
                    isCastVariantOf(e.move, best.move)
            );
            for (const edge of variants) {
                if (scoreOf(edge) > scoreOf(best)) {
                    best = edge;
                    mechanism = "announcement-variant";
                    flipped = true;
                }
            }
        }

        // Self-harm hold (issue #365, unchanged). No sibling variant improved on
        // a cast that only lowers the bot's own material margin: hold the Spell
        // rather than destroy its own board. Deliberately keyed on the MARGIN
        // shape alone — a beneficence misdirection with no better sibling (a
        // "target opponent draws" punisher, which can only point at the
        // opponent) must still be castable, so it never triggers a hold.
        // `isSelfHarmRemovalCast` stays CAST-only by construction
        // (`targetsOnlyOwnPermanents` rejects any other kind): "hold it for
        // later" is a spell-in-hand affordance, and an already-on-board ability
        // that only hurts the bot loses on reward, not by being held.
        if (
            ruleOn("self-harm-removal") &&
            isSelfHarmRemovalCast(rootState, best.move, botId, weights)
        ) {
            const hold = pool.find(
                (e) =>
                    e.move.kind === "pass" &&
                    mean(e) >= bestMean - weights.outcomeEps
            );
            if (hold) return finish(hold, "self-harm-removal", hold !== best);
        }

        // Wasted-mana hold (CR 106.4 / 500.4). A cast whose resolution leaves
        // the bot holding floating mana nothing in the position can spend — a
        // ritual with an empty hand, Metamorphosis' creature-only mana with no
        // creature spell to pay for — burns a card, and with an additional
        // sacrifice cost a creature too, for a resource that empties unused at
        // the end of the step. The LEAF evaluation says so plainly (the
        // reported Metamorphosis line scores 218 for `pass` against −12 for the
        // cast), but the root pick is settled on the ACCUMULATED `meanMargin`,
        // and the `pass` edge's own subtree contains the very same blunder one
        // ply deeper, which drags its mean below the cast's — so the cast wins
        // the material tie-break at EVERY budget, `hard` included. This is the
        // same washing `project_combat_eval_washed_at_horizon` describes, and
        // the same answer: encode the preference as a root tie-break.
        //
        // Fires only when `pass` is outcome-equal, so a ritual that actually
        // enables something out-rewards the field and never reaches here, and
        // the spender test is the position's own legal move list — no card
        // names, no per-card registry (ADR 0102).
        if (
            ruleOn("wasted-mana-hold") &&
            isWastedManaCast(rootState, best.move, botId, weights)
        ) {
            const hold = pool.find(
                (e) =>
                    e.move.kind === "pass" &&
                    mean(e) >= bestMean - weights.outcomeEps
            );
            if (hold) return finish(hold, "wasted-mana-hold", hold !== best);
        }
    }

    // Free-development tie-break (ADR 0020 §1, issue #206; extended for free
    // mana sources and mana dorks). A land — and likewise a FREE MANA SOURCE (a
    // Mox, Black Lotus, a 0-cost mana artifact; `isFreeManaSourceCast`) or a MANA
    // DORK (Birds of Paradise, Llanowar Elves; `isManaDorkCast`) — has no option
    // cost in this engine: there is no bluff or hidden-information value to
    // holding it, a sorcery-speed permanent carries no instant-speed option to
    // defer, so deferring it is never right. All develop board/mana that washes
    // out of the rollout, so `pass` can win the material tie-break on noise (the
    // bot sat on its only land; preferred `pass` over `cast Mox Jet`; sat on
    // Birds of Paradise on an empty board with a Mox down). When the robust pick
    // is `pass` but an outcome-equal land drop, free-mana-source cast OR mana-dork
    // cast exists (within `OUTCOME_EPS` of the best mean reward), develop it
    // instead. Fires ONLY on outcome-equality, so it can
    // never override a genuine decision, and never overrides a non-`pass` robust
    // pick. Generalizes the issue-#149 "land drop strictly positive" invariant to
    // the tie-break (a strictly-better development already wins on mean reward and
    // never reaches this branch).
    //
    // Pulled from the full `pool` on outcome-equality alone — NOT gated on the
    // `VISIT_TOL` visit band (same as the hold-trick rule below). When `pass`
    // out-rewards the development by a hair (rollout noise inside `OUTCOME_EPS`),
    // UCB explores `pass` more and the develop move falls out of the visit band
    // even though the two are outcome-equal. Gating on `contenders` (visit-band)
    // would then silently drop it — exactly the mana-screwed case where the bot
    // sat on its only land rather than developing it.
    if (best.move.kind === "pass" && ruleOn("free-development")) {
        const develop = pool.find(
            (e) =>
                mean(e) >= bestMean - weights.outcomeEps &&
                (e.move.kind === "play-land" ||
                    (!!rootState &&
                        (isFreeManaSourceCast(rootState, e.move, botId) ||
                            isManaDorkCast(rootState, e.move, botId))))
        );
        if (develop)
            return finish(develop, "free-development", develop !== best);
    }

    // Hold-the-trick tie-break (ADR 0021, issue #229). The mirror image of the
    // land-drop rule. A combat trick / instant-speed answer held in hand DOES
    // carry option value — it can respond to what the opponent does — so spending
    // it at sorcery speed for a marginal payoff destroys that option. When the
    // robust pick is to DUMP such a trick at sorcery speed but PASS (hold it) is
    // an outcome-equal contender (within `OUTCOME_EPS`), keep the option: a held
    // trick is never worse than a dumped one when the two are outcome-equal, and
    // the dump is then pure rollout noise (the canonical 2/2 + Giant Growth, where
    // the cautious opponent neutralises the trade-up, so hold ≈ dump on mean and
    // the low-variance dump would otherwise win the material tie-break). Fires
    // ONLY on outcome-equality, so a dump with REAL value (a lethal pump, a
    // must-cast answer) wins on mean reward and never reaches this branch.
    //
    // Extended to ACTIVATIONS by issue #1890 (items 2 and 4): an instant-speed
    // activated ability is the battlefield mirror of a held instant, and a
    // manland animation with the mover's own combat already behind it is the
    // same shape with no window left at all. Both are pulled from the full pool
    // on outcome-equality alone, exactly as the cast case is.
    if (
        rootState &&
        ruleOn("hold-trick") &&
        (isSorcerySpeedTrickDump(rootState, best.move) ||
            (!!botId && isPointlessSelfAnimation(rootState, botId, best.move)))
    ) {
        // Hold (`pass`) qualifies when it is outcome-equal on MEAN REWARD (within
        // `OUTCOME_EPS`) — NOT gated on the `VISIT_TOL` visit count the land-drop
        // rule uses. The held line is intrinsically lower-visit / higher-variance
        // (the multi-step ambush), so it may not reach the visit band even when it
        // is outcome-equal; but spending a trick at sorcery speed for an
        // outcome-equal result is strictly dominated by keeping the option, so the
        // visit count must not decide it. Pulled from the full `pool` for the same
        // reason. A dump with REAL value out-rewards `pass` by more than
        // `OUTCOME_EPS` and never reaches here.
        const hold = pool.find(
            (e) =>
                e.move.kind === "pass" &&
                mean(e) >= bestMean - weights.outcomeEps
        );
        if (hold) return finish(hold, "hold-trick", hold !== best);
    }

    // Standing-spend HOLD (issue #3319) — the MISSING HALF of the last-window
    // FIRE rule directly below, and the reason the issue-#3192 fix held in the
    // bot's own main phase and not in a real game.
    //
    // The hold-the-trick rule above is gated on `isSorceryTimingFor`: it only
    // ever looks at the mover's OWN sorcery window. Every other priority the
    // bot holds — the opponent's upkeep, draw, main, end step — leaves an
    // activation that DESTROYS ITS OWN SOURCE for a marginal payoff with
    // nothing between it and the material tie-break. MEASURED on the issue's
    // board (Walking Ballista on its last +1/+1 counter, both players on 20,
    // no other permanent), 400 iterations, seeds 0xb1ade/1/2: in
    // PRECOMBAT_MAIN the pick is `pass` on `mechanism: hold-trick`, and at the
    // opponent's END_STEP the SAME board picks the shot at the face on
    // `mechanism: material-tiebreak`, `contenderCount: 4`, `gapReward` 0.0038
    // against the 0.05 outcome band — all four root moves outcome-equal, so
    // the reward never decided it and the accumulated subtree margin did.
    //
    // The FIRE rule below already owns exactly this trade in exactly this
    // vocabulary; it just only answers one of its two directions. It converts
    // when the robust pick is `pass` AND firing pays. This is the other
    // direction: the robust pick IS the spend and firing does NOT pay, so an
    // outcome-equal `pass` keeps the permanent. Same predicates
    // (`isStandingSpendActivation`, `firingBeatsHolding`), same
    // `OUTCOME_EPS` gate, and structurally disjoint from the FIRE rule — that
    // one requires `best.move.kind === "pass"`, this one requires an
    // activation — so neither can pre-empt the other and their order is
    // immaterial.
    //
    // Fires in ANY window rather than only the last one, because the argument
    // does not depend on which window it is: a spend that leaves the immediate
    // position no better than standing pat is dominated by keeping the
    // permanent, and the FIRE rule remains the single place a conversion is
    // licensed. A spend with REAL value out-rewards `pass` by more than
    // `OUTCOME_EPS` (the fire half of the issue-#3192 pair, opponent on 1,
    // wins on `mechanism: mean-reward` with `contenderCount: 1`) and never
    // reaches here.
    //
    // The COMBAT is owned too (issue #3369), which it was not when this rule
    // shipped: it was excluded wholesale, on the ground that
    // `firingBeatsHolding` compared `policyValue` after the move against a bare
    // `evaluate` on the root and the two agree only with combat torn down. That
    // exclusion left the bot attacking with a creature and spending it one step
    // later, so the probe was made symmetric instead (see `firingBeatsHolding`)
    // and the blanket gate replaced by `isInPendingCombatExchange`, which asks
    // the narrower question the hold actually depends on: would the permanent
    // still BE there to keep. A creature standing in a live exchange may be
    // dead either way, and spending it first is then right — combat value also
    // washes out at the search horizon
    // (`project_combat_eval_washed_at_horizon`), so the predicate fails open
    // rather than trying to price the exchange.
    // EXCLUDED with a NON-EMPTY STACK, and this is the same exclusion
    // `isSorceryTimingFor` already gives the hold-the-trick rule ("a main phase
    // with something on the stack is a response window, which is where an
    // activation belongs"). A response window is precisely where spending the
    // permanent is RIGHT: an opponent's removal spell aimed at it means holding
    // extracts nothing at all. `firingBeatsHolding` cannot see that — `evaluate`
    // does not model the stack, so a permanent already doomed by a spell on it
    // scores at full value in the holding baseline, the probe reads "alive, no
    // payoff" against "dead, small payoff", and the rule would hold a Ballista
    // through the Bolt that kills it. An empty stack also keeps the probe
    // comparable in the first place: `policyValue` only settles the stack when
    // it holds exactly ONE item, so an activation resolving underneath an
    // opponent's spell yields no payoff at all and the hold becomes automatic.
    //
    // KNOWN LIMITATION, stated rather than papered over: `evaluate` is blind to
    // pending DELAYED TRIGGERS too, so a permanent doomed by one ("sacrifice it
    // at the beginning of the end step") reads as fully standing in the holding
    // baseline, and an outlet on it is held rather than cashed. Narrower and
    // rarer than the stack case, and the empty-stack gate does not cover it; if
    // a blade position ever shows it costing the bot a real play, the narrowing
    // goes here.
    if (
        rootState &&
        rootState.stack.length === 0 &&
        !!botId &&
        ruleOn("standing-spend-hold") &&
        isStandingSpendActivation(rootState, botId, best.move) &&
        !isInPendingCombatExchange(rootState, best.move.cardInstanceId) &&
        !firingBeatsHolding(rootState, botId, best.move, weights)
    ) {
        const hold = pool.find(
            (e) =>
                e.move.kind === "pass" &&
                mean(e) >= bestMean - weights.outcomeEps
        );
        if (hold) return finish(hold, "standing-spend-hold", hold !== best);
    }

    // Resolved-payoff CREDIT (issue #3388) — the POSITIVE half of the
    // self-harm hold above, and the half without which the bot can refuse a
    // cheat-into-play line but never take one.
    //
    // `self-harm-removal` asks exactly one question of a self-confined cast —
    // does its SETTLED resolution lower my material margin — and acts on the
    // answer in one direction only. A hold rule can only ever refuse
    // (`ai/blade/registry.ts`, the cheat-into-play pair's note), so the line
    // whose settled resolution strictly PAYS was left to the ordinary material
    // tie-break, and that tie-break cannot see it: the `meanMargin` it compares
    // is accumulated over the whole SUBTREE, and the `pass` subtree explores
    // casting the SAME spell one ply later, so it carries the identical payoff
    // (and the identical cost) and the two means differ by rollout noise.
    // MEASURED on the issue-#3293 pair at the production budget: cheating a
    // Vaultborn Tyrant in for {1}{U} settles at +201.6 material against
    // declining, and `pass` still won on `mechanism: material-tiebreak` with
    // both edges inside `OUTCOME_EPS` — which is why that half of the pair
    // shipped `stretch` with a `beyondBudget` block naming this exact artifact.
    //
    // Same gate as the hold, so the two are one rule read in both directions:
    // `reachesOnlyOwnSideThroughChoice` keeps it to an announcement whose whole
    // reach is the mover's own side (a resolution that can touch the opponent
    // is priced by the search, not by a leaf probe of the mover's own board),
    // and `resolvedMarginDelta` is the same leaf-decisive measurement, read for
    // a strict GAIN instead of a strict loss. Fires only on outcome-equality,
    // so a cast with real reward already wins on mean and never reaches here,
    // and only when the robust pick is `pass` — with a cast already picked
    // there is nothing to credit.
    //
    // `stack.length === 0`, for the reason `standing-spend-hold` and
    // `last-window-fire` both give in this same vocabulary (PR review finding
    // B1): `resolvedMarginDelta` settles with `floorDepth: 0`, so with an
    // opponent's announcement underneath it drains that one too while its
    // `before` baseline does not, and the two sides then differ by the
    // opponent's spell rather than by the decision. A symmetric sweeper on the
    // stack would read as a self-confined cast "paying" for a resolution worth
    // nothing.
    //
    // ORDER. Both holds require `best` to be a cast/activation, and it is
    // `pass` here, so neither can collide. Two rules can: `free-development`
    // above returns on an outcome-equal land drop and is deliberately left
    // AHEAD — an untaken land drop is a turn the cheat-into-play line still
    // has — and `last-window-fire` below credits an ACTIVATION where this
    // credits a `cast-spell`, so the two are disjoint per EDGE but not per
    // POSITION. With a qualifying cast and a qualifying last-window activation
    // both outcome-equal, this placement takes the cast: the deferred
    // activation is by construction still there next turn, and the cast is
    // priced on its own resolution.
    if (
        rootState &&
        !!botId &&
        rootState.stack.length === 0 &&
        ruleOn("resolved-payoff") &&
        best.move.kind === "pass"
    ) {
        const payoff = pool.find(
            (e) =>
                e.move.kind === "cast-spell" &&
                mean(e) >= bestMean - weights.outcomeEps &&
                reachesOnlyOwnSideThroughChoice(rootState, e.move, botId) &&
                resolvedMarginDelta(rootState, e.move, botId, weights) > 0
        );
        if (payoff) return finish(payoff, "resolved-payoff", payoff !== best);
    }

    // Last-window FIRE (issue #2939) — the mirror of the hold rule above, and
    // the half that makes it a discipline rather than a refusal. The hold rule
    // defers a sacrifice engine out of the mover's own main phase; something has
    // to spend it, or the bot simply never converts.
    //
    // The window is the OPPONENT's end step (CR 513.1): the last priority the
    // bot holds before its own turn begins, so deferring past it no longer buys
    // information — it just pushes the payoff a whole turn cycle back, and a
    // permanent the engine builds arrives a turn later than it had to (the
    // Elemental that could have been attack-legal, CR 302.6).
    //
    // Why this cannot ride on the material tie-break that already exists: the
    // `meanMargin` it compares is accumulated over the whole SUBTREE, and both
    // subtrees here contain the same future activation — `pass` keeps the
    // option and takes it later in the rollout, `activate` has taken it
    // already. So the accumulation is measuring rollout noise rather than the
    // decision, and it measured it backwards in the issue's position: `pass`
    // 1781.7 against the activation's 1552.8 while the IMMEDIATE position after
    // activating scored 729.5 against 482.0 (the number `firingBeatsHolding`
    // actually computes: `policyValue` resolves one stack item, so the life gain
    // is still on the stack; the fully-settled position is 745.5). The comparison that answers "now
    // or a turn later" is the immediate one, so this rule makes it explicitly.
    //
    // `firingBeatsHolding` decides WHETHER converting pays; it is NOT what stops
    // a repeatable engine. It cannot be: every conversion on the issue's own
    // board is a strict gain, so the check would say yes five times in a row.
    // The stop is the once-per-turn clause in `isDeferredEngineActivation` — a
    // tie-break redirects ONE outcome-equal pick, and the second conversion has
    // to earn itself on mean reward.
    //
    // `stack.length === 0` (issue #3369 review): `firingBeatsHolding` scores
    // BOTH sides through `policyValue`, which RESOLVES the top of the stack for
    // an activation. With an opponent's spell underneath at their end step —
    // ordinary play — the holding side would be scored AFTER that spell and the
    // firing side with it still pending, so the two would differ by the
    // opponent's spell rather than by the decision. MEASURED on the
    // `NO-FIRE (convert)` board with a Bolt aimed at the bot's own face, the
    // conversion flipped from `pass` to a land sacrificed for 2 life — the
    // Sylvan Safekeeper class (#2422/#2938) this rule exists to refuse. A
    // response window is not this rule's business anyway; the HOLD rule above
    // makes the same exclusion for the same reason.

    if (
        rootState &&
        !!botId &&
        rootState.stack.length === 0 &&
        ruleOn("last-window-fire") &&
        best.move.kind === "pass" &&
        isLastDeferralWindow(rootState, botId)
    ) {
        const fire = pool.find(
            (e) =>
                mean(e) >= bestMean - weights.outcomeEps &&
                isDeferredEngineActivation(rootState, botId, e.move) &&
                firingBeatsHolding(rootState, botId, e.move, weights)
        );
        if (fire) return finish(fire, "last-window-fire", fire !== best);
    }
    return finish(best, mechanism, flipped);
}

/** Whether `move` spends a REACTIVE OPTION in a window where the same option
 *  would still be available later — the predicate the hold-the-trick tie-break
 *  fires on. Two shapes, one rule:
 *
 *  1. **A held combat TRICK dumped at sorcery speed** (ADR 0021, issue #229) — a
 *     `cast-spell` of an Instant whose `aiCombatHint` declares a pump, cast by
 *     the active player at a main phase (the window where it could instead be
 *     held for the combat-step ambush).
 *
 *     Scoped to PUMP tricks only — NOT removal. A pump's sole use is combat, so
 *     spending it pre-combat is dominated by holding it whenever the two are
 *     outcome-equal (the land-drop analogy: no reason to commit early). Removal
 *     is deliberately excluded: a removal cast at sorcery speed can be the
 *     correct, decisive play (killing a blocker, going face for lethal — e.g. a
 *     lethal Lightning Bolt), so it must be left to win or lose on mean reward,
 *     never redirected to `pass`.
 *
 *  2. **An instant-speed ACTIVATION spent at sorcery speed for no material
 *     gain** (issue #1890 item 2) — a `useStack: true` ability with no timing
 *     restriction that would stop it being used later
 *     (`isDeferrableStackAbility`), activated by the active player inside its
 *     OWN sorcery window (`isSorceryTimingFor` — the engine's single authority
 *     on the CR 307.5 template: own main phase, empty stack, holding priority;
 *     a main phase with something on the stack is a response window, which is
 *     where an activation belongs), and whose whole effect EXPIRES THIS TURN
 *     (`isTransientOnlyAbility`).
 *
 *     That last clause IS case 1's `aiCombatHint.pump` narrowing, stated
 *     generally. A pump qualifies in case 1 precisely because it moves no
 *     PERMANENT material (`evaluateCreature` reads permanent effective P/T, so
 *     an until-end-of-turn buff is invisible to it) — its entire worth is the
 *     window it is held for, so spending it early is strictly dominated. An
 *     until-end-of-turn ACTIVATED effect (Mother of Runes' protection) is the
 *     same object. An ability that BUILDS something instead (Sandstorm
 *     Salvager's permanent +1/+1 counters, a fetchland's search) has banked its
 *     value the moment it resolves, whenever that is, and must be left to win or
 *     lose on mean reward. Without the clause this rule swallowed the latter.
 *
 *     Issue #2939 adds the SECOND justification, from the other side of the
 *     trade: a cost that gives up a permanent still doing its job
 *     (`spendsStandingPermanent`). Zuran Orb's life gain and the Elemental it
 *     feeds Titania do not decay, so the transience clause is silent on it, yet
 *     firing in the mover's own main phase still forfeits every use of the
 *     sacrificed land between now and the window the same activation is
 *     available in anyway. The two clauses are ORed: either side being
 *     dominated is enough. The Prodigal Sorcerer guard survives because a `{T}`
 *     cost is given back at untap, so nothing is forfeited by firing early.
 *
 *     KNOWN ASYMMETRY with case 1, stated rather than papered over: case 1
 *     deliberately excludes REMOVAL, because a removal spell cast at sorcery
 *     speed can be the decisive play. The cost clause has no such exclusion, so
 *     a sacrifice-cost removal outlet (Mogg Fanatic, Goblin Bombardment) is now
 *     deferrable, and the `OUTCOME_EPS` gate is weakest exactly there —
 *     clearing a blocker pre-combat is combat value, which washes out at the
 *     search horizon. It is left in because the gate still requires the two to
 *     be outcome-equal and because the cost argument genuinely applies (the
 *     creature can be sacrificed after blocks are declared instead, with strictly
 *     more information); if a blade position ever shows it costing the bot a
 *     real play, the narrowing goes here.
 *
 *  3. **A FLASH PERMANENT dumped at sorcery speed** (issue #2248) — a
 *     `cast-spell` of a non-Instant card carrying the Flash keyword, cast by
 *     the active player at a main phase, with NO `aiCombatHint.pump` gate.
 *     Case 1's pump gate scopes it to trades whose entire worth is the
 *     window — a permanent's body is not invisible to `evaluateCreature` the
 *     way an until-end-of-turn buff is, so that narrowing doesn't apply here.
 *     What DOES carry over is the option itself: casting at sorcery speed
 *     forecloses the mana-open option (waiting to act on more information —
 *     the opponent's end step) for no reason, the same option a held instant
 *     protects. A flash permanent with REAL value now (a needed blocker, a
 *     lethal-relevant body, an ETB that must resolve before an opponent's
 *     known action) wins on mean reward and never reaches this branch — the
 *     tie-break only fires within `OUTCOME_EPS` of the best move.
 *
 *  Pure. */
function isSorcerySpeedTrickDump(state: GameState, move: Move): boolean {
    const player = state.players.find((p) => p.id === state.activePlayerId);
    if (!player) return false;
    if (move.kind === "cast-spell") {
        // Pre-existing scope (issue #229): the phase alone, deliberately NOT the
        // full sorcery window — a cast in a main phase with a stack is still the
        // dump this rule was written against.
        const atSorcerySpeed =
            state.phase === "PRECOMBAT_MAIN" ||
            state.phase === "POSTCOMBAT_MAIN";
        if (!atSorcerySpeed) return false;
        const card = player.hand.find((c) => c.id === move.cardInstanceId);
        if (!card) return false;
        if (card.types.includes("Instant")) {
            const cardId = (card.card as { id?: string } | undefined)?.id;
            const def = cardId ? tryGetDefinition(cardId) : undefined;
            return !!def?.aiCombatHint?.pump;
        }
        // Shape 3 — flash permanent, no pump gate (see header).
        return card.staticAbilities.includes("flash");
    }
    if (move.kind === "activate-ability") {
        if (!isSorceryTimingFor(state, player.id)) return false;
        const source = player.battlefield.find(
            (c) => c.id === move.cardInstanceId
        );
        if (!source) return false;
        const ability = effectiveAbilityOf(source, move.abilityId);
        if (!ability) return false;
        if (!isDeferrableStackAbility(ability)) return false;
        // Shape 2 has TWO independent justifications, one per side of the
        // trade (issue #2939): a payoff that expires this turn, or a cost that
        // gives up a permanent still doing its job. See
        // `spendsStandingPermanent`.
        return (
            isTransientOnlyAbility(ability) ||
            spendsStandingPermanent(state, source, ability)
        );
    }
    return false;
}

/** Whether `pid` is at the LAST priority window of this turn cycle in which
 *  deferring still costs nothing — the opponent's end step (CR 513.1, issue
 *  #2939). "The last window before the bot's own turn" is the normal case, not
 *  an invariant: an extra turn taken by the opponent makes this one cycle
 *  early, which converts sooner than strictly necessary and never later.
 *
 *  Deliberately not "any window on the opponent's turn": the end step is the
 *  one where every threat and answer of the turn is already known, which is the
 *  whole payoff the hold rule defers FOR. Anything earlier still has
 *  information left to buy. */
function isLastDeferralWindow(state: GameState, pid: string): boolean {
    return state.phase === "END_STEP" && state.activePlayerId !== pid;
}

/** Whether `sourceId` is inside a combat exchange whose damage has not been
 *  dealt yet — a declared attacker that has been BLOCKED, or a declared
 *  BLOCKER (issue #3369).
 *
 *  The hold rule needs it because "keep the permanent" is only worth something
 *  when the permanent would still be there to keep. A creature standing in a
 *  confirmed exchange may be about to die for free, and spending it first is
 *  then the right play rather than the blunder the rule exists to stop — the
 *  measured shape is a 1/1 Walking Ballista blocked by a 2/2: it dies either
 *  way, so shooting the last counter at the face before damage is value the
 *  bot would otherwise throw away.
 *
 *  Deliberately NOT a lethality calculation. Asking "will this exchange
 *  actually kill it" means re-deriving assignment, deathtouch, protection and
 *  prevention outside the authorities that own them (`lethalDamage.ts`,
 *  `damageAssignment.ts`, `combatDamagePrevention.ts`), and a tie-break that
 *  redirects a root pick has no business carrying a second copy of the combat
 *  rules. The predicate FAILS OPEN instead, matching the module's discipline
 *  everywhere else: an exchange the rule cannot argue about is left to win or
 *  lose on mean reward. The cost of that is an attacker blocked by something
 *  too small to kill it, where the rule stays silent and the spend is merely
 *  sub-optimal rather than a blunder.
 *
 *  An UNBLOCKED attacker is not in an exchange: nothing is assigning damage to
 *  it, so it is standing exactly as it stands outside combat. That is the
 *  issue's own position, one window after the attack.
 *
 *  PRE-DAMAGE ONLY, and that is a PHASE test rather than a `blockersConfirmed`
 *  one — see the guard in the body: the declaration outlives the damage steps,
 *  so `blockersConfirmed` alone keeps reading an exchange that is over. */
function isInPendingCombatExchange(
    state: GameState,
    sourceId: string
): boolean {
    // PHASE GUARD (mandatory), the same one `declaredFaceDamage` carries in
    // `evaluate.ts` and for the same reason: `state.combat` — `confirmed`,
    // `blockersConfirmed`, `attackerIds` and `blockerAssignments` included —
    // SURVIVES both damage steps and is torn down only as END_OF_COMBAT ENDS
    // (`endCombatStep`, `phases.ts`, CR 511.3). Damage is applied on step
    // ENTRY, so at COMBAT_DAMAGE and END_OF_COMBAT the exchange is already
    // OVER and every survivor is simply standing on the battlefield again.
    //
    // Without it the predicate reads a stale declaration and the rule goes
    // silent for the rest of the turn on any creature that was blocked — which
    // is issue #3369's own blunder one blocker away: MEASURED, a Walking
    // Ballista blocked by a 0/8 Wall of Stone comes through the damage step
    // untouched and, at COMBAT_DAMAGE, removes its last counter for one point
    // at a 20-life face on all 5 seeds.
    //
    // `FIRST_STRIKE_DAMAGE` stays INSIDE the window deliberately: regular
    // damage is still coming (CR 510.4), so a creature that survived first
    // strike is still standing in a live exchange and silence is the
    // conservative answer.
    if (
        state.phase !== "DECLARE_BLOCKERS" &&
        state.phase !== "FIRST_STRIKE_DAMAGE"
    ) {
        return false;
    }
    const combat = state.combat;
    if (!combat || !combat.confirmed || !combat.blockersConfirmed) return false;
    // Through `getEffectiveBlockGraph` (`banding.ts`), never a hand-rolled scan
    // of `blockerAssignments`: Banding (CR 702.22h) makes every other creature
    // in a band blocked by whatever blocked one of them, so a raw scan reads a
    // banded attacker
    // that something else absorbed as UNBLOCKED — a fail-CLOSED miss in a
    // predicate whose whole contract is to fail open. It is also the module
    // that OWNS the question, which is the argument this predicate already
    // makes against carrying a second copy of the combat rules.
    const graph = getEffectiveBlockGraph(state);
    return !!(
        graph.attackersByBlocker[sourceId]?.length ||
        graph.blockersByAttacker[sourceId]?.length
    );
}

/** Whether `move` is an activation `pid` controls that GIVES UP A PERMANENT
 *  STILL DOING ITS JOB for a payoff that does not decay — the shape both
 *  deferral rules are about, extracted (issue #3319) so the FIRE half and the
 *  HOLD half can never drift apart on what they are talking about.
 *
 *  Three clauses, each load-bearing:
 *   - `isDeferrableStackAbility` — the same activation is still available
 *     later, so deferring forfeits nothing about the ability itself;
 *   - `!isTransientOnlyAbility` — an effect that expires this turn buys
 *     nothing by waiting either, and holding one would walk back into the
 *     Sylvan Safekeeper blunder (#2422/#2938);
 *   - `spendsStandingPermanent` — paying the cost takes a permanent off the
 *     battlefield that would otherwise keep blocking and tapping, INCLUDING
 *     the positional `removeCounter` case where the counters are the body
 *     (CR 704.5f, issue #3296).
 *
 *  Deliberately WITHOUT the once-per-turn cap `isDeferredEngineActivation`
 *  adds on top: that cap is a stop on CONVERSION, and its sign is wrong for a
 *  hold — an engine that has already fired once this turn is not thereby
 *  licensed to throw the next permanent away. */
function isStandingSpendActivation(
    state: GameState,
    pid: string,
    move: Move
): move is Extract<Move, { kind: "activate-ability" }> {
    if (move.kind !== "activate-ability") return false;
    const player = state.players.find((p) => p.id === pid);
    if (!player) return false;
    const source = player.battlefield.find((c) => c.id === move.cardInstanceId);
    if (!source) return false;
    const ability = effectiveAbilityOf(source, move.abilityId);
    if (!ability) return false;
    return (
        isDeferrableStackAbility(ability) &&
        !isTransientOnlyAbility(ability) &&
        spendsStandingPermanent(state, source, ability)
    );
}

/** Whether `move` converts a sacrifice engine `pid` controls whose payoff does
 *  NOT decay — the exact shape the hold rule deferred (issue #2939), read back
 *  so the two rules can never disagree about what they are talking about.
 *
 *  The `!isTransientOnlyAbility` clause is load-bearing rather than
 *  symmetry-for-its-own-sake: an ability whose whole effect expires this turn
 *  buys nothing by being fired at the end step either, and firing one would
 *  walk straight back into the Sylvan Safekeeper blunder (#2422/#2938) —
 *  a land traded for a shroud that expires minutes later with nothing to
 *  protect against. Only a LASTING payoff earns the conversion. */
function isDeferredEngineActivation(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (!isStandingSpendActivation(state, pid, move)) return false;
    const player = state.players.find((p) => p.id === pid);
    if (!player) return false;
    const source = player.battlefield.find((c) => c.id === move.cardInstanceId);
    if (!source) return false;
    // ONE conversion per turn, and this — not the material check below — is the
    // floor that makes the rule safe (issue #2939 review). A repeatable engine
    // whose every conversion is a strict material gain never stops paying:
    // measured on the fire-half board, 482.0 -> 745.5 -> 1009.0 -> 1272.5 ->
    // 1498.5 as the lands go, so `firingBeatsHolding` alone would strip the bot
    // to zero lands inside a single end step and hand it its own turn with no
    // mana.
    //
    // A tie-break is licensed to redirect ONE outcome-equal pick, never to run
    // an engine to completion. The second conversion has to earn itself on mean
    // reward like any other play — the same discipline the hold rule's
    // `OUTCOME_EPS` gate applies from the other direction. `activationsThisTurn`
    // is the engine's own tally (`recordActivation`, `activationCommit.ts`,
    // which the search records too), reset at the turn boundary, so "once"
    // means once per opponent turn and this rule invents no state of its own.
    return (source.activationsThisTurn?.[move.abilityId] ?? 0) === 0;
}

/** Whether taking `move` NOW leaves `pid` in a strictly better immediate
 *  position than leaving the board as it stands (issue #2939).
 *
 *  Both sides go through the seams the search itself uses — `applyMoveInSearch`
 *  to realise the activation and `policyValue` to resolve it one ply and score
 *  the result — so this cannot drift from what the tree believes. The holding
 *  side is the UNTOUCHED root through the SAME `policyValue` (issue #3369):
 *  `pass` moves no material, and applying it would advance the phase and score
 *  a different turn, so the clone is scored as it stands.
 *
 *  Runs at the ROOT only, from TWO call sites: the last-window FIRE rule
 *  (behind `isLastDeferralWindow` + `isDeferredEngineActivation`, once per
 *  qualifying candidate — the cost-pick variants of a single ability, capped at
 *  `MAX_VICTIM_VARIANTS`) and the standing-spend HOLD rule (behind
 *  `isStandingSpendActivation`, once, on the robust pick). Never on the hot
 *  path from either. The clone goes through `cloneGameState`, the search's
 *  own seam (ADR 0001 / #108), never `structuredClone`.
 *
 *  The two sides compare like with like only while the ROOT STATE carries
 *  neither live combat nor a non-empty stack, and each caller earns that
 *  differently, and BOTH callers now assert the EMPTY STACK at their own guard
 *  (issue #3369): `policyValue` RESOLVES the top of the stack for an
 *  activation, so with a spell underneath, the holding side would be scored
 *  after it and the firing side with it still pending — the two would then
 *  differ by the opponent's spell rather than by the decision. FIRE used to
 *  inherit only the combat half from its window (`state.combat` is torn down in
 *  `endCombatStep` before END_STEP, so both corrections are zero there and this
 *  reduces to `evaluate`, byte-identical to the comparison it replaced), and an
 *  opponent's end-step spell was enough to flip it. The stack half matters for
 *  a second reason the combat half does not have: `evaluate` never models the
 *  stack, so a permanent already doomed by a spell aimed at it scores at full
 *  value on the holding side.
 *
 *  RESIDUAL ASYMMETRY, stated rather than claimed away: `policyValue` strips
 *  `declaredCombatDelta` behind `hasCastableInstant`, a condition read off each
 *  side separately. An activation that taps the bot out can remove its last
 *  castable instant, so in the bot's own DECLARE_ATTACKERS window the fired
 *  side may keep the predicted-exchange term while the held side strips it.
 *  Narrower than what the symmetry fixes, and strictly better than the
 *  one-sided comparison it replaced, but the two are comparable in every window
 *  only up to that term. */
function firingBeatsHolding(
    state: GameState,
    pid: string,
    move: Move,
    weights: EvalWeights
): boolean {
    const fired = cloneGameState(state);
    applyMoveInSearch(fired, pid, move);
    // BOTH sides through `policyValue` (issue #3369). The holding side used to
    // be a bare `evaluate`, which is only equivalent while `state.combat` is
    // torn down: `policyValue` folds in `declaredBlockDelta` (and strips
    // `declaredCombatDelta` behind a held trick), so with a live combat the
    // FIRING side collected combat corrections the HOLDING side did not and the
    // probe measured the correction rather than the decision. Passing the
    // untouched clone through the same function makes the two comparable in
    // every window. `move` is handed to the holding call only to select the
    // same code path; with the empty stack the callers require, `policyValue`
    // resolves nothing, so the holding side is `evaluate` plus exactly the
    // corrections the firing side also gets. In a torn-down combat both
    // corrections are zero and this is byte-identical to the previous
    // comparison — the issue-#2939 FIRE rule's own window.
    const held = cloneGameState(state);
    return (
        policyValue(fired, pid, move, weights, pid) >
        policyValue(held, pid, move, weights, pid)
    );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Whether the root pick is PROVABLY SETTLED — more iterations cannot change
 *  it (issue #2685). Two conditions, both pure functions of the grown tree
 *  (visit/reward counts only, never the clock):
 *
 *   1. VISIT LEAD UNCATCHABLE — the most-visited root child's visit count
 *      exceeds every other child's by MORE than the iterations remaining, so
 *      no other child can catch it (each iteration adds at most one visit to
 *      one child).
 *   2. MEAN-REWARD LEAD DECISIVE — its mean reward beats the best OTHER
 *      child's by more than `weights.outcomeEps`, so `selectRootMove`'s
 *      outcome band (`contenders`) collapses to that single edge and every
 *      outcome-gated tie-break has nothing to override.
 *
 *  Both hold ⇒ `selectRootMove` returns this edge, PROVIDED the one full-pool
 *  tie-break that is NOT gated on outcome-equality — the extra-turn structural
 *  credit (`selectRootMove`, issue #244) — has nothing to fire on. That credit
 *  is computed from the ROOT STATE (a castable extra-turn spell), not from
 *  visit counts, so this visit/reward-only predicate cannot see it: the caller
 *  (`runSearchWithTrace`) disables the early stop entirely when the root holds
 *  a castable extra-turn spell (see `extraTurnGrantAtRoot`). Reads the root
 *  children directly; never touches the RNG, so it is deterministic and cannot
 *  perturb the search it short-circuits.
 *
 *  `remaining` is `maxIter - i`; a budget with no `iterations` bound yields
 *  `remaining = Infinity`, so the visit-lead condition can never hold and the
 *  rule never fires (time is then the only ceiling, as before). `remaining`
 *  being 0 (the final iteration, nothing left to search) also returns false,
 *  so `"settled"` strictly means an EARLY stop. Exported as a test seam (like
 *  `selectRootMove` / `computeActionPriors`) so the two conjuncts are
 *  assertable against a hand-built root, without running a full search to
 *  reach a specific determinization. */
export function rootDecisionSettled(
    root: Node,
    remaining: number,
    weights: EvalWeights
): boolean {
    if (remaining <= 0) return false;
    const pool = [...root.children.values()].filter((e) => e.visits > 0);
    if (pool.length < 2) return false;
    const mean = (e: Edge) => e.totalReward / e.visits;

    // The most-visited root child (exists: pool.length >= 2 above).
    const top = pool.reduce((m, e) => (e.visits > m.visits ? e : m));
    let runnerUpMean = -Infinity;
    for (const e of pool) {
        if (e === top) continue;
        if (top.visits - e.visits <= remaining) return false;
        runnerUpMean = Math.max(runnerUpMean, mean(e));
    }
    return mean(top) - runnerUpMean > weights.outcomeEps;
}

/** Choose a move for `playerId` by ISMCTS, and surface a DecisionTrace of what
 *  was weighed. Deterministic given `seed` and an iteration budget — the trace
 *  is built only after the move is chosen, so it never perturbs selection. The
 *  trace is null when there was no real decision to explain (no action owed, or
 *  a single forced move). */
export function searchWithTrace(
    state: GameState,
    playerId: string,
    budget: SearchBudget,
    seed: number,
    deckKnowledge?: DeckKnowledgeBySeat
): { move: Move | null; trace: DecisionTrace | null } {
    // The DECISION scope for `dominance.ts`' choice-level probe (PR #1914
    // review finding 1). The cast-level probe is already once-per-decision by
    // construction (it runs at the root only, below); the choice-level one is
    // reached from a PRIOR that the tree evaluates at every choice-node visit,
    // so it is held to the same invariant by a per-decision memo. Opened here
    // and closed in a `finally` so a verdict can never outlive the position it
    // was proved against.
    beginDominanceDecision();
    try {
        return runSearchWithTrace(state, playerId, budget, seed, deckKnowledge);
    } finally {
        endDominanceDecision();
    }
}

function runSearchWithTrace(
    state: GameState,
    playerId: string,
    budget: SearchBudget,
    seed: number,
    deckKnowledge?: DeckKnowledgeBySeat
): { move: Move | null; trace: DecisionTrace | null } {
    const decider = decidingPlayer(state);
    if (decider !== playerId) return { move: null, trace: null };

    // Explicit calibration surface (issue #2683). Resolved ONCE, here, from
    // whatever `SearchVariant` the ladder installed around this call (null in
    // live play and every test that doesn't set one, so this is
    // `DEFAULT_EVAL_WEIGHTS` outside a ladder run) — the ONE consultation of
    // `getSearchVariant()` for a weight anywhere in this file. Everything
    // below threads `weights` down as an explicit parameter instead of
    // re-reading the module-global at its own point of use.
    const weights = resolveEvalWeights(getSearchVariant());
    // Priors + FPU on the ordinary action space (issue #2684) — resolved in the
    // same one place, for the same reason, and `null` for every variant that
    // does not ask for it (so live play never pays a branch below the top of
    // this function).
    const actionPriors = resolveActionPriors(getSearchVariant());
    // How the search imagines the seats it cannot see (issue #2791). Same one
    // place, same reason: `determinize` takes it as an argument rather than
    // reading the module-global itself, so a determinization is reproducible
    // from its inputs alone.
    const opponentModel = resolveOpponentModel(getSearchVariant());
    // Root rules disabled for this search (issue #3399). Same one place, same
    // reason: `selectRootMove` takes the set as an argument rather than
    // reading the module-global itself. Empty outside a run that asks.
    const disabledRootRules = resolveDisabledRootRules(getSearchVariant());

    // Dominance pruning (issue #1887) runs EXACTLY ONCE per search, here, on
    // the real root state — not at every tree node (issue #1905 review finding
    // 3: that cost 42.6% of the wall clock of an iteration-budgeted search).
    // The dropped moves become a deny-set for the tree's root layer, so the
    // proof is paid for once and honoured everywhere it matters.
    const dominatedAtRoot: Move[] = [];
    const moves = enumerateMoves(state, playerId, {
        pruneDominatedNoOps: true,
        onPruned: (m) => dominatedAtRoot.push(m),
    });
    if (moves.length === 0) return { move: null, trace: null };
    // No real decision (e.g. a forced mulligan window) — return immediately
    // without paying for search (and with no trace to explain).
    if (moves.length === 1 || state.phase === "MULLIGAN") {
        return { move: moves[0], trace: null };
    }

    // Issue #3393 — the greedy-concordance measurement. Only when a
    // telemetry sink is installed (never in production play): the 1-ply
    // greedy pick on this very root and move list, so the record can say
    // whether the search agreed with the policy it already contains. Its
    // own rng instance, so the search's stream below is byte-identical with
    // or without a sink — a corpus leg must not perturb the decisions it
    // measures.
    const greedyMoveKey = getRootDecisionSink()
        ? moveKey(
              selectRolloutMove(
                  state,
                  playerId,
                  playerId,
                  moves,
                  makeRng(seed),
                  weights
              )
          )
        : undefined;

    const rng = makeRng(seed);
    const root = newNode();

    const maxIter = budget.iterations ?? Infinity;
    const timeMs = budget.timeMs;
    const now = budget.now ?? (() => performance.now());
    // Early-stop floor (issue #2685): the settle rule may not fire before this
    // many iterations. Defaults to 0 — the rule is always active, but it only
    // stops a search whose root pick is already decided, so an omitted floor
    // (blade entries, every pre-existing test) costs nothing on a contested
    // decision.
    const minIter = budget.minIterations ?? 0;
    // Always captured (issue #2682) — an iteration-only budget (the untimed
    // blade suite) still wants to know its real wall-clock cost, not just a
    // timed one. `performance.now()` is cheap enough that measuring it
    // unconditionally is not worth the branch.
    const start = now();

    const prunedRootKeys = new Set(
        dominatedAtRoot.map((m) =>
            priorityMoveKey(state, playerId, playerId, m)
        )
    );

    // Extra-turn soundness guard (issue #2685, issue #244): the extra-turn
    // structural credit in `selectRootMove` is the ONE full-pool tie-break not
    // gated on outcome-equality, so a settled NON-grant pick could still be
    // overridden by an under-visited extra-turn cast — and that override reads
    // the ROOT STATE, not the visit/reward counts `rootDecisionSettled` sees.
    // Disable the early-stop rule when the root holds a castable extra-turn
    // spell. The probe is cheap and cast-only: `botExtraTurnGrantDelta` returns
    // 0 for every non-`cast-spell` move without probing, and extra-turn spells
    // are rare. Runs on a clone (never the search's RNG stream), so it cannot
    // perturb determinism.
    const extraTurnGrantAtRoot = moves.some(
        (m) =>
            m.kind === "cast-spell" &&
            botExtraTurnGrantDelta(state, m, playerId, weights) > 0
    );

    let i = 0;
    // `i` IS the real per-decision iteration count (issue #2682) — until this
    // slice it was computed and immediately discarded: passed to `buildTrace`
    // only as the now-removed bare `iterations` field, never compared against
    // what the budget actually asked for or against the wall clock that (in
    // a real game) usually cuts it short.
    let stoppedBy: SearchStopReason = "iterations";
    while (i < maxIter) {
        iterate(
            root,
            state,
            playerId,
            rng,
            weights,
            prunedRootKeys,
            actionPriors,
            deckKnowledge,
            opponentModel
        );
        i++;
        if (timeMs !== undefined && now() - start >= timeMs) {
            stoppedBy = "time";
            break;
        }
        // Early stop (issue #2685): after `minIter`, bail once the root pick is
        // settled — the most-visited child can no longer be overtaken and its
        // mean-reward lead is decisive. Deterministic (reads only visit/reward
        // counts), so a fixed-seed iteration budget still replays bit-identically.
        // Never fires when the root holds a castable extra-turn spell (see
        // `extraTurnGrantAtRoot`), whose non-outcome-gated credit could still
        // override a settled pick.
        if (
            !extraTurnGrantAtRoot &&
            i >= minIter &&
            rootDecisionSettled(root, maxIter - i, weights)
        ) {
            stoppedBy = "settled";
            break;
        }
    }
    const stats: SearchStats = {
        iterationsCompleted: i,
        // No `iterations` bound → nothing was "requested" beyond what ran;
        // report the completed count so the field never reads as Infinity.
        iterationsRequested: maxIter === Infinity ? i : maxIter,
        elapsedMs: now() - start,
        stoppedBy,
    };

    const picked: { mechanism: RootDecisionMechanism } = {
        mechanism: "mean-reward",
    };
    const move = selectRootMove(
        root,
        moves,
        state,
        playerId,
        stats,
        weights,
        // Lazy (issue #2876): the worlds are sampled on the first move the
        // block tie-break asks about, so a decision that never reaches it —
        // every non-block root — pays nothing for holding the lens.
        makeBlockDeltaLens(
            state,
            playerId,
            seed,
            weights,
            deckKnowledge,
            opponentModel
        ),
        picked,
        greedyMoveKey,
        disabledRootRules
    );
    return {
        move,
        trace: buildTrace(
            root,
            state,
            playerId,
            stats,
            move,
            weights,
            picked.mechanism
        ),
    };
}

/** The 1-ply greedy pick for `playerId` at `state` — the rollout policy
 *  (`selectRolloutMove`) applied to the ROOT, no search at all (issue #3393).
 *  Same candidate set as `search` (dominance-pruned `enumerateMoves`, same
 *  single-move / mulligan short-circuits), so a comparison between the two is
 *  over identical options; `seed` only breaks exact ties between equal-scored
 *  moves, as it does inside a rollout. Exported for the blade runner's
 *  `pick: "greedy"` leg and its report script — it is a measurement seam,
 *  not a production decider. */
export function greedyRootPick(
    state: GameState,
    playerId: string,
    seed: number,
    weights: EvalWeights = resolveEvalWeights(getSearchVariant())
): Move | null {
    if (decidingPlayer(state) !== playerId) return null;
    beginDominanceDecision();
    try {
        const moves = enumerateMoves(state, playerId, {
            pruneDominatedNoOps: true,
        });
        if (moves.length === 0) return null;
        if (moves.length === 1 || state.phase === "MULLIGAN") return moves[0];
        return selectRolloutMove(
            state,
            playerId,
            playerId,
            moves,
            makeRng(seed),
            weights
        );
    } finally {
        endDominanceDecision();
    }
}

/** Choose a move for `playerId` by ISMCTS. Deterministic given `seed` and an
 *  iteration budget. Returns null when the player owes no action. Thin wrapper
 *  over `searchWithTrace` (it discards the trace) so non-debug callers and the
 *  existing tests keep the same `Move | null` contract. */
export function search(
    state: GameState,
    playerId: string,
    budget: SearchBudget,
    seed: number,
    deckKnowledge?: DeckKnowledgeBySeat
): Move | null {
    return searchWithTrace(state, playerId, budget, seed, deckKnowledge).move;
}
