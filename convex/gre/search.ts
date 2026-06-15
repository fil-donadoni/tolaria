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
import { enumerateMoves, type Move } from "./moves";
import {
    evaluate,
    evaluateBreakdown,
    materialMargin,
    WIN_SCORE,
    type PositionBreakdown,
} from "./evaluate";
import { describeMove } from "./describeMove";
import { determinize } from "./determinize";
import { makeRng } from "./rng";

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
export const DEFAULT_BUDGET: SearchBudget = { iterations: 400, timeMs: 300 };

/** UCB1 exploration constant. */
const UCB_C = 1.4;
/** Truncated-rollout horizon (plies) before falling back to the heuristic. */
const ROLLOUT_DEPTH = 8;
/** Hard cap on plies applied while descending the tree in one iteration —
 *  guards against a pathological no-progress cycle (e.g. mutual passing across
 *  empty turns until someone decks). */
const MAX_TREE_DEPTH = 40;
/** Chance the rollout policy plays a uniform-random move instead of the
 *  immediate-best one — keeps playouts from collapsing to a single line. */
const ROLLOUT_EPSILON = 0.25;
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
 *  to this cap — not `tanh` — so a single creature's worth of material (~5–8)
 *  shifts the reward by a fixed, decision-relevant amount regardless of how far
 *  ahead the bot already is. `tanh` saturates near a decided position and was
 *  the root cause: the creature delta vanished into the flat tail. */
const MATERIAL_FULL = 24;

/** Map a material margin to [-1, 1], linear (constant slope) until it saturates
 *  at ±`MATERIAL_FULL`. Linear is deliberate: the discriminating quantity is a
 *  fixed material delta, which must move the reward by the same amount whether
 *  the absolute margin is small or large. */
function materialSignal(margin: number): number {
    const x = margin / MATERIAL_FULL;
    return x < -1 ? -1 : x > 1 ? 1 : x;
}

type Edge = {
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

type Node = {
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
function reward(state: GameState, botId: string): number {
    const v = evaluate(state, botId);
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
function applyMoveInSearch(
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
                    atk.isTapped = true;
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

/** Play `state` forward to a stable leaf with a cheap policy, then score it.
 *  Policy: with probability `ROLLOUT_EPSILON` a uniform-random legal move,
 *  otherwise the move with the best immediate reward for its mover (a 1-ply
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
 *  otherwise the move with the best immediate reward for its mover (a 1-ply
 *  greedy step). Bounded by `ROLLOUT_DEPTH`. Mutates `state` (caller owns it). */
function rollout(state: GameState, botId: string, rng: () => number): Leaf {
    for (let d = 0; d < ROLLOUT_DEPTH; d++) {
        if (state.gameOver) break;
        const pid = decidingPlayer(state);
        if (!pid) break;
        const moves = enumerateMoves(state, pid);
        if (moves.length === 0) break;

        let chosen: Move;
        if (moves.length === 1 || rng() < ROLLOUT_EPSILON) {
            chosen = moves[Math.floor(rng() * moves.length)];
        } else {
            chosen = bestImmediateMove(state, pid, botId, moves, rng);
        }
        applyMoveInSearch(state, pid, chosen);
    }
    return scoreLeaf(state, botId);
}

/** The move maximizing the mover's immediate reward (1-ply lookahead), with an
 *  RNG tie-break. Each candidate is probed on a clone so `state` is untouched. */
function bestImmediateMove(
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
        const r = reward(probe, botId);
        const moverReward = moverIsBot ? r : 1 - r;
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
            const val = ucb1(edge);
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
function selectRootMove(root: Node, moves: Move[]): Move {
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
    return best.move;
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

    const move = selectRootMove(root, moves);
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
