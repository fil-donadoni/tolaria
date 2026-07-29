// Dominance pruning for the bot's move enumeration (issue #1887).
//
// The Brain used to offer — and about half the time PICK — moves whose
// resolution is a PROVABLE no-op: Damnation with no creature on either
// battlefield, Sheoldred's Edict against an opponent with no creature and no
// planeswalker, a Sandstorm Salvager activation with no token on the board, a
// Vision Charm mode that changes nothing. The reward band saturates
// (`MATERIAL_FULL`, `search.ts`), so a no-op cast and `pass` tie inside
// `OUTCOME_EPS` and the pick falls to rollout noise.
//
// The historical patch shape was another narrow root tie-break in
// `selectRootMove` (there are six). This module is the generic replacement: ONE
// per-card-agnostic seam that PROVES a move is dominated by `pass` and drops it
// from `enumerateMoves`, so the search never spends an iteration on it.
//
// ── Where it runs, and what it costs ──────────────────────────────────────
// A probe is expensive: three `cloneGameState`s and a whole-`GameState` deep
// compare, ~6× the cost of the enumeration it filters. So it is paid ONCE per
// decision — `searchWithTrace` proves the root move set, then reuses the
// verdict as a deny-set for the tree's root layer on every iteration
// (`iterate`'s `prunedRootKeys`). In-tree enumeration (`keyedMovesFor`) does
// NOT probe. Probing there measured 42.6% of a 300-iteration search's wall
// clock (1682 probed enumerations) — and since the budget is ITERATION-based
// that is not "freed iterations deepen every other line", it is a straight
// ~1.75× think-time regression (issue #1905 review finding 3).
//
// The accepted tradeoff of proving only at the root: a move that becomes
// provably futile DEEPER in the tree is still searched. That is the cheap side
// of the trade — the bot's actual PICK is a root decision, and the root layer
// is where a no-op stole visits from real lines.
// `dominanceProbeStats().probes` pins this: it is a function of the root move
// list alone, asserted equal for a 40- and a 400-iteration search.
//
// ── The proof ─────────────────────────────────────────────────────────────
// A move is dominated by `pass` when, applied and resolved to completion on a
// CLONE, the resulting position is byte-identical to the untouched baseline in
// every term except the mover's own COST: the card it spent, the mana/permanents
// it tapped, and the cast/activation bookkeeping that spending implies. Both
// battlefields, both life totals, both libraries, both graveyards, the
// opponent's hand, every counter, every continuous-effect ledger — all compared
// for exact equality. Anything short of exact equality is left to the search:
// this seam never encodes "probably not worth it".
//
// The comparison is FAIL-CLOSED by construction. It deep-compares the WHOLE
// `GameState` and subtracts a short, explicit ignore list; a `GameState` field
// added tomorrow is compared by default, so the worst a new field can do is make
// the pruner more conservative (offer a move it could have dropped) — never
// prune a move that does something.
//
// ── Guards ────────────────────────────────────────────────────────────────
//   * `pass` is never a candidate, so the `moves.length` floor in
//     `enumerateMoves` can never be emptied.
//   * A land drop and any spell that puts a PERMANENT onto the battlefield are
//     never probed — board presence is a real delta (and free development is
//     already the ADR 0020 §1 root rule's business).
//   * Nothing is probed while a `pendingChoice` / `pendingCast` /
//     `pendingTarget` / `pendingActivation` is live — those windows return early
//     from `enumerateMoves` anyway.
//   * Mana abilities (`useStack: false`) are never probed: they never touch the
//     stack, so there is nothing for the probe to resolve.
//   * The mover's MANA POOL is compared, not ignored (issue #1905 review): the
//     probe never credits or debits the pool, so a difference there is mana the
//     RESOLUTION made. A ritual is never prunable.
//   * An activated ability whose cost is anything other than tap + mana is never
//     probed — a sacrifice / discard / exile / life / counter cost can itself be
//     the payoff (a death trigger, a graveyard filler), and the probe models
//     costs only coarsely.
//   * The probe is pure: it runs on `cloneGameState` clones and never touches
//     the caller's state. A re-entrancy latch stops a probe from probing.
//
// ── Documented narrowings ─────────────────────────────────────────────────
// The probe pays costs coarsely (tap plan marks sources tapped, no pool
// accounting — the same model `applyMoveInSearch`/`applyMoveForSearch` use; this
// is precisely what makes a pool DIFFERENCE attributable to the resolution), and
// does not emit ABILITY_ACTIVATED (`recordActivation` is private to `game.ts`).
// It DOES emit SPELL_CAST and flush the resulting cast triggers, so a
// Guttersnipe-style "whenever you cast" payoff is seen and blocks the prune.
// Storm counters (`spellsCastThisTurn`, global and per-player) are on the ignore
// list: they move on every cast, so counting them would make nothing prunable.
// A cast whose ONLY value is raising the storm count is therefore prunable —
// accepted, and the storm payoff itself (a cast trigger) is not affected.

import type { CardInstanceState, GameState, StackItem } from "../state";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    removeFromZone,
    resolveTopOfStack,
} from "../state";
import { checkStateBasedActions } from "../sba";
import { cloneGameState } from "../clone";
import { PERMANENT_TYPES } from "../constants";
import { tryGetDefinition } from "../../cards";
import { choiceCandidates } from "./choiceCandidates";
import {
    applyMayPaySubmit,
    applyPendingChoiceSubmit,
} from "../pendingChoiceSubmit";
// Type-only: erased at compile time, so `moves.ts` importing this module back
// is NOT a runtime import cycle.
import type { Move } from "../moves";

/** Bound on stack resolutions per probe branch. A spell plus its triggers
 *  settles well inside this; anything deeper is unprovable, not pruned. */
const MAX_SETTLE_STEPS = 8;
/** Bound on branches opened per mid-resolution choice. `CHOICE_TOP_K` is 8, so
 *  this admits every choice the search itself would consider. */
const MAX_CHOICE_BRANCHES = 8;
/** Bound on nested mid-resolution choices. One level (Vision Charm's "basic
 *  land type of your choice") is the shape that occurs; deeper is unprovable. */
const MAX_CHOICE_DEPTH = 1;

/** Re-entrancy latch. The probe drives real resolution, which can reach code
 *  that enumerates moves; without this a probe could probe itself. */
let probing = false;

/** Work accounting, for the two things about this module that must stay pinned.
 *
 *  `probes` — how many probes actually RAN (past every cheap gate). A probe is
 *  three `cloneGameState`s plus a whole-`GameState` deep compare, the single
 *  dominant cost here, so its COUNT is what a cost guard should assert on:
 *  unlike a wall-clock budget it is deterministic and machine-independent.
 *  `search.ts` probes ONCE per search (at the root, `searchWithTrace`) and the
 *  guard fails if that ever starts scaling with the iteration budget again
 *  (issue #1905 review finding 3).
 *
 *  `choiceBranches` — how many mid-resolution CHOICE branches the all-branches
 *  quantifier opened. A test asserting only the verdict can't tell "every mode
 *  proved a no-op" from "the probe never reached a choice at all"; this counter
 *  is what makes the quantifier's coverage observable (review finding 2). */
let stats = { probes: 0, choiceBranches: 0 };

/** Work done since {@link resetDominanceProbeStats}. Test/diagnostic seam. */
export function dominanceProbeStats(): {
    probes: number;
    choiceBranches: number;
} {
    return { ...stats };
}

/** Zero the counters. Test/diagnostic seam. */
export function resetDominanceProbeStats(): void {
    stats = { probes: 0, choiceBranches: 0 };
}

// ---------------------------------------------------------------------------
// Public seam
// ---------------------------------------------------------------------------

/** True when `move` is PROVABLY dominated by `pass` for `pid`: applying and
 *  fully resolving it changes nothing but the mover's own cost. Pure — `state`
 *  is never mutated. Conservative: any doubt returns `false`. */
export function isDominatedNoOpMove(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (probing) return false;
    if (move.kind !== "cast-spell" && move.kind !== "activate-ability") {
        return false;
    }
    if (state.gameOver) return false;
    // Mid-flight continuations: `enumerateMoves` returns [] in these windows
    // anyway, but the seam is public — keep it honest on its own.
    if (
        state.pendingCast ||
        state.pendingTarget ||
        state.pendingActivation ||
        state.pendingCompanionPay ||
        (state.pendingChoices?.length ?? 0) > 0
    ) {
        return false;
    }
    if (!state.players.some((p) => p.id === pid)) return false;

    probing = true;
    stats.probes++;
    try {
        const baseline = state;
        const probe = cloneGameState(state);
        const spentCardId =
            move.kind === "cast-spell" ? move.cardInstanceId : undefined;
        const applied =
            move.kind === "cast-spell"
                ? applyProbeCast(probe, pid, move)
                : applyProbeActivation(probe, pid, move);
        if (!applied) return false;
        return branchesAllNoOp(probe, baseline, pid, spentCardId, 0);
    } catch {
        // A probe that throws proves nothing. Never let it change legality.
        return false;
    } finally {
        probing = false;
    }
}

// ---------------------------------------------------------------------------
// Probe application — leaf engine calls only (no `search.ts` / `applyMove.ts`,
// so this module stays off `moves.ts`' runtime import graph)
// ---------------------------------------------------------------------------

/** Mark the planned mana sources tapped. Coarse by design: the probe neither
 *  credits the pool from the tapped sources nor debits the spell's cost, so the
 *  mover's pool is untouched by cost payment — which is exactly what lets
 *  `isNoOpDelta` COMPARE the pool and see only what the resolution added. The
 *  tap itself is forgiven there (untapped → tapped is a cost, untapping is a
 *  delta). */
function applyTapPlan(
    state: GameState,
    pid: string,
    tapPlan: { cardInstanceId: string }[]
): void {
    const player = state.players.find((p) => p.id === pid);
    if (!player) return;
    for (const tap of tapPlan) {
        const src = player.battlefield.find((c) => c.id === tap.cardInstanceId);
        if (src) src.isTapped = true;
    }
}

/** Put the cast spell on the probe's stack exactly as the real cast does
 *  (CR 601.2i): card leaves hand, stack item carries targets / X / mode, the
 *  SPELL_CAST event fires and its triggers are flushed onto the stack above the
 *  spell. Returns false when the move can't be realised. */
function applyProbeCast(
    probe: GameState,
    pid: string,
    move: Extract<Move, { kind: "cast-spell" }>
): boolean {
    const player = probe.players.find((p) => p.id === pid);
    if (!player) return false;
    if (!player.hand.some((c) => c.id === move.cardInstanceId)) return false;
    applyTapPlan(probe, pid, move.tapPlan);
    const spellCard = removeFromZone(player, move.cardInstanceId, "hand");
    const stackItem: StackItem = {
        ...spellCard,
        zone: "stack",
        castById: pid,
        ...(move.targets.length > 0 ? { targets: move.targets } : {}),
        ...(move.chosenX !== undefined ? { chosenX: move.chosenX } : {}),
        ...(move.chosenModeId ? { chosenModeId: move.chosenModeId } : {}),
    };
    probe.stack.push(stackItem);
    emitSpellCastEvent(probe, stackItem);
    processPendingActionTriggers(probe);
    checkStateBasedActions(probe);
    return true;
}

/** Put the activated ability on the probe's stack (CR 602.2). Costs are paid
 *  coarsely (tap plan + the {T} on the source); `isPrunableActivation` already
 *  refused every cost shape whose payment could itself be the payoff. */
function applyProbeActivation(
    probe: GameState,
    pid: string,
    move: Extract<Move, { kind: "activate-ability" }>
): boolean {
    const located = findPermanent(probe, move.cardInstanceId);
    if (!located) return false;
    const ability = abilityOf(located, move.abilityId);
    if (!ability) return false;
    applyTapPlan(probe, pid, move.tapPlan);
    if (ability.cost.tap) located.isTapped = true;
    // The stack item is a virtual COPY of the source (the permanent stays on
    // the battlefield). Take it from a second clone so no nested array is
    // shared with the live permanent.
    const copySource = findPermanent(
        cloneGameState(probe),
        move.cardInstanceId
    );
    if (!copySource) return false;
    const stackItem: StackItem = {
        ...copySource,
        zone: "stack",
        castById: pid,
        abilityId: move.abilityId,
        ...(move.targets.length > 0 ? { targets: move.targets } : {}),
        ...(move.chosenX !== undefined ? { chosenX: move.chosenX } : {}),
    };
    probe.stack.push(stackItem);
    checkStateBasedActions(probe);
    return true;
}

function findPermanent(
    state: GameState,
    instanceId: string
): CardInstanceState | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === instanceId);
        if (found) return found;
    }
    return undefined;
}

function abilityOf(card: CardInstanceState, abilityId: string) {
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    return def?.activatedAbilities?.find((a) => a.id === abilityId);
}

// ---------------------------------------------------------------------------
// Settle + all-branches recursion
// ---------------------------------------------------------------------------

/** Resolve `probe` down to `baseline`'s stack depth and prove the result is a
 *  no-op. When resolution suspends on a mid-resolution CHOICE owned by the
 *  mover, EVERY candidate branch must prove a no-op (mode/choice-dependent
 *  futility, Vision Charm): one useful branch is enough to keep the move. */
function branchesAllNoOp(
    probe: GameState,
    baseline: GameState,
    moverId: string,
    spentCardId: string | undefined,
    depth: number
): boolean {
    let steps = 0;
    while (probe.stack.length > baseline.stack.length) {
        if (steps++ >= MAX_SETTLE_STEPS) return false;
        if (
            probe.pendingCast ||
            probe.pendingTarget ||
            probe.pendingActivation ||
            probe.pendingCompanionPay
        ) {
            return false;
        }
        if ((probe.pendingChoices?.length ?? 0) > 0) break;
        if (probe.gameOver) return false;
        resolveTopOfStack(probe);
        checkStateBasedActions(probe);
    }

    const head = probe.pendingChoices?.[0];
    if (head) {
        if (depth >= MAX_CHOICE_DEPTH) return false;
        if (head.playerId !== moverId) return false;
        const candidates = choiceCandidates(probe, head, MAX_CHOICE_BRANCHES);
        if (candidates.length === 0) return false;
        for (const candidate of candidates) {
            stats.choiceBranches++;
            const branch = cloneGameState(probe);
            if (!applyProbeChoice(branch, moverId, candidate.move))
                return false;
            if (
                !branchesAllNoOp(
                    branch,
                    baseline,
                    moverId,
                    spentCardId,
                    depth + 1
                )
            ) {
                return false;
            }
        }
        return true;
    }

    if (probe.gameOver) return false;
    if (probe.stack.length !== baseline.stack.length) return false;
    return isNoOpDelta(baseline, probe, moverId, spentCardId);
}

/** Answer a mid-resolution choice through the SAME pure resolvers the real
 *  mutations drive. Only the two kinds a spell/ability resolution can raise for
 *  its own controller are handled; anything else is unprovable. */
function applyProbeChoice(
    branch: GameState,
    moverId: string,
    move: Move
): boolean {
    if (move.kind === "resolution-choice") {
        applyPendingChoiceSubmit(branch, {
            playerId: moverId,
            stackItemId: move.stackItemId,
            step: move.step,
            choiceId: move.choiceId,
            cardInstanceIds: move.cardInstanceIds,
        });
        checkStateBasedActions(branch);
        return true;
    }
    if (move.kind === "may-pay") {
        applyMayPaySubmit(branch, {
            playerId: moverId,
            accept: move.accept,
            ...(move.sacrificeIds ? { sacrificeIds: move.sacrificeIds } : {}),
            ...(move.discardIds ? { discardIds: move.discardIds } : {}),
        });
        checkStateBasedActions(branch);
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// The exact-equality test
// ---------------------------------------------------------------------------

/** `GameState` keys that a cast/activation moves for BOOKKEEPING reasons alone:
 *  priority/pass wiring, RNG cursors, event queues, id allocators, and the storm
 *  tallies. Everything NOT listed here is compared — the fail-closed default. */
const IGNORED_STATE_KEYS = [
    "priorityPlayerId",
    "passCount",
    "rngSeed",
    "rngCounter",
    "pendingEvents",
    "pendingTriggerBatch",
    "pendingReflexiveTriggers",
    "pendingReveals",
    "autoPassPlayers",
    "singleShotAutoPass",
    "queuedEndTurn",
    "expectedInput",
    "spellsCastThisTurn",
    "abilityResolutionCounts",
    "nextInstanceId",
    "nextTokenSeq",
    "nextWorldSeq",
    "nextGrantSeq",
    "nextDelayedSeq",
    "nextEmblemSeq",
] as const;

/** Per-card allocator/bookkeeping cursors, stripped on EVERY instance. */
const IGNORED_INSTANCE_KEYS = [
    "worldSeq",
    "staticSeq",
    "activationsThisTurn",
    "triggersThisTurn",
] as const;

/** The mover's own cast bookkeeping. Deliberately NOT here: `manaPool` and
 *  `restrictedMana`. The probe pays mana costs by MARKING SOURCES TAPPED and
 *  never credits or debits the pool (`applyTapPlan`), so on the probe side the
 *  pool moves for exactly one reason — the RESOLUTION produced mana. Ignoring
 *  it made every ritual (Dark Ritual, Cabal Ritual: `effects: [{ op: "addMana"
 *  }]`) "provably" a no-op and pruned the bot's whole ramp package. Comparing
 *  it is both cheaper and stricter than scanning a script for `addMana`: any
 *  future Op that touches the pool is caught by the fail-closed default. */
const IGNORED_MOVER_PLAYER_KEYS = [
    "spellsCastThisTurn",
    "qualifyingActionThisTurn",
] as const;

/** True when the settled `probe` differs from `baseline` in nothing but the
 *  mover's own cost. See the module header for the fail-closed argument. */
function isNoOpDelta(
    baseline: GameState,
    probe: GameState,
    moverId: string,
    spentCardId: string | undefined
): boolean {
    const a = normalize(cloneGameState(baseline), moverId, spentCardId, "base");
    const b = normalize(cloneGameState(probe), moverId, spentCardId, "probe");
    if (!a || !b) return false;
    // Tapping is a COST, untapping is a DELTA: forgive only untapped → tapped
    // on the mover's own permanents, and only against the matching baseline
    // instance. An effect that UNTAPS still registers as a difference.
    const baseTapped = new Map<string, boolean>();
    const basePlayer = a.players.find((p) => p.id === moverId);
    const probePlayer = b.players.find((p) => p.id === moverId);
    if (!basePlayer || !probePlayer) return false;
    for (const c of basePlayer.battlefield) baseTapped.set(c.id, c.isTapped);
    for (const c of probePlayer.battlefield) {
        if (c.isTapped && baseTapped.get(c.id) === false) c.isTapped = false;
    }
    return deepEqual(a, b);
}

/** Strip the ignore lists in place and remove the spent card from the zone it
 *  occupies on each side (hand on the baseline; graveyard/exile on the probe),
 *  so "the card was spent" is not itself read as a delta. Returns the state, or
 *  `null` when the spent card can't be accounted for on the probe side. */
function normalize(
    state: GameState,
    moverId: string,
    spentCardId: string | undefined,
    side: "base" | "probe"
): GameState | null {
    const bag = state as unknown as Record<string, unknown>;
    for (const key of IGNORED_STATE_KEYS) delete bag[key];

    for (const player of state.players) {
        if (player.id === moverId) {
            const pbag = player as unknown as Record<string, unknown>;
            for (const key of IGNORED_MOVER_PLAYER_KEYS) delete pbag[key];
        }
        for (const zone of [
            player.hand,
            player.library,
            player.graveyard,
            player.exile,
            player.battlefield,
        ]) {
            for (const card of zone) {
                const cbag = card as unknown as Record<string, unknown>;
                for (const key of IGNORED_INSTANCE_KEYS) delete cbag[key];
            }
        }
    }
    for (const item of state.stack) {
        const ibag = item as unknown as Record<string, unknown>;
        for (const key of IGNORED_INSTANCE_KEYS) delete ibag[key];
    }

    if (spentCardId === undefined) return state;
    const mover = state.players.find((p) => p.id === moverId);
    if (!mover) return null;
    if (side === "base") {
        const i = mover.hand.findIndex((c) => c.id === spentCardId);
        if (i === -1) return null;
        mover.hand.splice(i, 1);
        return state;
    }
    // Probe side: the spell has left the stack — a normal cast lands in the
    // graveyard, an exile-on-resolve one (flashback, rebound) in exile. If it
    // is in NEITHER (it stuck on the battlefield, bounced back to hand, …) the
    // move is not a pure cost and nothing is stripped, so the compare fails.
    for (const zone of [mover.graveyard, mover.exile]) {
        const i = zone.findIndex((c) => c.id === spentCardId);
        if (i !== -1) {
            zone.splice(i, 1);
            return state;
        }
    }
    return null;
}

/** Structural deep equality treating `undefined` and an absent key as the same
 *  value (the engine writes both). Object key ORDER is irrelevant; array order
 *  is significant — a reordered zone is a difference, which is the safe way
 *  round. `CardInstanceState.card` is shared by reference across clones
 *  (`cloneGameState`), so definitions short-circuit on identity. */
export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a === "number" && typeof b === "number") {
        return Number.isNaN(a) && Number.isNaN(b);
    }
    if (a === null || b === null) return false;
    if (typeof a !== "object" || typeof b !== "object") return false;
    const aIsArray = Array.isArray(a);
    if (aIsArray !== Array.isArray(b)) return false;
    if (aIsArray) {
        const av = a as unknown[];
        const bv = b as unknown[];
        if (av.length !== bv.length) return false;
        return av.every((v, i) => deepEqual(v, bv[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const key of keys) {
        if (ao[key] === undefined && bo[key] === undefined) continue;
        if (!deepEqual(ao[key], bo[key])) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Eligibility (cheap gate, runs before any clone)
// ---------------------------------------------------------------------------

/** Cheap pre-filter: is `move` even the SHAPE of thing a dominance probe may
 *  drop? Exported so `enumerateMoves` can skip the clone entirely for the
 *  overwhelming majority of moves. */
export function isProbeEligibleMove(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (move.kind === "cast-spell") {
        const player = state.players.find((p) => p.id === pid);
        const card = player?.hand.find((c) => c.id === move.cardInstanceId);
        if (!card) return false;
        // Board presence is a real delta — never probe a permanent spell.
        return !card.types.some((t) =>
            (PERMANENT_TYPES as readonly string[]).includes(t)
        );
    }
    if (move.kind === "activate-ability") {
        const source = findPermanent(state, move.cardInstanceId);
        if (!source) return false;
        const ability = abilityOf(source, move.abilityId);
        if (!ability) return false;
        // Mana abilities never use the stack, and the pool is an ignored term.
        if (!ability.useStack) return false;
        const cost = ability.cost;
        // Any cost whose PAYMENT can be the payoff (a death trigger, a
        // graveyard filler, a loyalty tick) is out of scope for the probe.
        return !(
            cost.sacrifice ||
            cost.sacrificeFilter ||
            cost.tapOtherFilter ||
            cost.discardFilter ||
            cost.discardThis ||
            cost.discardLastDrawn ||
            cost.discardAtRandom !== undefined ||
            cost.exileFromGraveyard ||
            cost.removeCounter ||
            cost.life !== undefined ||
            cost.loyalty !== undefined
        );
    }
    return false;
}
