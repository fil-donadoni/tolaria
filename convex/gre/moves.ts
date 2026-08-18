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
import {
    normalizeManaCost,
    canPayDiscardLastDrawn,
    canPayRemoveCounterCost,
    canPayLifeCost,
    canPayDiscardAtRandom,
    applyCostModifiers,
    getCostModifiers,
    resolveTargetRequirementCount,
} from "./state";
import { handCardMatchesFilter } from "./alternativeCost";
import {
    getLegalActions,
    getLegalTargets,
    getProducibleManaOptions,
    maxAffordableX,
    solvePhyrexianSplit,
    genericManaShortfall,
    targetingSourceFromCard,
    pendingTargetingSource,
    flashSurchargeOf,
    flashSurchargeRequired,
    foldFlashSurchargeCost,
    applySelfExclusion,
} from "./rules";
// issue #2283 — the origin classification that decides whether a live
// `pendingTarget` is the bot's own half-built announcement (hands off) or a
// selection the engine raised at it (must answer).
import {
    pendingTargetCountMaxReached,
    pendingTargetOrigin,
    raisedPendingTargetOwedBy,
    requirementFromPendingTarget,
} from "./pendingTargetOrigin";
import {
    applyGenericOffset,
    delveEligibleCards,
    genericPortion,
    spellHasDelve,
} from "./payWith";
import { PHYREXIAN_LIFE_PER_PIP, phyrexianPipCount } from "./phyrexian";
import { getEffectivePower } from "./layers";
import { getEffectiveActivatedAbilities } from "./activatedAbilities";
import { canPayTapOtherCost, crewPowerContribution } from "./tapOtherCost";
import type { ActivationCostPicks } from "./activationCostPicks";
import { enumerateActivationCostPicks } from "./activationCostPicks";
import {
    MANA_COLORS,
    declaresAsEntersMode,
    isPlaneswalker,
    isTapLockedBySummoningSickness,
    manaGateBattlefields,
} from "./constants";
import {
    getRequiredAttackerIds,
    getMaxBlockTargets,
    validateAttackerEligibility,
    validateBlockerEligibility,
    getAttackerCap,
    getBlockerCap,
    maxObeyableAttackRequirements,
    getMinimumBlockers,
} from "./combat";
import { isSorceryTiming } from "./phases";
import { effectivePermanentView } from "./permanentView";
import { getInstanceManaCost, tryGetDefinition } from "../cards";
import { matchesPermanentFilter } from "../cards/filters";
import { liveSupertypesOf, countSnowLands } from "./snow";
import { canSummonCompanion } from "./companion";
import { substituteColorFilter } from "./textChanges";
// Choice-node candidate generation (PRD #1423, issue #1425) — a live
// `PendingChoice` becomes an in-tree decision node whose candidate answers this
// enumerator surfaces.
import { choiceCandidates } from "./ai/choiceCandidates";
// Dominance pruning (issue #1887) — the generic "this move is provably
// dominated by `pass`" seam. Opt-in per caller (see `EnumerateMovesOptions`).
import { isDominatedNoOpMove, isProbeEligibleMove } from "./ai/dominance";

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
    | {
          /** Generic mid-resolution choice submission (CR 608.2 / ADR 0016) —
           *  the bot's legal default for any zone-pick `PendingChoiceKind`
           *  (search-library, discard, scry, …). Realised through the same
           *  `submitResolutionChoice` mutation as `mulligan-bottom`; the choice
           *  identity is read from the active pending choice. */
          kind: "resolution-choice";
          stackItemId: string;
          step: number;
          choiceId: string;
          cardInstanceIds: string[];
      }
    | {
          /** Yes/no answer to a `may-pay` pending choice (CR 117.3a / 118.4),
           *  realised through the existing `submitMayPay` mutation — a separate
           *  executor entry point from `submitResolutionChoice` (ADR 0016). The
           *  choice identity is read from the active pending choice; only the
           *  boolean (and, for a sacrifice-leg pick, the chosen victim ids)
           *  travels on the Move. */
          kind: "may-pay";
          accept: boolean;
          /** CR 701.21a — chosen sacrifice victim id(s) when the accepted cost's
           *  sacrifice leg admits a real choice. Omitted otherwise. */
          sacrificeIds?: string[];
          /** CR 701.9 / 118.3 (issue #899) — chosen hand card id(s) when the
           *  accepted cost's discard leg admits a real choice. Omitted
           *  otherwise. Mirrors `sacrificeIds`; both travel to the same
           *  `submitMayPay` entry point. */
          discardIds?: string[];
      }
    | {
          /** Yes/no answer to a `land-entry-tapped` pending choice (shock lands,
           *  CR 614.12 / ADR 0051), realised through the dedicated
           *  `submitLandEntryChoice` mutation. Like `may-pay` only the boolean
           *  travels; the choice identity is read from the active pending
           *  choice. */
          kind: "land-entry";
          accept: boolean;
      }
    | {
          /** Yes/no answer to a `draw-replacement` pending choice (Zur's
           *  Weirding, CR 614 / ADR 0061), realised through the dedicated
           *  `submitDrawReplacementPay` mutation. Like `land-entry` only the
           *  boolean travels (accept = pay the life to bin the revealed card);
           *  the choice identity is read from the active pending choice. */
          kind: "draw-replacement";
          accept: boolean;
      }
    | {
          /** Decline a reflexive `madness-cast` pending choice (CR 702.35a),
           *  realised through the dedicated `submitMadnessDecline` mutation. No
           *  data travels; the choice identity is read from the active pending
           *  choice. The ACCEPT ("Cast") is a normal `cast-spell` move on the
           *  exiled card, never this — the bot's minimal policy always declines. */
          kind: "madness-decline";
      }
    | {
          /** Decline a reflexive `rebound-cast` pending choice (CR 702.88c),
           *  realised through the dedicated `submitReboundDecline` mutation. No
           *  data travels; the choice identity is read from the active pending
           *  choice. The ACCEPT ("Cast") is a normal `cast-spell` move on the
           *  exiled card, never this — the bot's minimal policy always
           *  declines, mirroring `madness-decline`. Unlike Madness, declining
           *  leaves the card exiled (no zone change, CR 702.88c). */
          kind: "rebound-decline";
      }
    | {
          /** Name a card for a `name-card` pending choice (CR 202.3 / ADR 0016)
           *  — the bot's legal default when it is targeted by a name-a-card
           *  effect (Petra Sphinx). Realised through the dedicated
           *  `submitNameCard` mutation; the choice identity is read from the
           *  active pending choice, only the name string travels on the Move. */
          kind: "name-card";
          cardName: string;
      }
    | {
          /** Acknowledge a suspended `random-reveal` flip (CR 705.2, ADR 0023).
           *  Carries no choice data — the engine drew and persisted the
           *  outcome; this only means "resume". Realised through the
           *  `submitRandomRevealAck` mutation; the choice identity is read from
           *  the active pending choice. A no-decision reveal: the bot acks just
           *  as the human client auto-acks when the animation ends. */
          kind: "random-reveal-ack";
          stackItemId: string;
          choiceId: string;
      }
    | { kind: "play-land"; cardInstanceId: string }
    | {
          /** CR 116.2 / 702.139a (ADR 0064) — the `summon-companion` special
           *  action. No card id (the source is `player.companion`, not a hand
           *  card) and no tap plan: the fixed generic {3} is solved and
           *  applied server-side in one shot by the shared auto-tap solver
           *  (`canSummonCompanion`/`summonCompanion`, gre/companion.ts /
           *  game.ts) — there's no colored-pip choice for the executor to
           *  replay. */
          kind: "summon-companion";
      }
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
          /** CR 107.4f — total life paid for this cast's Phyrexian pips ({C/P})
           *  chosen to be paid with life (2 per pip). The mana-paid pips are
           *  already folded into `tapPlan`. Absent / 0 for a non-Phyrexian cast
           *  or an all-mana Phyrexian split. Deducted in `applyMove`. */
          payLife?: number;
      }
    | {
          kind: "activate-ability";
          cardInstanceId: string;
          abilityId: string;
          /** CR 700.2 / 602.2b (issue #1341) — the mode of a MODAL activated
           *  ability (Umezawa's Jitte), locked in at announcement. One move
           *  variant per mode, each carrying that mode's own targets. */
          chosenModeId?: string;
          chosenX?: number;
          targets: TargetSelection[];
          confirmTargets: boolean;
          tapPlan: ManaTap[];
          /** CR 602.1 / 118 — the cards named to pay the ability's DEFERRED
           *  cost legs (discard / exile-from-graveyard / tap-other). The
           *  server parks a `pendingActivation` for each of them and never
           *  commits until they are answered, so the pick travels ON the move:
           *  `applyMove` applies exactly these cards in the search, and
           *  `executor.ts` names exactly these cards to the server. Absent for
           *  an ability with no such leg. */
          costPicks?: ActivationCostPicks;
      }
    | {
          /** Answer an ENGINE-RAISED pending target selection (issue #2283) —
           *  a targeted trigger's targets (CR 603.3d), a retarget (CR 115.7)
           *  or a spell copy’s retarget (CR 707.10c). Unlike the target
           *  tuple that rides ON a `cast-spell` / `activate-ability` move, this
           *  is a STANDALONE submission: nobody announced anything, the engine
           *  simply owes the controller a choice, and until it is answered the
           *  game cannot advance at all.
           *
           *  Realised through the SAME mutations a human's clicks make —
           *  `selectTargets` (batched) then `confirmTargets` when the count is
           *  a range. Divide-as-you-choose amounts are deliberately NOT carried:
           *  `applyOneTargetSelection` treats `amount` as optional and the
           *  engine auto-divides ≥1-each at finalize (CR 601.2d), which is
           *  always a legal split and one less thing that can be rejected. */
          kind: "submit-target";
          /** The additional targets to pick, in order. May be EMPTY for an "up
           *  to N" selection the bot declines (min 0) — then only
           *  `confirmTargets` fires (`selectTargets` rejects an empty array). */
          targets: TargetSelection[];
          /** CR 601.2c — a variable-count selection needs an explicit
           *  `confirmTargets`; a fixed-N one auto-finalizes on the last pick
           *  and MUST NOT be confirmed (the selection is already gone). */
          confirmTargets: boolean;
      }
    | {
          kind: "declare-attackers";
          attackerIds: string[];
          /** CR 508.1a (issue #1220) — optional per-attacker planeswalker attack
           *  target (attackerId → planeswalkerId). Absent attackers attack the
           *  defending player. Lets the bot direct an attack at a planeswalker. */
          attackTargets?: Record<string, string>;
      }
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
 *  ordered land taps to perform, or `null` when the cost cannot be paid.
 *  Mirrors `canPotentiallyPayCost` (rules.ts) — same one-source-one-mana
 *  model — but emits the concrete sources; the mirror is now closer than it
 *  used to be (issue #1751 finding 4, closed fully by issue #1754):
 *  `getProducibleManaOptions` below is called with a real, BOTH-PLAYERS
 *  `battlefields` view built from `state` via the shared `manaGateBattlefields`
 *  helper (`constants.ts`, issue #1754 finding 6) — the SAME helper
 *  `coloredCostLeftover`/rules.ts calls from `opts.state` — so ANY
 *  board-dependent mana source's `canActivate` — self-referential
 *  (Mox Opal's Metalcraft, Fanatic of Rhonas's Ferocious) or
 *  opponent-scanning (Fellwar Stone, whose `getManaChoices` walks every
 *  OTHER player's battlefield) — is evaluated against a real board here
 *  exactly like it is by the human castability gate. Before issue #1751 this
 *  planner passed no board at all; before issue #1754 it passed a SELF-ONLY
 *  view (own controllerId + own battlefield alone), which covered the
 *  self-referential case but still starved Fellwar Stone of any opponent
 *  permanents to see. Pool mana is modelled as zero-tap sources and is
 *  consumed by the server at commit, so it never appears in the returned taps. */
export function planManaPayment(
    state: GameState,
    player: PlayerState,
    cost: Record<string, number>
): ManaTap[] | null {
    const totalRequired =
        (cost.X ?? 0) + MANA_COLORS.reduce((s, c) => s + (cost[c] ?? 0), 0);
    if (totalRequired === 0) return [];

    // Issue #1754 — both-players view, built once per call and shared across
    // every source below via the same `manaGateBattlefields` helper (issue
    // #1754 finding 6, `constants.ts`) the gate's `coloredCostLeftover`
    // (rules.ts) builds from `opts.state`, so THIS payment-planning path
    // (fixed-cost sources, actually tapping for a cost already settled on) is
    // board-aware for every board-dependent mana ability, not only the
    // self-referential ones a self-only view already covered. Issue #1757
    // closed the one remaining gap this used to flag: the {X} CEILING
    // `enumerateCastMoves` computes before ever reaching this function now
    // passes its own `state` into `maxAffordableX` too (below), so a
    // board-dependent source (Fellwar Stone) that funds a larger X is visible
    // to the ceiling exactly like it is to this planner.
    const boardBattlefields = manaGateBattlefields(state);

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
        // Issue #1754 — full both-players board view: covers Mox Opal /
        // Fanatic of Rhonas (self-referential) AND Fellwar Stone
        // (opponent-scanning), matching the gate's board visibility exactly.
        const options = getProducibleManaOptions(
            perm,
            player.id,
            boardBattlefields
        );
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

// ---------------------------------------------------------------------------
// Combination helpers
// ---------------------------------------------------------------------------

/** All size-`k` combinations of `items`, capped at `MAX_COMBINATIONS`.
 *  Exported for reuse by the Expected-Input-driven enumeration
 *  (`legalActions.ts`, issue #801). */
export function combinations<T>(items: T[], k: number): T[][] {
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

// Exported for a direct unit test (issue #2365) — proof that the bot's
// per-requirement count resolution no longer lets an unresolved `"X"` reach
// `enumerateTargetTuples`'s `for (let size = min; size <= max; size++)` loop
// below it, where `size <= "X"` used to coerce to `NaN` (always false) and
// silently drop every non-empty tuple instead of erroring.
export function targetCount(
    req: TargetRequirement,
    chosenX: number | undefined
): {
    min: number;
    max: number;
} {
    // Single shared resolver (issue #2365) — this used to re-derive the
    // literal `"X"` case inline and fall through `req.count.max ?? min` for
    // the object form, which passed an unresolved `"X"` string straight
    // through for an `{ min, max: "X" }` "up to X" range.
    const resolved = resolveTargetRequirementCount(req.count, chosenX);
    if (typeof resolved === "number") return { min: resolved, max: resolved };
    return { min: resolved.min, max: resolved.max ?? resolved.min };
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
    // CR 612.6 — a color-targeted requirement follows the source's active
    // color-word changes (Sleight of Mind on a Circle of Protection retargets
    // its "<color> source of your choice" to the new color).
    const effReq =
        req.colorFilter !== undefined
            ? {
                  ...req,
                  colorFilter: substituteColorFilter(card, req.colorFilter),
              }
            : req;
    const legal = getLegalTargets(
        state,
        effReq,
        // moves.ts enumerates legal targets for casting a spell from hand, so
        // the source is always a spell (vs an activated ability). The bot
        // enumerator reads the SAME gate the human path does.
        targetingSourceFromCard(card, true),
        player.id,
        chosenX
    );
    const { min, max } = targetCount(effReq, chosenX);
    if (max === 0) return [[]];

    const tuples: TargetSelection[][] = [];
    for (let size = min; size <= max; size++) {
        if (size === 0) {
            tuples.push([]);
            continue;
        }
        for (const combo of combinations(legal, size)) {
            // CR 601.2c (issue #1104) — a `sameController`-constrained
            // requirement's per-candidate legality is unconstrained in
            // isolation (checked by `getLegalTargets` above, correctly:
            // nothing to compare against for a lone candidate); the
            // constraint is COMBINATORIAL — every permanent in the combo
            // must share one live controller. `combinations` has no notion
            // of that relation, so it's enforced as a post-filter here,
            // mirroring the single-authority check `selectTarget` runs
            // per-pick (`sameControllerDescriptor`, `gre/targetFilters.ts`).
            if (effReq.sameController && !comboSharesController(state, combo)) {
                continue;
            }
            tuples.push(combo);
            if (tuples.length >= MAX_COMBINATIONS) return tuples;
        }
    }
    // A spell that requires ≥1 target but has none stays castable only when the
    // requirement is optional (min 0); otherwise getLegalActions wouldn't have
    // offered "cast". Guard anyway so we never emit an unfulfillable move.
    return tuples.length > 0 ? tuples : min === 0 ? [[]] : [];
}

/** CR 601.2c — every legal target tuple across ALL of a cast's independent
 *  target GROUPS (the primary requirement plus each
 *  `additionalTargetRequirements` entry, card- or mode-level), as the FLAT
 *  concatenation the rest of the pipeline expects.
 *
 *  Flat is the authoritative shape, not a convenience: `finalizeTargetSelection`
 *  (`game.ts`) commits `[...priorSelected, ...selected]` onto the stack item in
 *  declaration order, and an Effect Script reads groups positionally off that
 *  one list (`{ target: 0 }` = the artifact, `{ target: 1 }` = the enchantment
 *  for Hull Breach's third mode). Producing the same flat list here means both
 *  the executor (one batched `selectTargets`) and the in-search appliers — which
 *  copy `move.targets` straight onto the stack item — get the complete
 *  announcement, so mode `both` no longer evaluates identically to mode
 *  `artifact` in the tree.
 *
 *  Groups are enumerated independently against the SAME pre-cast board the
 *  server validates each group against in `announceCast`, and the cartesian
 *  product is capped at `MAX_COMBINATIONS`. An empty group list, or one whose
 *  requirements are all absent/zero-count, yields the single empty tuple. */
function enumerateTargetGroupTuples(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    groups: (TargetRequirement | undefined)[],
    chosenX: number | undefined
): TargetSelection[][] {
    let acc: TargetSelection[][] = [[]];
    for (const req of groups) {
        const groupTuples = enumerateTargetTuples(
            state,
            player,
            card,
            req,
            chosenX
        );
        // CR 601.2c — a group with no legal way to be filled makes the whole
        // announcement illegal (`announceCast` throws "Not enough legal
        // targets"), so the cast is not a move at all.
        if (groupTuples.length === 0) return [];
        const next: TargetSelection[][] = [];
        for (const prefix of acc) {
            for (const tuple of groupTuples) {
                next.push([...prefix, ...tuple]);
                if (next.length >= MAX_COMBINATIONS) break;
            }
            if (next.length >= MAX_COMBINATIONS) break;
        }
        acc = next;
    }
    return acc;
}

/** CR 601.2c (issue #1104) — true iff every PERMANENT-type target in `combo`
 *  shares one live controllerId (Barrin's Spite's "two target creatures
 *  controlled by the same player"). A combo of size ≤ 1, or one with no
 *  permanent members, trivially passes (nothing to compare). */
function comboSharesController(
    state: GameState,
    combo: TargetSelection[]
): boolean {
    let controllerId: string | undefined;
    for (const t of combo) {
        if (t.type !== "permanent") continue;
        let found: string | undefined;
        for (const p of state.players) {
            const card = p.battlefield.find((c) => c.id === t.id);
            if (card) {
                found = card.controllerId;
                break;
            }
        }
        if (found === undefined) return false; // CR 608.2b — shouldn't happen
        if (controllerId === undefined) controllerId = found;
        else if (controllerId !== found) return false;
    }
    return true;
}

/** CR 603.3d / 115.7 / 707.10b (issue #2283) — every legal answer to the
 *  ENGINE-RAISED pending target selection `playerId` owes right now.
 *
 *  Returns `[]` when there is no such selection: no pending target, one owed to
 *  the OPPONENT, or one this player is mid-ANNOUNCING (a `"cast"` / `"ability"`
 *  continuation the executor drives atomically inside one cast/activation
 *  sequence — surfacing moves there would let a second decision interleave into
 *  a half-built announcement). The classification is
 *  `raisedPendingTargetOwedBy`, compile-time exhaustive over
 *  `PendingTarget["kind"]`.
 *
 *  Legality comes from the same `getLegalTargets` + lowered-requirement pair
 *  the accepting site (`applyOneTargetSelection`, `game.ts`) validates with, so
 *  an enumerated submission is one the server accepts — a rejected submission
 *  re-freezes the bot exactly as hard as no submission at all. */
export function enumerateRaisedTargetMoves(
    state: GameState,
    playerId: string
): Move[] {
    const pt = raisedPendingTargetOwedBy(state, playerId);
    if (!pt) return [];

    const already = pt.selected.length;
    const legal = getLegalTargets(
        state,
        requirementFromPendingTarget(pt),
        // CR 702.16b / 611 — protection and `cantBeTargeted` guards read the
        // source's live characteristics; the same helper the human path uses.
        pendingTargetingSource(state, pt.cardInstanceId, pt.kind),
        playerId,
        pt.chosenX,
        // CR 601.2c — objects already chosen under this requirement are
        // excluded by `getLegalTargets` itself (the single authority).
        pt.selected
    );

    const minTotal = typeof pt.count === "number" ? pt.count : pt.count.min;
    const rawMax =
        typeof pt.count === "number"
            ? pt.count
            : (pt.count.max ?? already + legal.length);
    // CR 601.2d — a divide-as-you-choose selection can never have more targets
    // than points to divide (each target must receive at least 1).
    const budgetMax =
        pt.divideTotal !== undefined
            ? pt.divideTotal
            : Number.POSITIVE_INFINITY;
    const maxTotal = Math.min(rawMax, budgetMax, already + legal.length);

    const lo = Math.max(0, minTotal - already);
    const hi = maxTotal - already;
    if (hi < lo) return [];

    const moves: Move[] = [];
    for (let size = lo; size <= hi; size++) {
        const total = already + size;
        // CR 601.2c — a fixed-N selection auto-finalizes on the last pick, so
        // confirming it afterwards hits "No target selection in progress".
        const confirmTargets = !pendingTargetCountMaxReached(pt.count, total);
        if (size === 0) {
            // "Up to N" declined. `selectTargets` rejects an empty array, so
            // this submission is confirm-only — and it is legal only when the
            // selection can actually rest at zero.
            if (confirmTargets) {
                moves.push({
                    kind: "submit-target",
                    targets: [],
                    confirmTargets,
                });
            }
            continue;
        }
        for (const combo of combinations(legal, size)) {
            // CR 601.2c (issue #1104) — `sameController` is a COMBINATORIAL
            // constraint `getLegalTargets` cannot see per-candidate; mirror the
            // post-filter `enumerateTargetTuples` applies for casts.
            if (pt.sameController && !comboSharesController(state, combo)) {
                continue;
            }
            moves.push({
                kind: "submit-target",
                targets: combo,
                confirmTargets,
            });
            if (moves.length >= MAX_COMBINATIONS) return moves;
        }
    }
    return moves;
}

function enumerateCastMoves(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): Move[] {
    const cardId = (card.card as { id?: string }).id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    const rawCost = getInstanceManaCost(card) ?? {};

    // Bot-only prune (#938): a copy-on-ETB spell (Clone, Copy Artifact, Vesuvan
    // Doppelganger, Dance of Many) is a legal but strictly wasteful cast when no
    // permanent it could copy exists — it resolves into a do-nothing permanent
    // while spending its mana and a card. Skip enumerating the cast while NO
    // permanent on ANY battlefield matches the declarative `copySourceFilter`
    // (the copy is chosen "of any … on the battlefield", so all controllers
    // count). CR legality is unchanged — this only constrains the Bot's move
    // generation, never a human/server cast. Keyed off card data so the whole
    // copy-on-ETB class inherits the guard without a card-id allowlist.
    if (def?.copySourceFilter) {
        const hasCopySource = state.players.some((p) =>
            p.battlefield.some((c) =>
                // Layered view, not the raw instance: a `colors`/P-T clause on
                // a copy filter would otherwise fail CLOSED and silently
                // suppress the cast for the bot (issue #1209 — the same class
                // as the cost pre-checks below).
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    def.copySourceFilter!,
                    { supertypesOf: liveSupertypesOf }
                )
            )
        );
        if (!hasCopySource) return [];
    }

    // Modal spells (CR 700.2): one variant per mode, each with its own targets.
    //
    // CR 601.2c — a variant's target requirements are a LIST of independent
    // GROUPS, not a single requirement: the primary one plus every entry of
    // `additionalTargetRequirements` (Fumarole's "target creature and target
    // land"; Hull Breach's third mode, whose groups live on the MODE, issue
    // #1953). Reading only the primary requirement here enumerated a mode-3
    // Hull Breach with ONE target: `announceCast` then filled group 0, left the
    // enchantment group pending, and the executor's next `tapForPayment` threw
    // on `assertExpectedInput(expect: "priority")` — the Bot stalling on a move
    // it generated itself.
    //
    // Both `??` chains below are the SAME shape `announceCast` uses, checked
    // line by line against `game.ts`:
    //  - primary  ← `chosenMode?.targetRequirement ??
    //    kickerAdjustedTargetRequirement(cardDef, kickerPayments)`
    //    (game.ts `activeTargetRequirement`). `??`, NOT a ternary on `mode`:
    //    a modal card whose chosen MODE carries no requirement while the CARD
    //    does — Prismatic Ward, Chromatic Armor, Magical Hack, Phantasmal
    //    Terrain, Sleight of Mind, where `modes` are the as-enters colour /
    //    subtype pick and the target lives on the card — must still fall back
    //    to the card level. A ternary yielded `undefined` for every mode, so
    //    the Bot emitted one zero-target cast per colour and the executor's
    //    next `tapForPayment` threw the same `expect: "priority"` stall.
    //    `kickerAdjustedTargetRequirement` reduces to `cardDef
    //    .targetRequirement` here because this enumerator never pays kicker
    //    (no `kickerPayments` anywhere in this file), so the fallback is
    //    identical for every move it can emit.
    //  - extra    ← `chosenMode?.additionalTargetRequirements ??
    //    cardDef.additionalTargetRequirements ?? []` (game.ts
    //    `additionalRequirements`) — textually the same chain.
    const groupsFor = (mode?: {
        targetRequirement?: TargetRequirement;
        additionalTargetRequirements?: TargetRequirement[];
    }): (TargetRequirement | undefined)[] => {
        const primary = mode?.targetRequirement ?? def?.targetRequirement;
        const extra =
            mode?.additionalTargetRequirements ??
            def?.additionalTargetRequirements ??
            [];
        return [primary, ...extra];
    };
    // CR 614.12a (issue #2019) — a card whose modal pick is an AS-ENTERS choice
    // (Voice of All, Prismatic Ward, Quirion Elves, Jihad) does not announce a
    // mode: `announceCast` rejects a supplied `chosenModeId` outright, so
    // enumerating one Move per mode here would generate moves the mutation
    // throws on. The pick is answered later, at the CR 614 chokepoint, through
    // the ordinary `option-pick` PendingChoice the Brain already realises.
    const modeVariants =
        def?.modes && def.modes.length > 0 && !declaresAsEntersMode(def)
            ? def.modes.map((m) => ({
                  modeId: m.id as string | undefined,
                  groups: groupsFor(m),
              }))
            : [{ modeId: undefined, groups: groupsFor() }];

    // X spells: enumerate X = 0..maxAffordable. Fixed (numeric) costs use a
    // single X = undefined. The X ceiling comes from the SHARED
    // `maxAffordableX` (rules.ts) — the same helper the human castability gate
    // uses — passed the SAME `state` the gate's own `hasEnoughLegalTargets`
    // call forwards (issue #1757; previously omitted here, so a board-dependent
    // mana source — Fellwar Stone, a Metalcraft-satisfied Mox Opal — reached a
    // higher ceiling at the gate than the Bot ever enumerated) — so the Bot
    // and `hasEnoughLegalTargets`'s own probe can never disagree on the
    // reachable range. That agreement is scoped to the gate's PROBE, not to
    // the cast path's actual reachable range: `maxAffordableX` deliberately
    // does not model CR 601.2f cost reductions (mirrors
    // `canPotentiallyPayCost`), while this loop's `normCost` DOES fold
    // `applyCostModifiers` per candidate X below, and `announceCast`
    // (game.ts) enforces no `maxAffordableX` ceiling at all on the human's
    // announced X — so under a live cost reducer a human can legally announce
    // an X the Bot never enumerates here. Each X this loop DOES enumerate is
    // still re-checked below via `planManaPayment`, so an X the shared greedy
    // ceiling over-counts is filtered there (never over-offered) — the
    // asymmetry only ever under-enumerates the Bot's X range, never
    // over-offers it.
    // CR 107.3 — a board-count upper bound on X ("X can't be greater than the
    // number of snow lands you control", Winter's Chill) caps the enumeration
    // to the same ceiling the cast mutation enforces, so the Bot never offers
    // an X the human cast path would reject.
    const hasX = typeof rawCost.X === "string";
    const xCeiling =
        def?.castXUpperBound === "snow-lands"
            ? Math.min(
                  maxAffordableX(player, card, state),
                  countSnowLands(player.battlefield)
              )
            : maxAffordableX(player, card, state);
    const xValues: (number | undefined)[] = hasX
        ? Array.from({ length: xCeiling + 1 }, (_, i) => i)
        : [undefined];

    // CR 107.4f — a Phyrexian cost ({B/P}, {U/P}) is paid pip-by-pip with mana
    // or 2 life. The Bot takes the most-life affordable split (the canonical
    // line for these cards: pay life, keep mana up); `solvePhyrexianSplit` folds
    // the mana-paid pips into the colored cost below and reports the life owed.
    const phyPips = phyrexianPipCount(rawCost);

    // CR 601.2f (ADR 0063, issue #1337, perf hoist issue #1663) — hoisted out
    // of the mode×X loop below: `getCostModifiers` scans the FULL battlefield
    // of both players for cost-modifier static effects, and its result is
    // mode/X-invariant — no shipped `appliesToSpell` predicate reads the
    // spell's chosen mode or X (they only read the announced card's static
    // characteristics, board state and the modifier's own carrier permanent).
    // Computing it once per candidate card instead of once per (mode, X)
    // avoids N+1 redundant full-battlefield scans for an X spell, which
    // matters here since `enumerateCastMoves` runs inside the ISMCTS search
    // loop. If a future `appliesToSpell` predicate becomes mode/X-dependent,
    // this hoist must be revisited (move the call back inside the loop).
    const costModifiers =
        phyPips === 0 ? getCostModifiers(state, card, "spell") : undefined;

    // CR 601.3c / 601.2f (issue #2146) — the conditional-flash SURCHARGE the
    // Invasion cycle prices its off-window cast at ("You may cast this spell as
    // though it had flash if you pay {2} more to cast it"). Mandatory once the
    // cast happens outside the caster's own sorcery window, and `announceCast`
    // charges it there unconditionally — so the tap plan built below MUST cover
    // it or the Bot announces a cast it can never pay for: the executor
    // announces FIRST and taps afterwards, so the cast parks in `pendingCast`,
    // `enumerateMoves` returns [] while one is open, and the only exit left is
    // the `abort-announcement` rung — tap for nothing, cancel, re-enumerate the
    // identical move (the bot-freeze shape). Verdict and amount are
    // mode/X-invariant (board + card only), so both are hoisted here beside
    // `costModifiers` rather than recomputed per (mode, X).
    const flashSurchargeOwed = flashSurchargeRequired(state, player.id, card);
    const flashSurcharge = flashSurchargeOf(card);

    const moves: Move[] = [];
    for (const { modeId, groups } of modeVariants) {
        // CR 601.2c — the executor sends every announced target in ONE batched
        // `selectTargets` call and then AT MOST ONE trailing `confirmTargets`.
        // A fixed-count group auto-advances inside that batch
        // (`advanceTargetGroupOrFinalize` mutates the pending target in place,
        // so the batch's identity pin still holds), which is what makes a flat
        // concatenation of the groups executable. A VARIABLE-count group
        // (X / `{min,max}`) does NOT auto-advance — it waits for its own
        // confirm — so only the LAST group may be variable; anything else
        // would need a confirm mid-batch the executor has no shape for. This
        // is a structural property of the requirement list, not a card list:
        // no shipped card has a non-final variable group, and if one lands the
        // Bot declines to enumerate it rather than emitting an unexecutable
        // move.
        if (groups.slice(0, -1).some((g) => isVariableCount(g))) continue;
        const lastReq = groups[groups.length - 1];
        for (const x of xValues) {
            const normCost = normalizeManaCost(rawCost, { chosenX: x ?? 0 });
            // CR 601.3c / 601.2f — the surcharge is an ADDITIONAL cost, so it
            // joins the total BEFORE cost modifiers apply, exactly where
            // `announceCast` / `finalizeTargetSelection` fold it (they call the
            // same helper). No-op for every card without the rider and for the
            // same card inside its caster's sorcery window.
            foldFlashSurchargeCost(
                normCost,
                flashSurcharge,
                flashSurchargeOwed
            );
            // CR 601.2f (ADR 0063, issue #1337) — fold in battlefield
            // cost-modifier static effects (Stone Calendar, Mana Matrix,
            // Planar Gate, Power Artifact, Urza's Filter) AND a spell's own
            // `selfCostReduction` (Emry) before planning the tap payment,
            // mirroring the gate's plain-cast branch
            // (`canPotentiallyPayCost(caster, card, undefined, state, {
            // foldCostModifiers: true })` in rules.ts — issue #1695
            // fourth-pass fix split the board-view `state` arg from the
            // opt-in folding flag). Without this the enumerator built its tap
            // plan from
            // the unreduced printed cost and disagreed with `getLegalActions`
            // — the bot could never cast a spell whose affordability depends
            // on a reduction. Phyrexian costs keep the pre-existing
            // unmodified path: no shipped card combines the two (mirrors the
            // same carve-out in `canPotentiallyPayCost`). `costModifiers` is
            // hoisted above the loop (see comment there) — only
            // `applyCostModifiers` (mutating the per-iteration `normCost`)
            // stays here.
            if (costModifiers) {
                applyCostModifiers(normCost, costModifiers);
            }
            let payLife = 0;
            if (phyPips > 0) {
                const split = solvePhyrexianSplit(
                    player,
                    card,
                    rawCost,
                    x ?? 0,
                    state
                );
                if (split === null) continue;
                for (const [c, n] of Object.entries(split.manaAdditions)) {
                    if (n && n > 0) normCost[c] = (normCost[c] ?? 0) + n;
                }
                payLife = split.lifePips * PHYREXIAN_LIFE_PER_PIP;
            }
            // CR 702.66 / 601.2g — Delve (`payWith`, ADR 0063): graveyard cards
            // exiled while casting pay for {1} of GENERIC mana each, so a spell
            // the Bot cannot pay for with mana alone may still be castable.
            // Discount the generic portion by exactly the MINIMUM number of
            // exiles the caster is forced to make — the same
            // `genericManaShortfall` the announce path uses to seed
            // `offsetGeneric.min`, so the tap plan below and the delve pick the
            // driver later submits (`cast-exile-cost`, which exiles `min`) cover
            // the cost between them with nothing left over and nothing missing.
            // Without this the enumerator drops the cast entirely and the Bot
            // never casts a delve spell off a short board.
            const delveFuel = spellHasDelve(card)
                ? delveEligibleCards(player, card.id).length
                : 0;
            if (delveFuel > 0) {
                const shortfall = genericManaShortfall(
                    player,
                    card,
                    normCost,
                    state
                );
                applyGenericOffset(
                    normCost,
                    Math.min(
                        delveFuel,
                        genericPortion(normCost),
                        Number.isFinite(shortfall) ? shortfall : 0
                    )
                );
            }
            const tapPlan = planManaPayment(state, player, normCost);
            if (tapPlan === null) continue;
            for (const targets of enumerateTargetGroupTuples(
                state,
                player,
                card,
                groups,
                x
            )) {
                moves.push({
                    kind: "cast-spell",
                    cardInstanceId: card.id,
                    chosenModeId: modeId,
                    chosenX: x,
                    targets,
                    // Only the LAST group can be variable (guarded above), so
                    // it alone decides whether the cast needs a confirm.
                    confirmTargets:
                        isVariableCount(lastReq) && targets.length > 0,
                    tapPlan,
                    ...(payLife > 0 ? { payLife } : {}),
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
    perm: CardInstanceState,
    opts?: { anyPlayerOnly?: boolean; zone?: "battlefield" | "graveyard" }
): Move[] {
    // CR 611.2a / 613.1f (layer 6) — read the POST-LAYER ability set, the
    // same authority every other consumer reads (`getEffectiveActivatedAbilities`),
    // not the definition's printed list. A permanent whose definition declares
    // NO activated abilities can still hold granted ones (an Aura's
    // `activated-grant` static effect, a resolving `grantActivatedAbility`),
    // and the printed-list-only early return this replaces made every such
    // grant invisible to the bot (issue #2469). The authority also applies
    // the "loses all abilities" rule PER ability by timestamp (CR 613.7,
    // `grantOutrankedByAbilityLoss`) rather than the coarse all-or-nothing
    // this enumerator used to apply on `abilitiesSuppressedBy`: a grant
    // NEWER than the suppression survives, one older does not.
    const effectiveAbilities = getEffectiveActivatedAbilities(perm);
    if (effectiveAbilities.length === 0) return [];

    const fromGraveyard = opts?.zone === "graveyard";
    const moves: Move[] = [];
    for (const { ability } of effectiveAbilities) {
        // When scanning an opponent's permanent (CR 113.3c / 602.1), only "any
        // player may activate" and "only your opponents may activate" abilities
        // are legal for this player.
        if (
            opts?.anyPlayerOnly &&
            !ability.activatableByAnyPlayer &&
            !ability.activatableByOpponentsOnly
        )
            continue;
        // On the player's OWN permanent, an "only your opponents may activate"
        // ability (Clergy) is never a legal move for the controller (CR 602.1).
        if (!opts?.anyPlayerOnly && ability.activatableByOpponentsOnly)
            continue;
        // CR 113.6 / 702.29a / 702.129a — a zone-restricted ability functions
        // ONLY from the zone it opts into: Cycling (`activateFromHand`) from
        // the hand, Ashen Ghoul / Eternalize (`activateFromGraveyard`) from the
        // graveyard. Mirrors the server gate (`game.ts` activateAbility) and
        // the human UI gate (`getStackAbilities` / `getGraveyardStackAbilities`,
        // src/lib/card-utils.ts).
        //
        // Before issue #2339 this enumerator scanned the BATTLEFIELD only and
        // skipped both flags unconditionally, so the bot was structurally blind
        // to every graveyard-source ability — Ashen Ghoul included. `zone` now
        // says which zone the caller is scanning, and the gate is the same
        // rule read from either side.
        if (fromGraveyard) {
            if (!ability.activateFromGraveyard) continue;
            // A card in a graveyard is not a permanent (CR 110.1), so it has no
            // tap state and a {T} leg is unpayable there.
            if (ability.cost.tap) continue;
        } else if (ability.activateFromHand || ability.activateFromGraveyard) {
            continue;
        }
        // Only abilities that use the stack are macro-moves here; mana abilities
        // are funded on demand by the cast planner, never activated standalone.
        if (!ability.useStack) continue;
        // Conditional abilities need a runtime predicate we don't replicate;
        // leave them to a later slice rather than enumerate possibly-illegal
        // moves. (Documented limitation — server would reject anyway.)
        if (ability.canActivate || ability.getTargetRequirement) continue;
        // CR 606 — a loyalty ability (planeswalker) has a signed `cost.loyalty`
        // and sorcery-speed / one-per-turn / not-below-0 gates the move planner
        // doesn't yet cost or fund. Bot planeswalker play is a follow-up to the
        // loyalty FRAMEWORK slice (issue #700, ADR 0058); skip these for now so
        // the bot never enumerates an unpayable/mis-costed loyalty move. The
        // server (`assertLoyaltyActivationLegal`) rejects them regardless.
        if (ability.cost.loyalty !== undefined) continue;
        // CR 602.5 — once-per-turn enforcement.
        if (
            ability.oncePerTurn &&
            (perm.activationsThisTurn?.[ability.id] ?? 0) > 0
        ) {
            continue;
        }
        // CR 611.1 — a self-animate ability (manlands: Mishra's Factory, Jade
        // Statue) is a no-op while the source is already animated (one
        // animation at a time; `state.ts` `animateAsCreature` returns early
        // when `card.animation` is set). Enumerating it would let the bot pay
        // the activation cost for zero gain, so it's not a legal macro-move
        // while animated.
        if (ability.animatesSelf && perm.animation) {
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
        // CR 602.5d / 307.5 — "activate only as a sorcery" (Equip is the
        // canonical shape). Without this the enumerator hands the bot an
        // Equip move in DECLARE_ATTACKERS; the server rejects it, but a
        // TARGETED ability rejected mid-chain leaves the bot's `activateAbility
        // → selectTarget` sequence half-applied. Mirrors the server's own
        // `assertActivationTimingLegal`.
        if (ability.sorcerySpeedOnly && !isSorceryTiming(state)) {
            continue;
        }
        // Tap cost: source must be untapped and not summoning-locked.
        if (ability.cost.tap) {
            if (perm.isTapped) continue;
            if (isTapLockedBySummoningSickness(perm)) continue;
        }
        // CR 118.3 — "discard the last card you drew this turn" cost
        // (Jandor's Ring) is unpayable when no such card is in hand.
        if (ability.cost.discardLastDrawn && !canPayDiscardLastDrawn(player)) {
            continue;
        }
        // CR 118 / 122.1c — "remove N <type> counters" (Thallid) is unpayable
        // when the source is short. The server validates this up front and
        // throws, so without the gate the bot enumerates — and, since issue
        // #1920 made an activation's payoff visible, PREFERS — a move the
        // mutation rejects. Measured before this gate: a Thallid with one spore
        // counter, turn 3 precombat main, 200 iterations at seed 1, chose the
        // activation (1.0 against `pass` 0.99826) while `main` chose `pass`.
        if (
            ability.cost.removeCounter &&
            !canPayRemoveCounterCost(perm, ability.cost.removeCounter)
        ) {
            continue;
        }
        // CR 118.4 — a life cost is unpayable below that much life; the server
        // throws "Not enough life" on the same comparison.
        if (
            ability.cost.life !== undefined &&
            !canPayLifeCost(player, ability.cost.life)
        ) {
            continue;
        }
        // CR 118.3 — "discard a card at random" is illegal with an EMPTY hand
        // (Ring of Renewal, Coral Helm); the server throws "No card in hand to
        // discard". The one cost leg whose payer does not throw — it clamps to
        // hand size — so it read as safe while being illegal, and the search
        // pushed an activation the mutation rejects.
        if (ability.cost.discardAtRandom && !canPayDiscardAtRandom(player)) {
            continue;
        }
        // CR 602.1 / 118.5 — "sacrifice a permanent matching <filter>" cost is
        // unpayable when no matching permanent is on the player's battlefield
        // (Atog, Ashnod's Altar, Orcish Mechanics, etc.). Matched through
        // `effectivePermanentView` — the SAME view the server's candidate scan
        // (`sacrificeCandidates`) uses. A raw `CardInstanceState` carries no
        // derived `colors`, so a colour-filtered cost (Thelonite Monk's
        // "a green creature", Homarid Spawning Bed's "a blue creature",
        // Freyalise Supplicant's "a red or white creature") matched nothing and
        // the bot dropped the whole activation as illegal (issue #1209).
        if (
            ability.cost.sacrificeFilter &&
            !player.battlefield.some((c) =>
                matchesPermanentFilter(
                    effectivePermanentView(state, c),
                    ability.cost.sacrificeFilter!,
                    {
                        selfControllerId: player.id,
                        // CR 109.2 (issue #2367) — "Sacrifice ANOTHER artifact"
                        // (Legion Extruder): the source can't pay its own cost
                        // with itself. Without this id an `excludeSource`
                        // filter matches nothing here (fail-closed) and the bot
                        // simply never enumerates the activation.
                        selfInstanceId: perm.id,
                        supertypesOf: liveSupertypesOf,
                    }
                )
            )
        ) {
            continue;
        }
        // CR 602.1 / 118.3 — "discard a card matching <filter>" cost
        // (Survival of the Fittest) is unpayable when no matching card is in
        // the player's hand.
        if (
            ability.cost.discardFilter &&
            player.hand.filter((c) =>
                handCardMatchesFilter(c, ability.cost.discardFilter!.filter)
            ).length < ability.cost.discardFilter.count
        ) {
            continue;
        }
        // CR 602.1 / 118.5 — "exile N cards from a single graveyard" cost
        // (Night Soil) is unpayable unless one graveyard holds enough matching
        // cards. The whole cost must come from ONE graveyard (CR 118.5).
        if (ability.cost.exileFromGraveyard) {
            const { count, cardType, owner } = ability.cost.exileFromGraveyard;
            // CR 118.5 — `owner: "you"` restricts the source to the activating
            // player's own graveyard (Grim Lavamancer); default = any player's.
            const sources = owner === "you" ? [player] : state.players;
            const payable = sources.some(
                (p) =>
                    p.graveyard.filter(
                        (c) =>
                            cardType === undefined || c.types.includes(cardType)
                    ).length >= count
            );
            if (!payable) continue;
        }
        // CR 602.1 / 118.8 — "tap N untapped permanents matching <filter> you
        // control" cost is unpayable without N matching untapped permanents
        // other than the source (Hand of Justice).
        if (ability.cost.tapOtherFilter) {
            const { filter } = ability.cost.tapOtherFilter;
            const available = player.battlefield
                .filter(
                    (c) =>
                        c.id !== perm.id &&
                        !c.isTapped &&
                        // Same view the server's `tapOtherCandidates` uses —
                        // a raw instance has no derived `colors`, so Hand of
                        // Justice's "three untapped WHITE creatures you
                        // control" matched nothing here and the enumerator
                        // emitted ZERO activations for it (issue #1209).
                        matchesPermanentFilter(
                            effectivePermanentView(state, c),
                            filter,
                            {
                                selfControllerId: player.id,
                                supertypesOf: liveSupertypesOf,
                            }
                        )
                )
                .map((c) => ({
                    id: c.id,
                    // CR 702.122a/b — crew contribution (effective power plus
                    // the creature's own `crewPowerBonus`).
                    power: crewPowerContribution(
                        getEffectivePower(state, c),
                        tryGetDefinition((c.card as { id?: string }).id ?? "")
                            ?.crewPowerBonus ?? 0
                    ),
                }));
            if (!canPayTapOtherCost(ability.cost.tapOtherFilter, available))
                continue;
        }
        // Mana cost: must be payable. The {T} part of the cost is paid by the
        // activate mutation itself, not by the tap plan.
        const manaCost: Record<string, number> = ability.cost.mana
            ? normalizeManaCost(ability.cost.mana)
            : {};
        // FEM Merseine (CR 601.2f / 202.3) — "Pay enchanted creature's mana
        // cost": fold the attached host's printed cost into the affordability
        // check so the Brain only offers the activation when it can pay.
        if (ability.cost.manaEqualToEnchantedCreatureCost) {
            const hostId = perm.attachedTo;
            const host = hostId
                ? state.players
                      .flatMap((p) => p.battlefield)
                      .find((c) => c.id === hostId)
                : undefined;
            if (!host) continue;
            const hostCardId = (host.card as { id?: string }).id;
            const hostCost = (
                hostCardId ? tryGetDefinition(hostCardId) : undefined
            )?.manaCost;
            const hostNorm = hostCost ? normalizeManaCost(hostCost) : {};
            for (const [sym, amt] of Object.entries(hostNorm)) {
                manaCost[sym] = (manaCost[sym] ?? 0) + amt;
            }
        }
        // Chromatic Armor (CR 601.2f) — "{X}: … X is the number of sleight
        // counters": fold the source's own counter count into the affordability
        // check so the Brain only offers the activation when it can pay.
        if (ability.cost.manaEqualToCounterCount) {
            const have =
                perm.counters?.[ability.cost.manaEqualToCounterCount.type] ?? 0;
            if (have > 0) manaCost.X = (manaCost.X ?? 0) + have;
        }
        const tapPlan = planManaPayment(state, player, manaCost);
        if (tapPlan === null) continue;

        // Modal activated abilities (CR 700.2 / 602.2b, issue #1341): one
        // variant per mode, each with its OWN target requirement — the same
        // shape modal spells use above. A non-modal ability keeps its single
        // ability-level requirement.
        //
        // Reflexive self-EXCLUDE (issue #2399) is applied through the SAME
        // shared helper `activateAbilityOnState` uses, so the bot enumerates
        // exactly the tuples the mutation would accept — an "ANOTHER target"
        // ability whose only other legal target is itself must yield NO move
        // here, not a move the server then rejects.
        const selfExcluded = (req: TargetRequirement | undefined) =>
            req ? applySelfExclusion(req, perm.id) : req;
        const abilityModeVariants =
            ability.modes && ability.modes.length > 0
                ? ability.modes.map((m) => ({
                      modeId: m.id as string | undefined,
                      req: selfExcluded(m.targetRequirement),
                  }))
                : [
                      {
                          modeId: undefined,
                          req: selfExcluded(ability.targetRequirement),
                      },
                  ];
        // CR 602.1 / 118 — the deferred cost legs (discard / exile-from-
        // graveyard / tap-other) are paid by NAMING cards, and the server never
        // commits the activation until they are named. The picks therefore ride
        // on the move (one variant per discard candidate worth searching over —
        // WHICH creature a tutor engine eats is the decision the card is
        // about), so the search applies exactly what the executor submits.
        // An empty list means a leg has no legal payment: not a legal move.
        const pickVariants = enumerateActivationCostPicks(
            state,
            player,
            perm,
            ability
        );
        if (pickVariants.length === 0) continue;

        for (const { modeId, req } of abilityModeVariants) {
            const tuples = enumerateTargetTuples(
                state,
                player,
                perm,
                req,
                undefined
            );
            for (const targets of tuples) {
                for (const costPicks of pickVariants) {
                    moves.push({
                        kind: "activate-ability",
                        cardInstanceId: perm.id,
                        abilityId: ability.id,
                        ...(modeId ? { chosenModeId: modeId } : {}),
                        targets,
                        confirmTargets:
                            isVariableCount(req) && targets.length > 0,
                        tapPlan,
                        ...(costPicks ? { costPicks } : {}),
                    });
                    if (moves.length >= MAX_COMBINATIONS) return moves;
                }
            }
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

/** Every legal attacker declaration for the active player (CR 508.1),
 *  respecting must-attack requirements (CR 508.1d), eligibility, and the
 *  Caverns of Despair cap. Exported for the Expected-Input-driven enumeration
 *  (`legalActions.ts`, issue #801). */
export function enumerateAttackerMoves(
    state: GameState,
    player: PlayerState
): Move[] {
    const defender = otherPlayer(state, player.id);
    const defBf = defender?.battlefield;
    const eligible = player.battlefield.filter(
        (c) => validateAttackerEligibility(c, defBf, state).eligible
    );
    const required = new Set(
        getRequiredAttackerIds(player.battlefield, state, defBf, undefined)
    );
    const optional = eligible.filter((c) => !required.has(c.id));
    const requiredIds = [...required];

    // CR 508.1a — the battlefield-wide cap on declared attackers (Caverns of
    // Despair at two, Dueling Grounds at one).
    const cap = getAttackerCap(state);

    // CR 508.1d — requirements are obeyed to the MAXIMUM number possible
    // without violating a restriction, and the cap is a restriction. The legal
    // declarations are therefore exactly: a `quota`-sized subset of the
    // required creatures (the declarer picks WHICH when the cap admits fewer
    // than all), plus any subset of the voluntary creatures that fits in the
    // leftover slack. This is precisely the reachable output set of
    // `foldAttackRequirements` — the same authority `confirmAttackers` and the
    // auto-pass confirm normalize through — so the bot can never propose a
    // declaration the mutation would rewrite, and never miss one it would
    // accept. (`gre/combat.ts` carries the rule; the shared `quota` is the
    // seam.)
    const quota = maxObeyableAttackRequirements(requiredIds.length, cap);
    // `combinations` (not `powerSet(...).filter`) — the purpose-built helper
    // enumerates size-`quota` subsets directly, so `MAX_COMBINATIONS` bounds
    // the ANSWER rather than a power set that would be truncated to 64 members
    // before the size filter ever ran (with 8 required creatures under a cap of
    // 2 that filter would have seen a fraction of the 28 real choices).
    const requiredBases: string[][] =
        quota === requiredIds.length
            ? [requiredIds]
            : combinations(requiredIds, quota);
    const slack = cap === undefined ? Number.POSITIVE_INFINITY : cap - quota;

    const subsets = requiredBases.flatMap((base) =>
        powerSet(optional)
            .filter((subset) => subset.length <= slack)
            .map((subset) => [...base, ...subset.map((c) => c.id)])
    );

    const baseMoves: Move[] = subsets.map((attackerIds) => ({
        kind: "declare-attackers" as const,
        attackerIds,
    }));

    // CR 508.1a (issue #1220) — the bot must also be able to attack a
    // planeswalker the defender controls, not only the defending player. For
    // each defending planeswalker, add one variant per non-empty subset that
    // directs the whole declared attack at that planeswalker (attackTargets
    // maps every attacker → that planeswalker). This keeps the option available
    // to the search without a per-attacker combinatorial blow-up; the evaluator
    // picks the player-vs-planeswalker split. `applyMove` drops targets for
    // attackers/planeswalkers that are no longer legal.
    const defenderPlaneswalkers = (defBf ?? []).filter((c) =>
        isPlaneswalker(c)
    );
    const pwMoves: Move[] = [];
    for (const pw of defenderPlaneswalkers) {
        for (const attackerIds of subsets) {
            if (attackerIds.length === 0) continue;
            const attackTargets: Record<string, string> = {};
            for (const id of attackerIds) attackTargets[id] = pw.id;
            pwMoves.push({
                kind: "declare-attackers" as const,
                attackerIds,
                attackTargets,
            });
        }
    }

    return [...baseMoves, ...pwMoves];
}

/** Every legal blocker assignment for the declaring player (CR 509.1),
 *  respecting per-blocker eligibility, the Caverns of Despair blocker cap
 *  (CR 509.1a), and menace-style minimums (CR 509.1b). Exported for the
 *  Expected-Input-driven enumeration (`legalActions.ts`, issue #801). */
export function enumerateBlockerMoves(
    state: GameState,
    player: PlayerState
): Move[] {
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

    // CR 509.1a — drop combos that declare more than the battlefield-wide cap
    // of distinct blocking creatures (Caverns of Despair, Dueling Grounds).
    // The empty assignment always survives, so the bot can never be left
    // without a legal declare-blockers move.
    const blockerCap = getBlockerCap(state);
    const capped =
        blockerCap === undefined
            ? combos
            : combos.filter(
                  (assignments) =>
                      new Set(assignments.map((a) => a.blockerId)).size <=
                      blockerCap
              );

    // CR 509.1b — minimum-blocker thresholds (menace, and the parametrized
    // `minimum-blockers:N` rules-text form). Drop combos that block such an
    // attacker with fewer than its minimum number of distinct blockers; the
    // server rejects these at confirm time, so the bot must not consider them
    // legal moves either (mirrors the cap filter above). Both sides read the
    // SAME `getMinimumBlockers`, so a new source can never desync them.
    const minLegal = capped.filter((assignments) => {
        const blockerCountByAttacker = new Map<string, number>();
        for (const a of assignments) {
            blockerCountByAttacker.set(
                a.attackerId,
                (blockerCountByAttacker.get(a.attackerId) ?? 0) + 1
            );
        }
        for (const atk of attackers) {
            const blockedBy = blockerCountByAttacker.get(atk.id) ?? 0;
            if (blockedBy > 0 && blockedBy < getMinimumBlockers(atk)) {
                return false;
            }
        }
        return true;
    });

    return minLegal.map((assignments) => ({
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

/** Per-caller knobs for {@link enumerateMoves}. */
export type EnumerateMovesOptions = {
    /** Drop moves that are PROVABLY dominated by `pass` — a cast/activation
     *  whose full resolution changes nothing but the mover's own cost
     *  (Damnation on a creature-free board, issue #1887). BOT paths only:
     *  `legalActions` (the human affordance surface) and scripted setup
     *  realisation must keep seeing the complete legal set, since the server
     *  stays the sole authority on legality and a dominated move is still
     *  perfectly LEGAL — just never worth searching.
     *
     *  COST: a probe is three `cloneGameState`s plus a whole-`GameState` deep
     *  compare, ~6× the cost of the enumeration itself on a hand of cheap
     *  instants. Enable it ONCE per decision, never per tree node — see
     *  `searchWithTrace`, which prunes at the root and reuses the verdict for
     *  the root layer of every iteration (issue #1905 review finding 3). */
    pruneDominatedNoOps?: boolean;
    /** Called with each move `pruneDominatedNoOps` dropped, in enumeration
     *  order. Lets a caller reuse the (expensive) verdict elsewhere instead of
     *  re-probing — `searchWithTrace` turns it into the deny-set that keeps the
     *  dominated move out of the tree's root layer too. */
    onPruned?: (move: Move) => void;
};

/** The complete set of legal macro-moves for `playerId` at the current decision
 *  point. Empty when the player owes no action right now. Pure. */
export function enumerateMoves(
    state: GameState,
    playerId: string,
    options?: EnumerateMovesOptions
): Move[] {
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

    // A live mid-resolution CHOICE is a first-class decision node (PRD #1423,
    // issue #1425): the choice REPLACES the action space, so the enumerator
    // surfaces the head choice's candidate answers instead of nothing. Chooser =
    // the queue head's `playerId` (APNAP already applied by the engine at
    // enqueue, CR 101.4). Checked BEFORE the priority-holder gate: while a
    // choice is pending, priority belongs to the chooser by construction, and
    // only the chooser is offered moves. A kind with no registered generator
    // (`choiceCandidates` returns []) keeps the historical behavior — no moves,
    // the driver waits and the executor resolves it.
    const headChoice = state.pendingChoices?.[0];
    if (headChoice) {
        if (
            headChoice.playerId !== playerId ||
            state.pendingCast ||
            state.pendingTarget ||
            state.pendingActivation ||
            state.pendingCompanionPay
        ) {
            return [];
        }
        return choiceCandidates(state, headChoice).map((c) => c.move);
    }

    // CR 603.3d / 115.7 / 707.10b (issue #2283) — an ENGINE-RAISED target
    // selection is a first-class decision node, exactly like the pending choice
    // above: the engine opened it AT its owner during resolution, it freezes
    // priority, and nothing else the owner could do is legal until it is
    // answered. Before this branch the enumerator returned nothing for it (the
    // blanket "a pending target is always a continuation the executor drives"
    // below), so a bot that controlled a targeted trigger with two legal
    // targets froze the game forever — Flickerwisp, Badgermole Cub, Azure
    // Beastbinder. An ANNOUNCED (`"cast"` / `"ability"`) pending target keeps
    // the old behaviour and falls through to the blanket gate below.
    if (
        state.pendingTarget &&
        pendingTargetOrigin(state.pendingTarget.kind) === "raised"
    ) {
        return enumerateRaisedTargetMoves(state, playerId);
    }

    // Ordinary priority window. A mid-flight pending cast/target/activation is a
    // continuation the executor drives atomically, not a fresh macro-move —
    // surface nothing so the driver waits.
    if (state.priorityPlayerId !== playerId) return [];
    if (
        state.pendingCast ||
        state.pendingTarget ||
        state.pendingActivation ||
        state.pendingCompanionPay
    ) {
        return [];
    }

    const moves: Move[] = [{ kind: "pass" }];
    // CR 116.2 / 702.139a (ADR 0064) — the companion summon special action.
    // Single source of truth for legality, shared with the human mutation
    // (`summonCompanion`, game.ts) and the legal-actions surface
    // (legalActions.ts, via this enumerator).
    if (canSummonCompanion(state, player)) {
        moves.push({ kind: "summon-companion" });
    }
    for (const card of player.hand) {
        const actions = getLegalActions(state, player, card);
        if (actions.includes("play")) {
            moves.push({ kind: "play-land", cardInstanceId: card.id });
        }
        if (actions.includes("cast")) {
            moves.push(...enumerateCastMoves(state, player, card));
        }
    }
    // CR 305.9 — a land can be played from a NON-hand zone whenever an effect
    // grants the permission: the graveyard under `playsLandsFromGraveyard`
    // (Icetill Explorer / Crucible of Worlds / Ramunap Excavator, #1190), or
    // the TOP of the library under `playsLandsFromTopOfLibrary` (Courser of
    // Kruphix). Legality itself is unchanged — `getLegalActions` has always
    // returned "play" for these — but this enumerator only ever fed it HAND
    // cards, so the Bot could hold any of those permanents and never once use
    // the permission. The candidate SET is what was missing, not the rule.
    // Only lands are considered: `getLegalActions` returns "play" for a land
    // and "cast" for everything else, and a graveyard/library CAST is a
    // separate mechanism (flashback/escape) enumerated elsewhere.
    for (const card of player.graveyard) {
        if (!card.types.includes("Land")) continue;
        if (getLegalActions(state, player, card).includes("play")) {
            moves.push({ kind: "play-land", cardInstanceId: card.id });
        }
    }
    // Library: index 0 ONLY — the permission is positional and the rest of the
    // library is hidden (CR 400.2). Feeding the whole library here would leak
    // hidden information into the Bot's move set even though `getLegalActions`
    // would reject every other position.
    const libraryTop = player.library[0];
    if (
        libraryTop &&
        libraryTop.types.includes("Land") &&
        getLegalActions(state, player, libraryTop).includes("play")
    ) {
        moves.push({ kind: "play-land", cardInstanceId: libraryTop.id });
    }
    for (const perm of player.battlefield) {
        moves.push(...enumerateAbilityMoves(state, player, perm));
    }
    // CR 113.6 / 602.5b / 702.129a (issue #2339) — GRAVEYARD-source activated
    // abilities (Eternalize, Ashen Ghoul's reanimation). Only the graveyard's
    // OWNER may activate them (CR 602.1 "from YOUR graveyard"), so the
    // opponent's graveyard is deliberately not scanned. Until this issue the
    // enumerator skipped these abilities outright, which meant the bot could
    // never see one at all.
    for (const card of player.graveyard) {
        moves.push(
            ...enumerateAbilityMoves(state, player, card, {
                zone: "graveyard",
            })
        );
    }
    // CR 113.3c — "any player may activate" abilities (Ifh-Bíff Efreet) can be
    // fired off an OPPONENT's permanent. Enumerate only those there; the bot
    // still pays from its own pool (planManaPayment reads `player`).
    const opponent = otherPlayer(state, player.id);
    if (opponent) {
        for (const perm of opponent.battlefield) {
            moves.push(
                ...enumerateAbilityMoves(state, player, perm, {
                    anyPlayerOnly: true,
                })
            );
        }
    }
    // Dominance pruning (issue #1887). `pass` is `moves[0]` and is never a
    // probe candidate, so the floor can never be emptied — the filter can only
    // ever remove strictly-dominated alternatives.
    if (!options?.pruneDominatedNoOps) return moves;
    return moves.filter((m) => {
        if (!isProbeEligibleMove(state, playerId, m)) return true;
        if (!isDominatedNoOpMove(state, playerId, m)) return true;
        options.onPruned?.(m);
        return false;
    });
}
