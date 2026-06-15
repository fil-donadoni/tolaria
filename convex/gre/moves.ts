// Macro-move enumeration for the vs-AI Bot (ADR 0001, issue #110).
//
// `enumerateMoves(state, playerId)` returns the complete set of legal ATOMIC
// macro-moves at the current decision point: a single `Move` bundles a player's
// full intent (which spell, which targets, which X, which attacker set, which
// blocker assignment) so the search/random layer can pick ONE and the executor
// (`src/lib/ai/executor.ts`) replays it through the EXISTING granular mutations.
// No new Convex move surface is introduced.
//
// PURE: no Math.random, no mutation, no ctx. Reuses the same legality helpers
// the human UI uses (`getLegalActions`, `getLegalTargets`, combat validators)
// so an enumerated move that the server then rejects is a bug, not a feature —
// the server stays the sole authority (CR 720), this is only a candidate list.
//
// Combinatorial windows (attacker subsets, blocker assignments, multi-target
// spells, X spells) are bounded by `MAX_COMBINATIONS`: for the small positions
// that matter to play and to tests the full set is enumerated; pathological
// boards are capped to a representative bounded sample (see comments at each
// site) rather than exploding. Caps are documented, never silent.

import type { Color, TargetRequirement, TargetSelection } from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { normalizeManaCost } from "./state";
import {
    getLegalActions,
    getLegalTargets,
    getProducibleManaOptions,
} from "./rules";
import { STATIC_EFFECT_CTX } from "./layers";
import { MANA_COLORS, isTapLockedBySummoningSickness } from "./constants";
import {
    getRequiredAttackerIds,
    getMaxBlockTargets,
    validateAttackerEligibility,
    validateBlockerEligibility,
} from "./combat";
import { getInstanceManaCost, tryGetCardById } from "../cards";

/** One land tap the executor must perform to fund a cast/activation. */
export type ManaTap = { cardInstanceId: string; manaChoiceIndex?: number };

/** A single legal macro-move. Each kind is realised by the executor through a
 *  fixed sequence of EXISTING mutations (see `executeMove`). */
export type Move =
    | { kind: "pass" }
    | { kind: "mulligan"; decision: "keep" | "mull" }
    | {
          /** Post-mulligan bottoming submission (CR 103.5). Realised through the
           *  existing `submitResolutionChoice` mutation (kind "mulligan-bottom");
           *  the choice identity is read from the active pending choice. */
          kind: "mulligan-bottom";
          stackItemId: string;
          step: number;
          choiceId: string;
          cardInstanceIds: string[];
      }
    | { kind: "play-land"; cardInstanceId: string }
    | {
          kind: "cast-spell";
          cardInstanceId: string;
          chosenModeId?: string;
          chosenX?: number;
          targets: TargetSelection[];
          /** Variable-count targets (CR 601.2c "up to"/X) need an explicit
           *  confirmTargets; fixed-N selections auto-finalize on the last pick. */
          confirmTargets: boolean;
          /** Lands to tap, in order, to cover the cost (pool mana is auto-used
           *  by the server at commit and needs no tap). */
          tapPlan: ManaTap[];
      }
    | {
          kind: "activate-ability";
          cardInstanceId: string;
          abilityId: string;
          chosenX?: number;
          targets: TargetSelection[];
          confirmTargets: boolean;
          tapPlan: ManaTap[];
      }
    | { kind: "declare-attackers"; attackerIds: string[] }
    | {
          kind: "declare-blockers";
          /** blocker → the single attacker it blocks (single-block this slice). */
          assignments: { blockerId: string; attackerId: string }[];
      };

/** Upper bound on combinations emitted per combinatorial window. Keeps a
 *  20-creature board from emitting 2^20 attacker subsets. Small real/test
 *  positions stay well under this and are enumerated exhaustively. */
export const MAX_COMBINATIONS = 64;

// ---------------------------------------------------------------------------
// Mana payment planning
// ---------------------------------------------------------------------------

type PlanSource = {
    /** undefined = mana already in the pool (no tap needed). */
    cardInstanceId?: string;
    options: Map<Color, number | undefined>;
};

/** Greedy tap plan covering a normalized mana cost (CR 601.2f). Returns the
 *  ordered land taps to perform, or `null` when the cost cannot be paid. Mirrors
 *  `canPotentiallyPayCost` (rules.ts) — same one-source-one-mana model — but
 *  emits the concrete sources. Pool mana is modelled as zero-tap sources and is
 *  consumed by the server at commit, so it never appears in the returned taps. */
export function planManaPayment(
    player: PlayerState,
    cost: Record<string, number>
): ManaTap[] | null {
    const totalRequired =
        (cost.X ?? 0) + MANA_COLORS.reduce((s, c) => s + (cost[c] ?? 0), 0);
    if (totalRequired === 0) return [];

    const sources: PlanSource[] = [];
    for (const c of MANA_COLORS) {
        const n = player.manaPool[c] ?? 0;
        for (let i = 0; i < n; i++) {
            sources.push({ options: new Map([[c, undefined]]) });
        }
    }
    for (const perm of player.battlefield) {
        if (perm.isTapped) continue;
        // CR 302.1 — a summoning-sick creature can't pay {T}.
        if (isTapLockedBySummoningSickness(perm)) continue;
        const options = getProducibleManaOptions(perm);
        if (options.size === 0) continue;
        sources.push({ cardInstanceId: perm.id, options });
    }
    if (sources.length < totalRequired) return null;

    const remaining = sources.map((s) => ({
        cardInstanceId: s.cardInstanceId,
        options: new Map(s.options),
    }));
    const taps: ManaTap[] = [];
    const consume = (idx: number, color: Color) => {
        const src = remaining[idx];
        if (src.cardInstanceId) {
            const choice = src.options.get(color);
            taps.push(
                choice === undefined
                    ? { cardInstanceId: src.cardInstanceId }
                    : {
                          cardInstanceId: src.cardInstanceId,
                          manaChoiceIndex: choice,
                      }
            );
        }
        remaining.splice(idx, 1);
    };

    // Colored requirements first, taking the least-flexible source that can
    // produce that color (basic land before dual, etc.).
    for (const c of MANA_COLORS) {
        let need = cost[c] ?? 0;
        while (need > 0) {
            let bestIdx = -1;
            let bestSize = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const s = remaining[i];
                if (s.options.has(c) && s.options.size < bestSize) {
                    bestIdx = i;
                    bestSize = s.options.size;
                }
            }
            if (bestIdx === -1) return null;
            consume(bestIdx, c);
            need--;
        }
    }

    // Generic remainder: prefer pool sources (no tap), then least-flexible card.
    let generic = cost.X ?? 0;
    while (generic > 0) {
        if (remaining.length === 0) return null;
        let idx = remaining.findIndex((s) => !s.cardInstanceId);
        if (idx === -1) {
            let bestSize = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                if (remaining[i].options.size < bestSize) {
                    bestSize = remaining[i].options.size;
                    idx = i;
                }
            }
        }
        const color = remaining[idx].options.keys().next().value as Color;
        consume(idx, color);
        generic--;
    }

    return taps;
}

/** How much generic mana, beyond a fixed cost, the player could still pay — the
 *  ceiling on a meaningful chosen X. Bounded so X spells don't explode. */
function maxAffordableExtra(
    player: PlayerState,
    fixedCost: Record<string, number>
): number {
    let extra = 0;
    while (extra < MAX_COMBINATIONS) {
        const probe = { ...fixedCost, X: (fixedCost.X ?? 0) + extra + 1 };
        if (planManaPayment(player, probe) === null) break;
        extra++;
    }
    return extra;
}

// ---------------------------------------------------------------------------
// Combination helpers
// ---------------------------------------------------------------------------

/** All size-`k` combinations of `items`, capped at `MAX_COMBINATIONS`. */
function combinations<T>(items: T[], k: number): T[][] {
    const out: T[][] = [];
    const pick = (start: number, acc: T[]) => {
        if (out.length >= MAX_COMBINATIONS) return;
        if (acc.length === k) {
            out.push([...acc]);
            return;
        }
        for (let i = start; i < items.length; i++) {
            acc.push(items[i]);
            pick(i + 1, acc);
            acc.pop();
        }
    };
    pick(0, []);
    return out;
}

/** Power set of `items`, capped at `MAX_COMBINATIONS`. */
function powerSet<T>(items: T[]): T[][] {
    const out: T[][] = [[]];
    for (const item of items) {
        const next: T[][] = [];
        for (const subset of out) {
            next.push(subset);
            if (out.length + next.length <= MAX_COMBINATIONS) {
                next.push([...subset, item]);
            }
        }
        out.length = 0;
        out.push(...next);
        if (out.length >= MAX_COMBINATIONS) break;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Cast / target / X / mode expansion
// ---------------------------------------------------------------------------

/** Variable-count requirements (X or {min,max}) finalize via confirmTargets;
 *  a plain numeric count auto-finalizes on the last selectTarget. */
function isVariableCount(req: TargetRequirement | undefined): boolean {
    if (!req) return false;
    return req.count === "X" || typeof req.count === "object";
}

function targetCount(
    req: TargetRequirement,
    chosenX: number | undefined
): {
    min: number;
    max: number;
} {
    if (req.count === "X") {
        const x = chosenX ?? 0;
        return { min: x, max: x };
    }
    if (typeof req.count === "number")
        return { min: req.count, max: req.count };
    return { min: req.count.min, max: req.count.max ?? req.count.min };
}

/** Every legal target tuple for one (mode) requirement at a chosen X. Returns
 *  `[[]]` (the empty tuple) when the requirement is absent or satisfiable with
 *  zero targets, so a no-target cast is always represented. */
function enumerateTargetTuples(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    req: TargetRequirement | undefined,
    chosenX: number | undefined
): TargetSelection[][] {
    if (!req) return [[]];
    const sourceColors = STATIC_EFFECT_CTX.getColors(card);
    const legal = getLegalTargets(state, req, sourceColors, player.id, chosenX);
    const { min, max } = targetCount(req, chosenX);
    if (max === 0) return [[]];

    const tuples: TargetSelection[][] = [];
    for (let size = min; size <= max; size++) {
        if (size === 0) {
            tuples.push([]);
            continue;
        }
        for (const combo of combinations(legal, size)) {
            tuples.push(combo);
            if (tuples.length >= MAX_COMBINATIONS) return tuples;
        }
    }
    // A spell that requires ≥1 target but has none stays castable only when the
    // requirement is optional (min 0); otherwise getLegalActions wouldn't have
    // offered "cast". Guard anyway so we never emit an unfulfillable move.
    return tuples.length > 0 ? tuples : min === 0 ? [[]] : [];
}

function enumerateCastMoves(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): Move[] {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : undefined;
    const rawCost = getInstanceManaCost(card) ?? {};

    // Modal spells (CR 700.2): one variant per mode, each with its own targets.
    const modeVariants =
        def?.modes && def.modes.length > 0
            ? def.modes.map((m) => ({
                  modeId: m.id as string | undefined,
                  req: m.targetRequirement,
              }))
            : [{ modeId: undefined, req: def?.targetRequirement }];

    // X spells: enumerate X = 0..maxAffordable. Fixed (numeric) costs use a
    // single X = undefined.
    const hasX = typeof rawCost.X === "string";
    const fixedNorm = normalizeManaCost(rawCost, { chosenX: 0 });
    const xValues: (number | undefined)[] = hasX
        ? Array.from(
              { length: maxAffordableExtra(player, fixedNorm) + 1 },
              (_, i) => i
          )
        : [undefined];

    const moves: Move[] = [];
    for (const { modeId, req } of modeVariants) {
        for (const x of xValues) {
            const normCost = normalizeManaCost(rawCost, { chosenX: x ?? 0 });
            const tapPlan = planManaPayment(player, normCost);
            if (tapPlan === null) continue;
            for (const targets of enumerateTargetTuples(
                state,
                player,
                card,
                req,
                x
            )) {
                moves.push({
                    kind: "cast-spell",
                    cardInstanceId: card.id,
                    chosenModeId: modeId,
                    chosenX: x,
                    targets,
                    confirmTargets: isVariableCount(req) && targets.length > 0,
                    tapPlan,
                });
                if (moves.length >= MAX_COMBINATIONS) return moves;
            }
        }
    }
    return moves;
}

// ---------------------------------------------------------------------------
// Activated abilities (conservative: tap + mana stack abilities only)
// ---------------------------------------------------------------------------

function enumerateAbilityMoves(
    state: GameState,
    player: PlayerState,
    perm: CardInstanceState
): Move[] {
    const cardId = (perm.card as { id?: string }).id;
    const def = cardId ? tryGetCardById(cardId) : undefined;
    if (!def?.activatedAbilities) return [];

    const moves: Move[] = [];
    for (const ability of def.activatedAbilities) {
        // Only abilities that use the stack are macro-moves here; mana abilities
        // are funded on demand by the cast planner, never activated standalone.
        if (!ability.useStack) continue;
        // Conditional abilities need a runtime predicate we don't replicate;
        // leave them to a later slice rather than enumerate possibly-illegal
        // moves. (Documented limitation — server would reject anyway.)
        if (ability.canActivate || ability.getTargetRequirement) continue;
        // CR 602.5 — once-per-turn enforcement.
        if (
            ability.oncePerTurn &&
            (perm.activationsThisTurn?.[ability.id] ?? 0) > 0
        ) {
            continue;
        }
        // CR 117.1b — phase/turn restrictions.
        if (
            ability.activationPhaseRestriction &&
            ability.activationPhaseRestriction.length > 0 &&
            !ability.activationPhaseRestriction.includes(state.phase)
        ) {
            continue;
        }
        if (ability.controllerTurnOnly && state.activePlayerId !== player.id) {
            continue;
        }
        // Tap cost: source must be untapped and not summoning-locked.
        if (ability.cost.tap) {
            if (perm.isTapped) continue;
            if (isTapLockedBySummoningSickness(perm)) continue;
        }
        // Mana cost: must be payable. The {T} part of the cost is paid by the
        // activate mutation itself, not by the tap plan.
        const manaCost = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : {};
        const tapPlan = planManaPayment(player, manaCost);
        if (tapPlan === null) continue;

        const tuples = enumerateTargetTuples(
            state,
            player,
            perm,
            ability.targetRequirement,
            undefined
        );
        for (const targets of tuples) {
            moves.push({
                kind: "activate-ability",
                cardInstanceId: perm.id,
                abilityId: ability.id,
                targets,
                confirmTargets:
                    isVariableCount(ability.targetRequirement) &&
                    targets.length > 0,
                tapPlan,
            });
            if (moves.length >= MAX_COMBINATIONS) return moves;
        }
    }
    return moves;
}

// ---------------------------------------------------------------------------
// Combat declaration
// ---------------------------------------------------------------------------

function otherPlayer(
    state: GameState,
    playerId: string
): PlayerState | undefined {
    return state.players.find((p) => p.id !== playerId);
}

function enumerateAttackerMoves(state: GameState, player: PlayerState): Move[] {
    const defender = otherPlayer(state, player.id);
    const defBf = defender?.battlefield;
    const eligible = player.battlefield.filter(
        (c) => validateAttackerEligibility(c, defBf, state).eligible
    );
    const required = new Set(
        getRequiredAttackerIds(player.battlefield, defBf, undefined)
    );
    const optional = eligible.filter((c) => !required.has(c.id));
    const requiredIds = [...required];

    // Each optional subset, always unioned with the forced attackers.
    return powerSet(optional).map((subset) => ({
        kind: "declare-attackers" as const,
        attackerIds: [...requiredIds, ...subset.map((c) => c.id)],
    }));
}

function enumerateBlockerMoves(state: GameState, player: PlayerState): Move[] {
    const combat = state.combat;
    if (!combat) return [{ kind: "declare-blockers", assignments: [] }];
    const attackerIds = combat.attackerIds;
    const attackers = attackerIds
        .map((id) => findCard(state, id))
        .filter((c): c is CardInstanceState => c !== undefined);

    // For each candidate blocker, the attackers it may legally block, plus the
    // option to stay back (null).
    const perBlocker: {
        blocker: CardInstanceState;
        options: (string | null)[];
    }[] = [];
    for (const blocker of player.battlefield) {
        if (!blocker.types.includes("Creature")) continue;
        if (blocker.isTapped) continue;
        const legal = attackers.filter(
            (atk) =>
                validateBlockerEligibility(
                    atk,
                    blocker,
                    player.battlefield,
                    state
                ).eligible
        );
        if (legal.length === 0) continue;
        // Single-block this slice (max-block grants beyond 1 are a later slice).
        getMaxBlockTargets(blocker); // reserved for multi-block expansion
        perBlocker.push({
            blocker,
            options: [null, ...legal.map((a) => a.id)],
        });
    }

    if (perBlocker.length === 0) {
        return [{ kind: "declare-blockers", assignments: [] }];
    }

    // Cartesian product of per-blocker choices, capped.
    let combos: { blockerId: string; attackerId: string }[][] = [[]];
    for (const { blocker, options } of perBlocker) {
        const next: { blockerId: string; attackerId: string }[][] = [];
        for (const combo of combos) {
            for (const opt of options) {
                next.push(
                    opt === null
                        ? combo
                        : [...combo, { blockerId: blocker.id, attackerId: opt }]
                );
                if (next.length >= MAX_COMBINATIONS) break;
            }
            if (next.length >= MAX_COMBINATIONS) break;
        }
        combos = next;
        if (combos.length >= MAX_COMBINATIONS) break;
    }

    return combos.map((assignments) => ({
        kind: "declare-blockers" as const,
        assignments,
    }));
}

function findCard(state: GameState, id: string): CardInstanceState | undefined {
    for (const p of state.players) {
        const c = p.battlefield.find((x) => x.id === id);
        if (c) return c;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** The complete set of legal macro-moves for `playerId` at the current decision
 *  point. Empty when the player owes no action right now. Pure. */
export function enumerateMoves(state: GameState, playerId: string): Move[] {
    if (state.gameOver) return [];
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return [];

    // Pre-game mulligan declaration window (CR 103.5).
    if (state.phase === "MULLIGAN") {
        const m = state.mulligan;
        if (m && !m.bottoming && m.declaringPlayerId === playerId) {
            return [
                { kind: "mulligan", decision: "keep" },
                { kind: "mulligan", decision: "mull" },
            ];
        }
        return [];
    }

    // Combat declarations are gated before priority can pass (CR 508/509); the
    // server rejects passPriority until they are confirmed, so resolve them
    // first regardless of who holds priority.
    const combat = state.combat;
    if (
        state.phase === "DECLARE_ATTACKERS" &&
        combat &&
        !combat.confirmed &&
        state.activePlayerId === playerId
    ) {
        return enumerateAttackerMoves(state, player);
    }
    if (
        state.phase === "DECLARE_BLOCKERS" &&
        combat &&
        combat.confirmed &&
        !combat.blockersConfirmed &&
        state.activePlayerId !== playerId
    ) {
        return enumerateBlockerMoves(state, player);
    }

    // Ordinary priority window. A mid-flight pending cast/target/activation or a
    // resolution choice is a continuation the executor drives atomically, not a
    // fresh macro-move — surface nothing so the driver waits.
    if (state.priorityPlayerId !== playerId) return [];
    if (
        state.pendingCast ||
        state.pendingTarget ||
        state.pendingActivation ||
        (state.pendingChoices && state.pendingChoices.length > 0)
    ) {
        return [];
    }

    const moves: Move[] = [{ kind: "pass" }];
    for (const card of player.hand) {
        const actions = getLegalActions(state, player, card);
        if (actions.includes("play")) {
            moves.push({ kind: "play-land", cardInstanceId: card.id });
        }
        if (actions.includes("cast")) {
            moves.push(...enumerateCastMoves(state, player, card));
        }
    }
    for (const perm of player.battlefield) {
        moves.push(...enumerateAbilityMoves(state, player, perm));
    }
    return moves;
}
