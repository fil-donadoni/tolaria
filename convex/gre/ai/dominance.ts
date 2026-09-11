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
// The CHOICE-level probe (`isNoOpChoiceAnswer`, issue #1888) is reached from a
// prior function that DOES run at every in-tree choice-node visit, so it obeys
// the same invariant by a memo instead of a deny-set: one verdict per choice
// IDENTITY per decision, held for exactly one `searchWithTrace` call. It shares
// `stats.probes`, and the guard asserts the 40-vs-400 equality on a CHOICE-node
// scenario as well as a priority-node one — a scenario without a choice node
// cannot see this seam regress (PR #1914 review finding 1).
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
//   * The SAME gate on the cast side (issue #1905 re-review): a spell that
//     declares `additionalCosts` (CR 118.3-5 / 601.2f), pays Phyrexian life
//     (CR 107.4f) or has delve (CR 702.66) is never probed. `applyProbeCast`
//     pays none of those, so a spell whose whole value IS the payment — LEA
//     Sacrifice / ICE Burnt Offering, whose `getAdditionalSacrificeMv()` reads
//     the un-snapshotted pick and returns `undefined` — resolves to nothing in
//     the probe and would be "proved" dominated.
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

import type {
    CardInstanceState,
    GameState,
    PendingChoice,
    StackItem,
} from "../state";
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
import { spellHasDelve } from "../payWith";
// CR 307.1 / 117.1a / 601.3a (issue #2473) — the shared cast-timing snapshot
// predicate. `phases.ts` is a leaf engine module here (it is neither
// `search.ts` nor `applyMove.ts`, so this module still stays off `moves.ts`'
// runtime import graph) and the call sits inside a function body, so the
// state.ts↔phases.ts cycle is never touched at module-evaluation time.
import { wasCastOffSorceryTiming } from "../phases";
import { applyCastModeCharacteristics } from "../castMode";
import { choiceCandidates } from "./choiceCandidates";
import { MAX_CHOICE_BRANCH_WORK, MAX_CHOICE_DEPTH } from "./choiceDepth";
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
// Bound on nested mid-resolution choices: `MAX_CHOICE_DEPTH`, shared with the
// search's payoff probes (`ai/choiceDepth.ts`). It used to be the local
// constant `1`, and its own comment named Vision Charm as "the shape that
// occurs" — but that card's land-type mode takes TWO nested option choices, so
// the recursion hit the cap on the second one and returned "not provably
// futile" on precisely the case it was written for (issue #3194). The bound is
// now MEASURED from the catalogue, and `MAX_CHOICE_BRANCH_WORK` bounds the work
// separately, so a deeper bound cannot multiply into a `branches ^ depth`
// probe.

/** Re-entrancy latch. The probe drives real resolution, which can reach code
 *  that enumerates moves; without this a probe could probe itself. */
let probing = false;

/** Branch expansions left in the CURRENT probe (issue #3194). Reset at each
 *  probe entry and spent by `branchesAllNoOp`'s recursion, so the work one
 *  proof may cost is bounded independently of how deep `MAX_CHOICE_DEPTH`
 *  lets it go. Exhausting it answers "not provably futile" — the same
 *  fail-open direction the depth cap already took. */
let branchWorkLeft = 0;

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
    // The cheap SHAPE gate is part of the proof, not merely an optimisation:
    // it is what refuses every move whose cost the probe models too coarsely
    // to be sound (additional costs, sacrifice/discard/life activation costs).
    // `enumerateMoves` calls it first and the second call is ~free, but this
    // seam is exported — running it here keeps the public entry point sound on
    // its own instead of only when paired with the right caller.
    if (!isProbeEligibleMove(state, pid, move)) return false;

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
        branchWorkLeft = MAX_CHOICE_BRANCH_WORK;
        return branchesAllNoOp(probe, baseline, pid, spentCardId, 0);
    } catch {
        // A probe that throws proves nothing. Never let it change legality.
        return false;
    } finally {
        probing = false;
    }
}

/** Is `move` an announcement that can reach NOTHING but the mover's own side,
 *  and whose own "do nothing" answer is among the branches it may choose?
 *  (Issue #3194.)
 *
 *  {@link isDominatedNoOpMove} asks whether EVERY branch is futile, and one
 *  useful branch is enough to keep the move. That is right for a legality-side
 *  prune and wrong as the only question: a mode whose branches all touch the
 *  mover's own board, one of which does nothing at all, is not provably a
 *  no-op — the bot may still choose the branch that re-types its own sole mana
 *  source — yet nothing it can reach beats simply not casting it. So this is
 *  the same probe with the two quantifiers the SELECTION side needs:
 *
 *    * EVERY branch leaves everything but the mover's own player record
 *      exactly as it was (so the announcement cannot touch the opponent, any
 *      shared ledger, or the board at large), and
 *    * SOME branch is a full no-op (`isNoOpDelta` — the announcement's own "do
 *      nothing" option is genuinely reachable).
 *
 *  The second half is what separates this from a tutor. Demonic Tutor, Entomb,
 *  Preordain and a positive-X Green Sun's Zenith all reach only the mover's own
 *  zones and all read as a material LOSS (a card and mana spent for a payoff
 *  priced in a hidden zone) — but not one of them has a branch that does
 *  nothing, so none is confused with the shape this answers. A move with no
 *  choice at all is admitted only when it IS that no-op, which is the verdict
 *  `isDominatedNoOpMove` already gives it.
 *
 *  Fail-closed like its sibling, and in the direction that matters: `true`
 *  makes a caller demote or hold a legal cast, so every unprovable path — an
 *  unsettled stack, a choice the mover does not own, the depth cap, the work
 *  budget, a throw — answers `false`. */
export function isSelfConfinedFutileMove(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (probing) return false;
    if (move.kind !== "cast-spell" && move.kind !== "activate-ability") {
        return false;
    }
    if (state.gameOver) return false;
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
    if (!isProbeEligibleMove(state, pid, move)) return false;

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
        branchWorkLeft = MAX_CHOICE_BRANCH_WORK;
        const seen = { sawNoOpBranch: false };
        const confined = branchesTouchOnlyMover(
            probe,
            baseline,
            pid,
            spentCardId,
            0,
            seen
        );
        return confined && seen.sawNoOpBranch;
    } catch {
        return false;
    } finally {
        probing = false;
    }
}

/** The `branchesAllNoOp` walk with the other quantifier: every leaf must leave
 *  everything but the mover untouched, and `seen.sawNoOpBranch` records whether
 *  any leaf was a full no-op. Returns false — never "unknown" — for a leaf it
 *  cannot settle, so an unprovable branch suppresses nothing. */
function branchesTouchOnlyMover(
    probe: GameState,
    baseline: GameState,
    moverId: string,
    spentCardId: string | undefined,
    depth: number,
    seen: { sawNoOpBranch: boolean }
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
            if (branchWorkLeft-- <= 0) return false;
            stats.choiceBranches++;
            const branch = cloneGameState(probe);
            if (!applyProbeChoice(branch, moverId, candidate.move)) {
                return false;
            }
            if (
                !branchesTouchOnlyMover(
                    branch,
                    baseline,
                    moverId,
                    spentCardId,
                    depth + 1,
                    seen
                )
            ) {
                return false;
            }
        }
        return true;
    }

    // The leaf must be genuinely SETTLED — the same requirement `branchesAllNoOp`
    // makes. A half-resolved state (the settle loop's own step guard, a
    // suspension this probe cannot answer) would otherwise be compared as if it
    // were the outcome.
    if (probe.gameOver) return false;
    if (
        probe.pendingCast ||
        probe.pendingTarget ||
        probe.pendingActivation ||
        probe.pendingCompanionPay
    ) {
        return false;
    }
    if ((probe.pendingChoices?.length ?? 0) > 0) return false;
    if (probe.stack.length !== baseline.stack.length) return false;
    if (isNoOpDelta(baseline, probe, moverId, spentCardId)) {
        seen.sawNoOpBranch = true;
        return true;
    }
    return touchesOnlyMoverDelta(baseline, probe, moverId, spentCardId);
}

/** State-level bookkeeping a resolution ECHOES rather than causes (issue
 *  #3293), dropped from the comparison below.
 *
 *  Every writer of these three today sits one line from the PRIMARY change it
 *  records — a zone move, a departure, a life total — and on the opponent's
 *  side each of those is still compared in full, so dropping the echo cannot
 *  hide a resolution that reached them. What it stops is the mover's own
 *  bookkeeping masquerading as reach. That is a claim about the writers as they
 *  stand, not an invariant anything enforces: a SECOND writer added tomorrow
 *  would void it silently, unlike a new key, which reads as reach and so fails
 *  closed. Each entry below names the writer it was measured against, and each
 *  has a witness in `ai/__tests__/cheat-into-play-payoff.bot.test.ts` — remove
 *  it from this list and a named half of that pair goes red. */
const ECHOED_BOOKKEEPING_KEYS = [
    // Bumped by ANY creature dying, the mover's own included. Sole writer:
    // `removePermanentTo` (`state.ts`), immediately after the battlefield →
    // graveyard move — and for the opponent both zones are compared.
    "deathsThisTurn",
    // Last-known information stamped for a permanent as it LEAVES the
    // battlefield. Same sole writer, on the departure itself, which is the
    // primary change.
    "lastKnownCopiable",
    // A life-gain tally, written one line after the life total it echoes, and
    // only for a gain that actually happened (a replaced or non-positive gain
    // returns before both). The life total is compared on the opponent's own
    // record.
    "lifeGainedThisTurn",
] as const;

/** True when `probe` differs from `baseline` in NOTHING outside the mover's own
 *  player record.
 *
 *  It runs through the module's own `normalize` rather than a hand-rolled
 *  digest, and that is not a style preference — the layer pass stamps its memo
 *  fields (`baseTypes`, `baseSubtypes`, …) onto every permanent LAZILY, the
 *  probe runs the engine and the baseline did not, so a raw compare reports a
 *  difference on every card the opponent controls and answers "this reaches
 *  them" for a spell that cannot touch them at all. `IGNORED_INSTANCE_KEYS`
 *  is where that trap is already solved; the first cut of this predicate
 *  (`search.ts`, issue #3194) re-introduced it and was measured inert the
 *  moment the opponent controlled any permanent.
 *
 *  The mover's own record is dropped from BOTH sides, so everything else — the
 *  opponent's whole record, and every state-level ledger, including ones added
 *  tomorrow — is compared by default, MINUS `ECHOED_BOOKKEEPING_KEYS`. Those
 *  three were the same trap one level up (issue #3293): a resolution that puts
 *  the mover's own creature onto the battlefield and then sacrifices it bumps
 *  `deathsThisTurn` and stamps `lastKnownCopiable`, neither of which is a fact
 *  about the opponent, and reading them as reach made this predicate — and with
 *  it every caller that holds or demotes a self-confined announcement — INERT
 *  for the whole cheat-into-play shape. Measured: `pass` was refused for Flash
 *  cheating in a vanilla body it could not pay for, on 5/5 seeds at 400
 *  iterations, and the same 5/5 answer the other way once the echoes stopped
 *  counting. */
function touchesOnlyMoverDelta(
    baseline: GameState,
    probe: GameState,
    moverId: string,
    spentCardId: string | undefined
): boolean {
    const a = normalize(cloneGameState(baseline), moverId, spentCardId, "base");
    const b = normalize(cloneGameState(probe), moverId, spentCardId, "probe");
    if (!a || !b) return false;
    for (const bag of [a, b] as unknown as Record<string, unknown>[]) {
        for (const key of ECHOED_BOOKKEEPING_KEYS) delete bag[key];
    }
    a.players = a.players.filter((p) => p.id !== moverId);
    b.players = b.players.filter((p) => p.id !== moverId);
    return deepEqual(a, b);
}

/** The choice-level counterpart of {@link isDominatedNoOpMove} (issue #1888
 *  item 3): is `move` — one candidate answer to the LIVE head choice `choice` —
 *  provably a no-op? Same probe, one level down.
 *
 *  `isDominatedNoOpMove` asks "would casting this change anything?"; by the time
 *  a mid-resolution choice is live the cast is already paid for and the only
 *  question left is whether THIS answer does anything. So the comparison drops
 *  the cost bookkeeping (there is no cost to forgive — an answer that taps a
 *  permanent has DONE something) and drops the two terms that necessarily move
 *  when a choice is answered: the `stack` (the item that raised the choice
 *  resolves away) and `pendingChoices` (the choice is consumed). Both are
 *  length-checked first, so an answer that leaves a NEW choice or puts a new
 *  item on the stack is never called a no-op.
 *
 *  Conservative and pure, exactly like its cast-level sibling: any doubt — a
 *  throw, an unsupported move kind, an unsettled stack — returns `false`. */
export function isNoOpChoiceAnswer(
    state: GameState,
    choice: PendingChoice,
    move: Move
): boolean {
    if (probing) return false;
    if (state.gameOver) return false;
    if ((state.pendingChoices?.length ?? 0) === 0) return false;
    if (state.pendingCast || state.pendingTarget || state.pendingActivation) {
        return false;
    }

    // Once per DECISION, not once per iteration (PR #1914 review finding 1).
    // The guards above are transient / per-world and are re-run every call; the
    // PROBE below is what costs, so only it is memoized. A memo MISS is what
    // increments `stats.probes`, which is precisely what lets the O(root
    // decisions) guard in `dominance.bot.test.ts` see a regression here.
    const memo = choiceProbeMemo;
    const key = memo ? choiceAnswerIdentity(state, choice, move) : undefined;
    if (memo && key !== undefined) {
        const cached = memo.get(key);
        if (cached !== undefined) return cached;
    }
    const verdict = probeNoOpChoiceAnswer(state, choice, move);
    if (memo && key !== undefined) memo.set(key, verdict);
    return verdict;
}

// ---------------------------------------------------------------------------
// Per-decision memo for the choice probe (PR #1914 review finding 1)
// ---------------------------------------------------------------------------
//
// `isNoOpChoiceAnswer` is reached from `dslChoicePrior` (`choicePriors.ts`),
// which `choiceCandidates` calls for EVERY candidate at EVERY choice-node visit
// — tree descent and rollout alike. Unmemoized that is O(iterations): measured
// 42 probes at 40 iterations vs 401 at 400 on a live `choose-hand-card` node,
// the exact #1905 review-finding-3 shape this module's header forbids ("In-tree
// enumeration does NOT probe … 42.6% of a 300-iteration search's wall clock").
//
// The fix is the same shape as `searchWithTrace`'s `prunedRootKeys` deny-set:
// prove it ONCE per decision and reuse the verdict for the whole search. The
// memo lives for exactly one `searchWithTrace` call (`beginDominanceDecision` /
// `endDominanceDecision`, called in a `finally`), so a verdict never outlives
// the position it was proved against.
//
// The key is the choice's IDENTITY, deliberately NOT the world state: every
// iteration re-determinizes, so a state-keyed memo would never hit. Identity is
// (source card definition, resolution step, choice id, kind, chooser, answer) —
// all stable across determinizations of the same logical choice node, and
// stable too when the SAME node is reached by casting the source inside the
// tree (where the stack item id is freshly minted each iteration and therefore
// useless as a key).
//
// The accepted narrowing, and why it is cheap: two determinized worlds could in
// principle disagree about whether the same answer is a no-op, and the memo
// reports the first world's verdict for both. That is the identical tradeoff
// the root deny-set already makes (a root verdict reused for every iteration) —
// and the stake here is strictly lower: this feeds a PRIOR, an ordering bias
// that decays with visits and never changes legality, not a pruning decision.
// Outside a decision scope (`choiceProbeMemo === null` — a direct unit-test
// call, the client-side Brain) nothing is cached and every call probes.

let choiceProbeMemo: Map<string, boolean> | null = null;

/** Open a decision scope: `isNoOpChoiceAnswer` proves each distinct choice
 *  answer at most once until {@link endDominanceDecision}. Called by
 *  `searchWithTrace`; re-entrant calls simply reopen an empty scope. */
export function beginDominanceDecision(): void {
    choiceProbeMemo = new Map();
}

/** Close the decision scope opened by {@link beginDominanceDecision} and drop
 *  every cached verdict. MUST run in a `finally` — a leaked scope would carry
 *  verdicts into the next, unrelated position. */
export function endDominanceDecision(): void {
    choiceProbeMemo = null;
}

/** The memo key: what makes two choice answers "the same decision" across
 *  determinized worlds. Returns `undefined` when no stable identity can be
 *  built, which disables caching for that call rather than risking a collision.
 *
 *  The stack item's CARD DEFINITION id is used, never its instance id: the
 *  instance id is minted afresh every time the source is cast inside the tree,
 *  so keying on it would be a guaranteed miss (and put probes back on
 *  O(iterations)). Definition + step + `choiceId` is exactly the tuple the
 *  engine itself uses to key `StackItem.collectedChoices`. */
function choiceAnswerIdentity(
    state: GameState,
    choice: PendingChoice,
    move: Move
): string | undefined {
    // Only the `resolution-choice` shape has a world-STABLE answer identity (a
    // set of card instance ids, empty for the degenerate branch this is asked
    // about). Any other move kind names world-local ids with no stable
    // counterpart, so it is left uncached rather than keyed unsoundly.
    if (move.kind !== "resolution-choice") return undefined;
    const item = state.stack.find((s) => s.id === choice.stackItemId);
    const defId = (item?.card as { id?: string } | undefined)?.id;
    if (!defId) return undefined;
    const ids = move.cardInstanceIds ?? [];
    return [
        defId,
        choice.kind,
        choice.step,
        choice.choiceId,
        choice.playerId,
        ids.length === 0 ? "<none>" : [...ids].sort().join(","),
    ].join("|");
}

/** The probe itself — everything {@link isNoOpChoiceAnswer} memoizes. */
function probeNoOpChoiceAnswer(
    state: GameState,
    choice: PendingChoice,
    move: Move
): boolean {
    probing = true;
    stats.probes++;
    try {
        const probe = cloneGameState(state);
        if (!applyProbeChoice(probe, choice.playerId, move)) return false;
        let steps = 0;
        while (probe.stack.length >= state.stack.length) {
            if (steps++ >= MAX_SETTLE_STEPS) return false;
            if ((probe.pendingChoices?.length ?? 0) > 0) return false;
            if (
                probe.pendingCast ||
                probe.pendingTarget ||
                probe.pendingActivation ||
                probe.gameOver
            ) {
                return false;
            }
            resolveTopOfStack(probe);
            checkStateBasedActions(probe);
        }
        if ((probe.pendingChoices?.length ?? 0) > 0) return false;
        if (probe.stack.length !== state.stack.length - 1) return false;
        return isNoOpChoiceDelta(state, probe);
    } catch {
        return false;
    } finally {
        probing = false;
    }
}

/** Exact-equality test for a settled choice answer: everything except the two
 *  terms answering a choice necessarily moves (`stack`, `pendingChoices`,
 *  already length-checked by the caller) plus the module's standard bookkeeping
 *  ignore lists. Fail-closed by the same construction as `isNoOpDelta`. */
function isNoOpChoiceDelta(baseline: GameState, probe: GameState): boolean {
    const a = normalize(cloneGameState(baseline), "", undefined, "base");
    const b = normalize(cloneGameState(probe), "", undefined, "probe");
    if (!a || !b) return false;
    for (const side of [a, b] as unknown as Record<string, unknown>[]) {
        delete side.stack;
        delete side.pendingChoices;
    }
    return deepEqual(a, b);
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
 *  delta).
 *
 *  Issue #2420 — an `abilityId`-carrying entry ACTIVATES the source's own
 *  non-tap mana ability (Urza's `tapOtherFilter`, Farrelite Priest's pure
 *  `cost.mana`) rather than tapping the source: `cardInstanceId` itself is
 *  never tapped by this payment (CR 602.1); only the permanent(s) named in
 *  `tapOtherIds`, if any, are. A wrong model here isn't merely a cosmetic
 *  mismatch — `isNoOpDelta` compares tap state to decide whether a move is
 *  pruned as dominated by `pass`, so leaving Urza tapped-by-mistake could
 *  mask a real cost/benefit delta. Mirrors the identical fix in
 *  `applyMove.ts` / `search.ts`'s own `applyTapPlan` — kept as a third
 *  separate copy by this module's own isolation rule (see the section header
 *  above), so all three need the same fix. */
function applyTapPlan(
    state: GameState,
    pid: string,
    tapPlan: {
        cardInstanceId: string;
        abilityId?: string;
        tapOtherIds?: string[];
    }[]
): void {
    const player = state.players.find((p) => p.id === pid);
    if (!player) return;
    for (const tap of tapPlan) {
        if (tap.abilityId) {
            for (const otherId of tap.tapOtherIds ?? []) {
                const other = player.battlefield.find((c) => c.id === otherId);
                if (other) other.isTapped = true;
            }
            continue;
        }
        const src = player.battlefield.find((c) => c.id === tap.cardInstanceId);
        if (src) src.isTapped = true;
    }
}

/** Put the cast spell on the probe's stack exactly as the real cast does
 *  (CR 601.2i): card leaves hand, stack item carries targets / X / mode, the
 *  SPELL_CAST event fires and its triggers are flushed onto the stack above the
 *  spell. Returns false when the move can't be realised.
 *
 *  Exported for the producer-census guard (issue #2473): `isDominatedNoOpMove`
 *  returns only a boolean and no shipped card reads `castOffSorceryTiming` yet,
 *  so this builder's timing stamp has no reachable observation through the
 *  public seam. */
export function applyProbeCast(
    probe: GameState,
    pid: string,
    move: Extract<Move, { kind: "cast-spell" }>
): boolean {
    const player = probe.players.find((p) => p.id === pid);
    if (!player) return false;
    if (!player.hand.some((c) => c.id === move.cardInstanceId)) return false;
    applyTapPlan(probe, pid, move.tapPlan);
    const spellCard = removeFromZone(
        probe,
        player,
        move.cardInstanceId,
        "hand"
    );
    const stackItem: StackItem = {
        ...spellCard,
        zone: "stack",
        castById: pid,
        ...(move.targets.length > 0 ? { targets: move.targets } : {}),
        ...(move.chosenX !== undefined ? { chosenX: move.chosenX } : {}),
        ...(move.chosenModeId ? { chosenModeId: move.chosenModeId } : {}),
        // CR 307.1 / 117.1a / 601.3a (issue #2473) — the third
        // build-a-spell-StackItem-and-push site. This probe produces no
        // persisted state, but its whole contract (see the doc comment above)
        // is "exactly as the real cast does": a probe board that diverges from
        // the tree's on a flag a card can read is precisely the shape
        // `isNoOpDelta` would then misjudge. Evaluated pre-push on `probe`.
        ...(wasCastOffSorceryTiming(probe, pid)
            ? { castOffSorceryTiming: true }
            : {}),
    };
    // CR 601.2b (issue #3215) — the cast-MODE census, the same one both search
    // executors apply (`gre/castMode.ts`). This is the FIFTH
    // build-a-StackItem-from-a-cast site and the census did not reach it, which
    // is worse here than the drift issue #2796 documented: a mode the probe
    // drops does not merely mis-value the line, it DELETES it. The probe's
    // verdict is "applying this changes nothing", and an unstamped overload
    // cast resolves against an EMPTY `forEach { set: "targets" }` member set —
    // provably a no-op, so `isDominatedNoOpMove` pruned the overloaded cast out
    // of the bot's legal moves entirely and the bot could only pass. Bestow and
    // morph had the same latent hole (a bestowed probe resolving as a creature
    // spell, a morph probe as its face-up self); stamping from the shared
    // census closes all of them at once and keeps a new mode from reopening it.
    applyCastModeCharacteristics(probe, stackItem, move.alternativeCostId);
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
            // The work budget, not the depth cap, is what keeps a deeper bound
            // affordable (issue #3194): a probe may open at most
            // `MAX_CHOICE_BRANCH_WORK` branches in total, however they are
            // distributed across the tree.
            if (branchWorkLeft-- <= 0) return false;
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
            // CR 701.22 / 701.25 / 701.44a (issue #2996) — the THIRD
            // `Move → submitResolutionChoice` site, and the one the widening
            // first missed (PR review finding 2). An `order-top` answer
            // partitions the looked-at window, and its "keep nothing" policy is
            // exactly the empty-`cardInstanceIds` shape this probe is built to
            // test; without the second list the resolver throws
            // ("order-top must place every looked-at card once") and
            // `probeNoOpChoiceAnswer`'s bare catch swallows it, so the probe
            // silently proves nothing about the one answer that moves every
            // card in the window.
            ...(move.secondZoneIds
                ? { secondZoneIds: move.secondZoneIds }
                : {}),
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
    "nextRevealSeq",
    "nextDelayedSeq",
    "nextEmblemSeq",
] as const;

/** Per-card allocator/bookkeeping cursors, stripped on EVERY instance. */
const IGNORED_INSTANCE_KEYS = [
    "worldSeq",
    "staticSeq",
    // PRD #2064 S3 — the layer-6 base, captured LAZILY the first time
    // `syncLayer6` derives for a permanent. Exactly `staticSeq`'s shape one
    // line up: a bookkeeping cursor whose mere PRESENCE distinguishes a state
    // the engine has touched from one it has not, so the probe (which runs the
    // engine) would always differ from the untouched baseline and no move could
    // ever be proved dominated. Nothing is masked by ignoring it: it is derived
    // from `staticAbilities`, which this comparison still makes in full.
    "baseStaticAbilities",
    // PRD #2064 S4 — the layer-2-to-5 bases and the one-way "this engine has
    // derived this instance" marker, all captured LAZILY the first time
    // `syncLayers2to5` runs for a permanent. Identical argument to
    // `baseStaticAbilities` above: their mere PRESENCE distinguishes a state the
    // engine has touched from one it has not, so the probe — which runs the
    // engine — would differ from the untouched baseline on every card and no
    // move could ever be proved dominated. (`printedSubtypes` rides along for
    // the same reason: it is `baseSubtypes`' derived twin, written by the same
    // first derivation.) Nothing is masked: each is derived from
    // `controllerId` / `types` / `subtypes`, which this comparison still makes
    // in full.
    "baseControllerId",
    "baseTypes",
    "baseSubtypes",
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
    // Lifetime sibling of spellsCastThisTurn (issue #790) — same "moves on
    // every cast" shape, so it belongs on the same ignore list for the same
    // reason: counting it would make every cast "provably" non-dominated.
    "spellsCastThisGame",
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

/** `additionalCosts` members that are owed ONLY when the spell is cast from the
 *  GRAVEYARD for its flashback cost (CR 601.2a / 118.5). `applyProbeCast`
 *  takes the card out of the HAND, so on that path these are not owed at all
 *  and their presence must not refuse the probe — refusing it is what left
 *  Flash of Insight's provably-empty X = 0 branch (`lookDistribute look: 0`) in the
 *  move list, issue #1888 item 2. Every OTHER member is owed on a plain cast
 *  and `applyProbeCast` pays none of them, so any of them still fails closed. */
const FLASHBACK_ONLY_ADDITIONAL_COST_KEYS = new Set([
    "flashbackExileFromGraveyard",
]);

/** True when `costs` obliges nothing on a cast FROM HAND — either absent, or
 *  made up exclusively of flashback-only members. Keyed on the set of PRESENT
 *  keys rather than a list of "safe" ones, so a member added tomorrow is
 *  unknown and fails CLOSED (the probe is refused), matching the fail-closed
 *  default the whole module is built on. */
function additionalCostsAreVacuousFromHand(costs: object | undefined): boolean {
    if (costs === undefined) return true;
    return Object.entries(costs).every(
        ([key, value]) =>
            value === undefined || FLASHBACK_ONLY_ADDITIONAL_COST_KEYS.has(key)
    );
}

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
        if (
            card.types.some((t) =>
                (PERMANENT_TYPES as readonly string[]).includes(t)
            )
        ) {
            return false;
        }
        // Same "the cost payment can BE the payoff" class as the activation
        // gate below (CR 601.2b/f, 118.3-5): the probe pays cast costs only
        // coarsely (tap plan, no pool accounting) and `applyProbeCast` pays no
        // ADDITIONAL cost at all — it never sacrifices/exiles the picked
        // permanent, never pays the life, never snapshots the picked card on
        // the stack item. A spell whose whole value comes from that payment
        // (LEA Sacrifice, ICE Burnt Offering: `getAdditionalSacrificeMv()`
        // returns `undefined`, so `resolve` early-returns and the pool never
        // moves) would resolve to nothing in the probe and be "proved"
        // dominated. Refuse the probe whenever the card declares ANY additional
        // cost. Deliberately keyed on the PRESENCE of the object rather than a
        // list of its members (`sacrificeFilter`, `exileFilter`, `payXLife`,
        // `payLife`, `xFromOpponentGraveyard`, `flashbackExileFromGraveyard`)
        // so a member added tomorrow fails CLOSED — the same fail-closed
        // default `isNoOpDelta`'s whole-state compare uses.
        const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
        if (!additionalCostsAreVacuousFromHand(def?.additionalCosts))
            return false;
        // The two OTHER unmodelled cast costs the enumerator can actually
        // announce, both the same shape as the activation gate's
        // `cost.life !== undefined`:
        //   * Phyrexian life (CR 107.4f, `move.payLife`) — `applyProbeCast`
        //     never deducts it, so a "whenever you lose life" payoff the real
        //     cast would trigger is invisible to the probe.
        //   * Delve (CR 702.66) — the enumerator spends graveyard cards as a
        //     generic-mana offset, but the Move carries no picks and the probe
        //     exiles nothing, so a graveyard-leaves / exile payoff is invisible
        //     too. Refused on the KEYWORD, not on whether this particular tap
        //     plan happened to consume fuel — fail closed.
        // (Alternative / evoke costs, CR 118.9 / 702.74a, need no gate: the
        // cast Move carries no alternative-cost id, so the bot never announces
        // one. A flashback cast is already refused — the card is in the
        // graveyard, not the hand, so the `card` lookup above fails.)
        if (move.payLife !== undefined && move.payLife > 0) return false;
        if (spellHasDelve(card)) return false;
        return true;
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
            // CR 118.1 / 601.2h — "Exile this permanent" spends the source
            // itself, and the payoff of spending it can BE the point (Feldon's
            // Cane trades the artifact for a whole graveyard). Same exclusion
            // as `sacrifice`, its graveyard-bound twin.
            cost.exileThis ||
            // CR 602.1a — "Return this permanent to its owner's hand" spends
            // the source's board presence, and re-buying an enters-the-
            // battlefield effect (or dodging removal) can BE the point. Same
            // exclusion as `sacrifice` and `exileThis`, its two twins.
            cost.returnThisToHand ||
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
