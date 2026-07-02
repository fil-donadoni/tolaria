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

import type { CardInstanceState, GameState, StackItem } from "./state";
import {
    moveCard,
    removeFromZone,
    resolveTopOfStack,
    emitPermanentEntered,
    processPendingActionTriggers,
    getOpponentId,
    tapPermanent,
} from "./state";
import { checkStateBasedActions } from "./sba";
import {
    advancePhase,
    drainAutoPasses,
    emitBlockersConfirmedEvents,
    applyAllCombatDamage,
    buildAutoDamageAssignments,
} from "./phases";
import { cloneGameState } from "./clone";
import { predictCombatOutcome } from "./dangerClock";
import { recordBlockedAttackers } from "./banding";
import { enumerateMoves, type Move } from "./moves";
import { manaValue } from "./constants";
import { getInstanceManaCost } from "../cards";
import {
    evaluate,
    evaluateBreakdown,
    declaredBlockDelta,
    declaredCombatDelta,
    hasCastableInstant,
    materialMargin,
    WIN_SCORE,
    type PositionBreakdown,
} from "./evaluate";
import { describeMove } from "./describeMove";
import { determinize } from "./determinize";
import { makeRng } from "./rng";
import { hasCastableInstantHint } from "./heldInteraction";
import { isCreature, hasManaAbility } from "./constants";
import { tryGetDefinition } from "../cards";

/** Search budget: stop at `iterations` tree iterations, or once `timeMs` of
 *  wall-clock has elapsed (whichever comes first). At least one must be set —
 *  `DEFAULT_BUDGET` provides both. `now` is injectable for deterministic tests
 *  of the time bound. */
export type SearchBudget = {
    iterations?: number;
    timeMs?: number;
    now?: () => number;
};

/** The single shipped difficulty preset for this slice (CR-agnostic tuning).
 *  A lobby selector that exposes multiple presets is a separate slice (#114). */
// ADR 0015: the turn-boundary rollout plays a full round per playout (longer
// than the old 8-ply horizon), so the wall-clock ceiling is raised to ~1.5s to
// let the 400-iteration budget actually complete. Still well under human
// decision pace, so the opponent stays fluid.
export const DEFAULT_BUDGET: SearchBudget = { iterations: 400, timeMs: 1500 };

/** UCB1 exploration constant. */
const UCB_C = 1.4;
/** Weight of the soft reactive prior added to UCB1 (ADR 0021 slice 3, issue
 *  #223). Sized to meaningfully bias EXPLORING an instant-speed response in its
 *  window when the edge is barely visited, yet — because it decays as
 *  1/(1+visits) — to fall below the UCB1 exploration term within a handful of
 *  visits, so it can never dominate the accumulated reward. */
const REACTIVE_PRIOR_C = 0.5;
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
/** Chance the rollout policy plays a uniform-random move instead of the
 *  immediate-best one — keeps playouts from collapsing to a single line. */
const ROLLOUT_EPSILON = 0.25;
/** Lower exploration epsilon on a REACTIVE COMBAT line (ADR 0021, issue #229):
 *  a declared combat where a player holds castable interaction. The multi-step
 *  hold→attack→block→respond ambush is a narrow, response-conditioned line — at
 *  the flat 0.25 epsilon a random move (skipping the in-response pump, or a
 *  nonsense block) dilutes it to a minority playout, so its high-variance mean
 *  stays just below the low-variance sorcery-speed dump. Dropping the random
 *  rate when interaction is live lets the sane reactive line (the
 *  `selectRolloutMove` default policy now casts the pump in its window) play out
 *  reliably, so the held line's real value surfaces. Still > 0, so the tree is
 *  not collapsed to a single line. */
const ROLLOUT_EPSILON_REACTIVE = 0.05;
/** Soft penalty subtracted from a discouraged move's reward in the rollout
 *  default policy (ADR 0020 §4). Small — a fraction of the reward band — so it
 *  only breaks ties / suppresses no-payoff lines: any move with real value (a
 *  lethal dork attack, a must-cast instant) clears it easily. Pure policy bias;
 *  the move stays legal and explorable by the tree. */
const ROLLOUT_GUARDRAIL_PENALTY = 0.05;
/** A terminal `evaluate` magnitude dominates every material term. */
const TERMINAL = WIN_SCORE / 2;
/** Width of the reward band reserved, at each terminal extreme, for the
 *  surviving material margin (issue #138). A won position always outranks every
 *  non-won one and a lost one ranks below all, but WITHIN the band the material
 *  still discriminates: a win that threw a creature away for nothing scores
 *  below a win that kept it, so a free chump attack never ties "no attacks". A
 *  flat `return 1` for every win erased that signal. */
const TERMINAL_BAND = 0.25;
/** Material margin (in `evaluate` units) that fills a half-band. Kept LINEAR up
 *  to this cap — not `tanh` — so a single creature's worth of material shifts
 *  the reward by a fixed, decision-relevant amount regardless of how far ahead
 *  the bot already is. `tanh` saturates near a decided position and was the root
 *  cause: the creature delta vanished into the flat tail. Forge-scale (ADR
 *  0018): a vanilla 2/2 is worth ~170, so this cap (~3 creatures) keeps one
 *  creature's worth a meaningful, non-saturating fraction of the band. */
const MATERIAL_FULL = 500;

/** Map a material margin to [-1, 1], linear (constant slope) until it saturates
 *  at ±`MATERIAL_FULL`. Linear is deliberate: the discriminating quantity is a
 *  fixed material delta, which must move the reward by the same amount whether
 *  the absolute margin is small or large. */
function materialSignal(margin: number): number {
    const x = margin / MATERIAL_FULL;
    return x < -1 ? -1 : x > 1 ? 1 : x;
}

export type Edge = {
    move: Move;
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
};

function newNode(): Node {
    return { children: new Map() };
}

/** Stable structural key for a move (moves are plain data). */
function moveKey(move: Move): string {
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
        state.pendingTarget ||
        (state.pendingChoices && state.pendingChoices.length > 0)
    ) {
        return null;
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
 *  the suicidal-attack signal no longer saturates away. */
export function reward(state: GameState, botId: string): number {
    return rewardFromValue(evaluate(state, botId));
}

/** The reward-band shaping applied to an `evaluate` value, factored out of
 *  `reward` so the rollout default policy can shape a combat-augmented value
 *  (ADR 0021 slice 2) through the IDENTICAL band — terminal extremes reserve
 *  `TERMINAL_BAND` for the surviving material margin, the open middle is linear
 *  in the material signal. */
function rewardFromValue(v: number): number {
    if (v >= TERMINAL) {
        const material = 0.5 + 0.5 * materialSignal(v - WIN_SCORE);
        return 1 - TERMINAL_BAND + TERMINAL_BAND * material;
    }
    if (v <= -TERMINAL) {
        const material = 0.5 + 0.5 * materialSignal(v + WIN_SCORE);
        return TERMINAL_BAND * material;
    }
    const material = 0.5 + 0.5 * materialSignal(v);
    return TERMINAL_BAND + (1 - 2 * TERMINAL_BAND) * material;
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
 *  sources tapped so spent mana is reflected in the leaf position. */
function applyTapPlan(
    state: GameState,
    playerId: string,
    tapPlan: { cardInstanceId: string }[]
): void {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;
    for (const tap of tapPlan) {
        const src = player.battlefield.find((c) => c.id === tap.cardInstanceId);
        if (src) src.isTapped = true;
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
 *  Documented simulation limits (server stays authoritative, so inexactness only
 *  costs move quality): coarse mana (tap-plan only), and `activate-ability`
 *  applies costs but does not put the ability's effect on the stack. */
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

        case "play-land": {
            const card = moveCard(
                player,
                move.cardInstanceId,
                "hand",
                "battlefield"
            );
            if (card.types.includes("Land")) {
                player.landsPlayedThisTurn =
                    (player.landsPlayedThisTurn ?? 0) + 1;
            }
            emitPermanentEntered(state, card);
            processPendingActionTriggers(state);
            // A special action resets the pass cycle (CR 117.3c) and keeps
            // priority with the actor, who may keep acting.
            state.passCount = 0;
            checkStateBasedActions(state);
            return;
        }

        case "cast-spell": {
            applyTapPlan(state, playerId, move.tapPlan);
            const spellCard = removeFromZone(
                player,
                move.cardInstanceId,
                "hand"
            );
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
            };
            state.stack.push(stackItem);
            // CR 117: the caster gets priority but auto-passes it (no Ctrl), so
            // the opponent gets to respond before the spell resolves.
            state.passCount = 0;
            state.priorityPlayerId = playerId;
            state.singleShotAutoPass = playerId;
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "activate-ability": {
            applyTapPlan(state, playerId, move.tapPlan);
            const src = player.battlefield.find(
                (c) => c.id === move.cardInstanceId
            );
            if (src) src.isTapped = true;
            state.passCount = 0;
            state.priorityPlayerId = playerId;
            state.singleShotAutoPass = playerId;
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return;
        }

        case "declare-attackers": {
            const combat = (state.combat = {
                attackerIds: [...move.attackerIds],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            });
            for (const id of combat.attackerIds) {
                const atk = findCreature(state, id);
                if (!atk) continue;
                atk.isAttacking = true;
                atk.hasAttackedThisTurn = true;
                if (!atk.staticAbilities.includes("vigilance")) {
                    // CR 708.9 / ADR 0013 — face-down attacker turns up on tap.
                    tapPermanent(state, atk);
                }
            }
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
                    const blocker = findCreature(state, blockerId);
                    if (blocker) blocker.isBlocking = true;
                }
                state.combat.blockerAssignments = byBlocker;
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
function scoreLeaf(state: GameState, botId: string): Leaf {
    return {
        reward: reward(state, botId),
        margin: materialMargin(state, botId),
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
function rolloutEpsilonFor(state: GameState): number {
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
    if (!inCombat) return ROLLOUT_EPSILON;
    const anyHeld = state.players.some((p) => hasCastableInstantHint(p));
    return anyHeld ? ROLLOUT_EPSILON_REACTIVE : ROLLOUT_EPSILON;
}

function rollout(state: GameState, botId: string, rng: () => number): Leaf {
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
        if (moves.length === 1 || rng() < rolloutEpsilonFor(state)) {
            chosen = moves[Math.floor(rng() * moves.length)];
        } else {
            chosen = selectRolloutMove(state, pid, botId, moves, rng);
        }
        applyMoveInSearch(state, pid, chosen);
    }
    return scoreLeaf(state, botId);
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
            return !!c && isCreature(c) && hasManaAbility(c);
        });
    }
    if (move.kind === "cast-spell") {
        const player = state.players.find((p) => p.id === pid);
        const card = player?.hand.find((c) => c.id === move.cardInstanceId);
        const cardId = (card?.card as { id?: string } | undefined)?.id;
        const def = cardId ? tryGetDefinition(cardId) : undefined;
        if (!def || !def.types.includes("Instant")) return false;
        // Sorcery-speed window: the mover is the active player at a main phase,
        // where a pure instant could instead be held for a reactive moment.
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
    return false;
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
 *     below holding.
 *   * A just-declared block is scored on the pre-damage snapshot, so every block
 *     assignment looks identical. `declaredBlockDelta` folds the actual exchange
 *     in so the policy can tell a sane block from a bad one (the attacker side
 *     already gets this from `evaluate`'s `declaredCombatDelta`, ADR 0020 §3). */
function policyValue(probe: GameState, botId: string, move: Move): number {
    if (move.kind === "cast-spell" && probe.stack.length > 0) {
        resolveTopOfStack(probe);
    }
    let v = evaluate(probe, botId);
    const combat = probe.combat;
    if (
        combat &&
        combat.confirmed &&
        !combat.blockersConfirmed &&
        combat.attackerIds.length > 0 &&
        hasCastableInstant(probe, probe.activePlayerId)
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
        v -= declaredCombatDelta(probe, botId);
    }
    // Fold the declared block exchange in for ANY move taken at a confirmed,
    // pre-damage block — `declaredBlockDelta` reads effective P/T, so it covers
    // the block declaration itself AND a combat trick just cast in response (the
    // resolved pump is live this turn). No-op when no block is confirmed.
    return v + declaredBlockDelta(probe, botId);
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
    rng: () => number
): Move {
    const moverIsBot = pid === botId;
    let bestScore = -Infinity;
    let best: Move[] = [];
    for (const move of moves) {
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, pid, move);
        // `policyValue` is from the bot's view; flip for the opponent so each
        // mover greedily maximizes ITS own reward (a competent opponent).
        const r = rewardFromValue(policyValue(probe, botId, move));
        let moverReward = moverIsBot ? r : 1 - r;
        if (isDiscouragedRolloutMove(state, pid, move)) {
            moverReward -= ROLLOUT_GUARDRAIL_PENALTY;
        }
        // Setup-attack bonus (ADR 0021 slice 3): nudge the default policy to
        // ATTACK when it holds a castable trick, so the rollout actually plays
        // out the ambush instead of declining the bait. Small — it tips an
        // even-looking setup (an attacker that merely trades) without forcing a
        // clearly-losing one (a creature that just dies in the block), the
        // mirror of the pre-block guardrail.
        if (isAmbushSetupAttack(state, pid, move)) {
            moverReward += ROLLOUT_GUARDRAIL_PENALTY;
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

function ucb1(edge: Edge): number {
    const exploit = edge.totalReward / edge.visits;
    const explore = UCB_C * Math.sqrt(Math.log(edge.avail) / edge.visits);
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
    return (
        def.types.includes("Instant") ||
        (def.staticAbilities?.includes("flash") ?? false)
    );
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
 *  response behind it is reachable. */
function isReactiveHold(state: GameState, pid: string, move: Move): boolean {
    if (move.kind !== "pass") return false;
    const combat = state.combat;
    if (!combat || !combat.confirmed || combat.blockersConfirmed) return false;
    if (combat.attackerIds.length === 0) return false;
    if (pid !== state.activePlayerId) return false;
    return hasCastableInstant(state, pid);
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
    visits: number
): number {
    if (
        !isReactiveInstantCast(state, pid, move) &&
        !isAmbushSetupAttack(state, pid, move) &&
        !isReactiveHold(state, pid, move)
    ) {
        return 0;
    }
    return REACTIVE_PRIOR_C / (1 + visits);
}

/** Grow the tree by one iteration on a freshly-determinized world. */
function iterate(
    root: Node,
    rootState: GameState,
    botId: string,
    rng: () => number
): void {
    const world = determinize(rootState, botId, rng);
    const path: Edge[] = [];
    let node = root;

    for (let depth = 0; depth < MAX_TREE_DEPTH; depth++) {
        const pid = decidingPlayer(world);
        if (!pid) break;
        const moves = enumerateMoves(world, pid);
        if (moves.length === 0) break;

        const keyed = moves.map((m) => ({ move: m, key: moveKey(m) }));
        const untried = keyed.filter((k) => !node.children.has(k.key));

        if (untried.length > 0) {
            // Expand one untried legal move, then roll out from it.
            const pick = untried[Math.floor(rng() * untried.length)];
            applyMoveInSearch(world, pid, pick.move);
            const edge: Edge = {
                move: pick.move,
                mover: pid,
                node: newNode(),
                visits: 0,
                totalReward: 0,
                totalMargin: 0,
                avail: 1,
            };
            node.children.set(pick.key, edge);
            path.push(edge);
            backpropagate(path, rollout(world, botId, rng), botId);
            return;
        }

        // All legal moves are in the tree: bump availability, then UCB-select.
        let bestEdge: Edge | null = null;
        let bestVal = -Infinity;
        for (const { key } of keyed) {
            const edge = node.children.get(key)!;
            edge.avail += 1;
            const val =
                ucb1(edge) + reactivePrior(world, pid, edge.move, edge.visits);
            if (val > bestVal) {
                bestVal = val;
                bestEdge = edge;
            }
        }
        applyMoveInSearch(world, pid, bestEdge!.move);
        path.push(bestEdge!);
        node = bestEdge!.node;
    }

    // Reached a terminal/at-depth leaf without expanding: score it as-is.
    backpropagate(path, scoreLeaf(world, botId), botId);
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
     *  search never simulated. */
    eval: PositionBreakdown;
};

/** What the Brain considered for a single decision. A read-only by-product of
 *  one `search`; building it neither consumes the search RNG nor changes the
 *  chosen move. Stays on the client (worker → main thread), never persisted. */
export type DecisionTrace = {
    botId: string;
    /** Label of the move the search ultimately chose. */
    chosen: string;
    /** Iterations actually spent. */
    iterations: number;
    /** Every root candidate weighed, most-visited first. */
    candidates: CandidateTrace[];
};

/** Resolve `state`'s stack to a stable point so a one-shot eval breakdown
 *  reflects the position AFTER the bot's spell/ability resolves (not the instant
 *  it hits the stack). Bounded; stops if a mid-resolution choice would need
 *  input the trace can't supply. Mutates `state` (caller owns the clone). */
function settleStackForBreakdown(state: GameState): void {
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 16) {
        if (
            state.pendingTarget ||
            state.pendingCast ||
            state.pendingActivation ||
            (state.pendingChoices?.length ?? 0) > 0
        ) {
            break;
        }
        resolveTopOfStack(state);
        checkStateBasedActions(state);
    }
}

/** Build the DecisionTrace from the grown tree. Each candidate's eval breakdown
 *  re-applies the root move on a fresh clone of `rootState` and settles the
 *  stack — O(root children) clones, once, after the search has finished. */
function buildTrace(
    root: Node,
    rootState: GameState,
    botId: string,
    iterations: number,
    chosen: Move
): DecisionTrace {
    const candidates: CandidateTrace[] = [];
    for (const edge of root.children.values()) {
        const probe = cloneGameState(rootState);
        applyMoveInSearch(probe, botId, edge.move);
        settleStackForBreakdown(probe);
        candidates.push({
            label: describeMove(edge.move, rootState),
            move: edge.move,
            visits: edge.visits,
            meanReward: edge.visits > 0 ? edge.totalReward / edge.visits : 0,
            meanMargin: edge.visits > 0 ? edge.totalMargin / edge.visits : 0,
            avail: edge.avail,
            eval: evaluateBreakdown(probe, botId),
        });
    }
    candidates.sort(
        (a, b) => b.visits - a.visits || b.meanReward - a.meanReward
    );
    return {
        botId,
        chosen: describeMove(chosen, rootState),
        iterations,
        candidates,
    };
}

/** Fraction of the top visit count within which two root moves count as
 *  "equally explored" (issue #138). UCB1's exploration term keeps near-equal
 *  candidates within a few percent of each other in visits, so the single
 *  most-visited move is effectively decided by rollout noise — which let a
 *  suicidal chump attack tie "no attacks". Among candidates this close in
 *  visits, the robust pick is the higher mean reward, where the (now
 *  non-saturating) material signal lives. Reduces to plain most-visited when one
 *  move is clearly dominant (the lethal/response cases keep their pick). */
const VISIT_TOL = 0.15;
/** Two root moves count as the same OUTCOME when their mean rewards are within
 *  this band — they win/lose/stall about as often. Sits below the reward
 *  reserved per material point so a genuine win-probability difference still
 *  wins, while outcome-equal candidates fall through to the material tie-break. */
const OUTCOME_EPS = 0.05;

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
function isWastefulAttack(state: GameState, move: Move): boolean {
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

/** The defender's value of a specific declared block, from `botId`'s view: the
 *  `declaredBlockDelta` of the post-block state (kills gained − blockers lost −
 *  face taken, minus the cautious-block discount). The principled measure of a
 *  block's worth — a clean kill scores highest, a dominated over-commit (a double
 *  chump that loses two creatures to kill nothing) lowest. `declare-blockers` is
 *  the defender's move, i.e. `botId` itself at this decision. */
function blockDeltaOf(state: GameState, move: Move, botId: string): number {
    if (move.kind !== "declare-blockers") return -Infinity;
    const probe = cloneGameState(state);
    applyMoveInSearch(probe, botId, move);
    return declaredBlockDelta(probe, botId);
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
// with the self-play harness (issue #244).
const EXTRA_TURN_VALUE = 350; // ≈ draw (150) + untap/main tempo (50) + combat (150)

/** How many extra turns `move` grants `botId` once it resolves (0 if none).
 *  Effect-keyed: clones `state`, applies the move, settles the stack (the same
 *  proven probe `buildTrace` uses), and measures the growth of `botId`'s entries
 *  in `extraTurns` (CR 500.7). Reads the resolved effect, not the card identity,
 *  so it covers any extra-turn spell without a per-card table. */
function botExtraTurnGrantDelta(
    state: GameState,
    move: Move,
    botId: string
): number {
    // Only a resolving spell can add to `extraTurns` in the search effect model.
    if (move.kind !== "cast-spell") return 0;
    const before = (state.extraTurns ?? []).filter((id) => id === botId).length;
    const probe = cloneGameState(state);
    // Defensive: this probe runs on EVERY root edge during selection. Casting and
    // resolving an arbitrary spell on the clone can throw (e.g. a targeted spell
    // whose move carries no usable target). A throw means no extra-turn grant was
    // realised — treat it as zero rather than letting it break root selection.
    try {
        applyMoveInSearch(probe, botId, move);
        settleStackForBreakdown(probe);
    } catch {
        return 0;
    }
    const after = (probe.extraTurns ?? []).filter((id) => id === botId).length;
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
    botId: string
): number {
    const grants = botExtraTurnGrantDelta(state, move, botId);
    if (grants <= 0) return 0;
    return (
        (1 - 2 * TERMINAL_BAND) *
        0.5 *
        materialSignal(grants * EXTRA_TURN_VALUE)
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
    botId: string
): number {
    const before = materialMargin(state, botId);
    const probe = cloneGameState(state);
    try {
        applyMoveInSearch(probe, botId, move);
        settleStackForBreakdown(probe);
    } catch {
        return 0;
    }
    return materialMargin(probe, botId) - before;
}

/** Whether `move` is a SELF-HARM removal cast: it targets only the bot's own
 *  Permanents AND resolving it strictly lowers the bot's material margin (issue
 *  #365). Effect-keyed (the resolved margin drop), NOT a per-card list, so it
 *  covers Disenchant, Swords to Plowshares, and any future one-sided removal —
 *  while a beneficial self-target (a sacrifice-for-value, removing a liability)
 *  raises or holds the margin and is correctly NOT flagged. */
function isSelfHarmRemovalCast(
    state: GameState,
    move: Move,
    botId: string
): boolean {
    if (!targetsOnlyOwnPermanents(state, move, botId)) return false;
    return resolvedMarginDelta(state, move, botId) < 0;
}

/** Whether `move` casts the SAME card as `ref` (same `cardInstanceId` and chosen
 *  mode) but at a DIFFERENT, non-self-harming target — the enemy-target variant
 *  of the self-targeted removal. The friendly-vs-enemy preference: when both a
 *  self-target and an enemy-target cast of the same Spell are outcome-equal, take
 *  the enemy one (issue #365). */
function isAlternativeTargetCast(
    state: GameState,
    move: Move,
    ref: Move,
    botId: string
): boolean {
    if (move.kind !== "cast-spell" || ref.kind !== "cast-spell") return false;
    if (move.cardInstanceId !== ref.cardInstanceId) return false;
    if (move.chosenModeId !== ref.chosenModeId) return false;
    if (move.targets.length === 0) return false;
    // Not itself self-harm (an enemy target, or a beneficial own target).
    return !isSelfHarmRemovalCast(state, move, botId);
}

export function selectRootMove(
    root: Node,
    moves: Move[],
    rootState?: GameState,
    botId?: string
): Move {
    const pool = [...root.children.values()].filter((e) => e.visits > 0);
    if (pool.length === 0) return moves[0];

    const maxVisits = pool.reduce((m, e) => Math.max(m, e.visits), 0);
    const explored = pool.filter(
        (e) => e.visits >= maxVisits * (1 - VISIT_TOL)
    );

    const mean = (e: Edge) => e.totalReward / e.visits;
    const meanMargin = (e: Edge) => e.totalMargin / e.visits;
    const bestMean = explored.reduce((m, e) => Math.max(m, mean(e)), -Infinity);
    const contenders = explored.filter(
        (e) => mean(e) >= bestMean - OUTCOME_EPS
    );

    let best = contenders[0];
    for (const edge of contenders) {
        if (meanMargin(edge) > meanMargin(best)) best = edge;
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
    if (rootState && botId) {
        const creditCache = new Map<Edge, number>();
        const creditOf = (e: Edge) => {
            let c = creditCache.get(e);
            if (c === undefined) {
                c = extraTurnRewardCredit(rootState, e.move, botId);
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
            if (credited(bestGrant) > credited(best)) return bestGrant.move;
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
    if (rootState && isWastefulAttack(rootState, best.move)) {
        // Pull the alternative from the FULL pool on outcome-equality alone (not
        // the `VISIT_TOL` visit band), as the hold-trick rule does: staying back
        // is the lower-variance, lower-visit line, so UCB explores the neutral
        // swing more and pushes the defensive option out of the visit band even
        // when the two are outcome-equal. Among outcome-equal, NON-wasteful
        // alternatives, keep the best-material one.
        const productive = pool.filter(
            (e) =>
                mean(e) >= bestMean - OUTCOME_EPS &&
                !isWastefulAttack(rootState, e.move)
        );
        if (productive.length > 0) {
            best = productive.reduce((m, e) =>
                meanMargin(e) > meanMargin(m) ? e : m
            );
        }
    }

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
    if (rootState && botId && best.move.kind === "declare-blockers") {
        const blocks = pool.filter(
            (e) =>
                e.move.kind === "declare-blockers" &&
                mean(e) >= bestMean - OUTCOME_EPS
        );
        if (blocks.length > 0) {
            best = blocks
                .map((e) => ({
                    e,
                    delta: blockDeltaOf(rootState, e.move, botId),
                }))
                .reduce((m, x) => (x.delta > m.delta ? x : m)).e;
        }
    }

    // Self-harm removal tie-break (issue #365). A one-sided removal / destruction
    // Spell aimed at the bot's OWN beneficial Permanent is pure self-harm: it
    // loses a useful Permanent for no upside. The eval now registers that loss
    // (evaluate.ts), but a thin loss can still tie `pass` (or an enemy-target
    // cast) inside `OUTCOME_EPS` on rollout noise — the reported destroy-own-
    // Castle case. When the robust pick IS such a self-harm cast, redirect it:
    //   1. prefer an outcome-equal cast of the SAME Spell at a non-self-harming
    //      (enemy / beneficial) target — the friendly-vs-enemy preference; else
    //   2. prefer an outcome-equal `pass` — hold the Spell over destroying own
    //      board.
    // Pulled from the FULL `pool` on outcome-equality alone (not the visit band),
    // as the land-drop / hold-trick rules are: the alternative is the
    // lower-variance, lower-visit line. Fires ONLY among outcome-equal
    // contenders, so a self-target with REAL value (a genuine sacrifice-for-
    // value) is NOT flagged by `isSelfHarmRemovalCast` (its resolved margin does
    // not drop) and never reaches here.
    if (
        rootState &&
        botId &&
        isSelfHarmRemovalCast(rootState, best.move, botId)
    ) {
        const enemyTarget = pool.find(
            (e) =>
                mean(e) >= bestMean - OUTCOME_EPS &&
                isAlternativeTargetCast(rootState, e.move, best.move, botId)
        );
        if (enemyTarget) return enemyTarget.move;
        const hold = pool.find(
            (e) => e.move.kind === "pass" && mean(e) >= bestMean - OUTCOME_EPS
        );
        if (hold) return hold.move;
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
    if (best.move.kind === "pass") {
        const develop = pool.find(
            (e) =>
                mean(e) >= bestMean - OUTCOME_EPS &&
                (e.move.kind === "play-land" ||
                    (!!rootState &&
                        (isFreeManaSourceCast(rootState, e.move, botId) ||
                            isManaDorkCast(rootState, e.move, botId))))
        );
        if (develop) return develop.move;
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
    if (rootState && isSorcerySpeedTrickDump(rootState, best.move)) {
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
            (e) => e.move.kind === "pass" && mean(e) >= bestMean - OUTCOME_EPS
        );
        if (hold) return hold.move;
    }
    return best.move;
}

/** Whether `move` dumps a held combat TRICK (a `pump` hint) at sorcery speed
 *  (ADR 0021, issue #229) — a `cast-spell` of an Instant whose `aiCombatHint`
 *  declares a pump, cast by the active player at a main phase (the window where
 *  it could instead be held for the combat-step ambush). Used by the
 *  hold-the-trick selection tie-break.
 *
 *  Scoped to PUMP tricks only — NOT removal. A pump's sole use is combat, so
 *  spending it pre-combat is dominated by holding it whenever the two are
 *  outcome-equal (the land-drop analogy: no reason to commit early). Removal is
 *  deliberately excluded: a removal cast at sorcery speed can be the correct,
 *  decisive play (killing a blocker, going face for lethal — e.g. a lethal
 *  Lightning Bolt), so it must be left to win or lose on mean reward, never
 *  redirected to `pass`. Pure. */
function isSorcerySpeedTrickDump(state: GameState, move: Move): boolean {
    if (move.kind !== "cast-spell") return false;
    const atSorcerySpeed =
        state.phase === "PRECOMBAT_MAIN" || state.phase === "POSTCOMBAT_MAIN";
    if (!atSorcerySpeed) return false;
    const player = state.players.find((p) => p.id === state.activePlayerId);
    const card = player?.hand.find((c) => c.id === move.cardInstanceId);
    if (!card || !card.types.includes("Instant")) return false;
    const cardId = (card.card as { id?: string } | undefined)?.id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    return !!def?.aiCombatHint?.pump;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Choose a move for `playerId` by ISMCTS, and surface a DecisionTrace of what
 *  was weighed. Deterministic given `seed` and an iteration budget — the trace
 *  is built only after the move is chosen, so it never perturbs selection. The
 *  trace is null when there was no real decision to explain (no action owed, or
 *  a single forced move). */
export function searchWithTrace(
    state: GameState,
    playerId: string,
    budget: SearchBudget,
    seed: number
): { move: Move | null; trace: DecisionTrace | null } {
    const decider = decidingPlayer(state);
    if (decider !== playerId) return { move: null, trace: null };

    const moves = enumerateMoves(state, playerId);
    if (moves.length === 0) return { move: null, trace: null };
    // No real decision (e.g. a forced mulligan window) — return immediately
    // without paying for search (and with no trace to explain).
    if (moves.length === 1 || state.phase === "MULLIGAN") {
        return { move: moves[0], trace: null };
    }

    const rng = makeRng(seed);
    const root = newNode();

    const maxIter = budget.iterations ?? Infinity;
    const timeMs = budget.timeMs;
    const now = budget.now ?? (() => performance.now());
    const start = timeMs !== undefined ? now() : 0;

    let i = 0;
    while (i < maxIter) {
        iterate(root, state, playerId, rng);
        i++;
        if (timeMs !== undefined && now() - start >= timeMs) break;
    }

    const move = selectRootMove(root, moves, state, playerId);
    return { move, trace: buildTrace(root, state, playerId, i, move) };
}

/** Choose a move for `playerId` by ISMCTS. Deterministic given `seed` and an
 *  iteration budget. Returns null when the player owes no action. Thin wrapper
 *  over `searchWithTrace` (it discards the trace) so non-debug callers and the
 *  existing tests keep the same `Move | null` contract. */
export function search(
    state: GameState,
    playerId: string,
    budget: SearchBudget,
    seed: number
): Move | null {
    return searchWithTrace(state, playerId, budget, seed).move;
}
