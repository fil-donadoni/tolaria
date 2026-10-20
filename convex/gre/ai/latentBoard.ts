// Board-aware latent pricing for a card in hand (issue #3398, PRD #3397).
//
// THE BUG THIS EXISTS FOR. Until this module, a removal spell's latent worth
// in hand was a CONSTANT — `DESTROY_VALUE = 160` in `opValuers.ts`, a 2/2's
// worth, whatever the board actually held. So Stone Rain priced the same
// against an empty battlefield and against a Shivan Dragon, while the land it
// would destroy is worth 17 on the board: announcing it cost 205 margin points
// (the spell's latent 160 leaves the hand, 17 comes back in) and greedy and a
// 400-iteration search both passed, every seed (issue #3322, reproduced in
// `docs/research/greedy-vs-search.md`).
//
// THE MODEL. A targeted, board-affecting Op is worth the fitted
// `EvalWeights.latent` weight for its dimension TIMES the realised board loss
// of its BEST LEGAL TARGET on the current board, expressed in units of a
// REPRESENTATIVE victim (a vanilla 2/2 for two — the body the old constant was
// hand-tuned against, so one unit reproduces today's number exactly). The
// victim's realised loss is read from the SAME per-permanent math `evaluate`
// already runs (`permanentRealisedValue`, `evaluate.ts`), passed in as a
// callback: one pass over the opponent's permanents, no probe, no second
// valuation authority.
//
// LEGALITY IS NOT RE-DERIVED HERE. Which permanents a card could actually hit
// comes from `getLegalTargets` (`gre/rules.ts`), the single target-filter
// authority (ADR 0068) — the same function `selectTarget` agrees with. A lens
// that re-implemented "target land" would drift from the engine the first time
// a filter grew a clause, and would price a spell by victims it cannot legally
// take.
//
// CARD-AGNOSTIC (ADR 0102): nothing here reads a card name. It reads target
// requirements, board contents and the fitted weights.
import type {
    CardDefinition,
    Color,
    EffectCardFilter,
    EffectCountSpec,
    EffectForEachSelector,
    EffectManaPool,
    EffectPlayerRef,
    EffectValue,
    PermanentView,
    TargetRequirement,
} from "../../cards/types";
import { countDomain } from "../../cards/types";
import { getInstanceManaCost } from "../../cards";
import { boardCensusFor, canPayCost } from "../manaAvailability";
import { MANA_COLORS } from "../manaColors";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import {
    matchesPermanentFilter,
    type PermanentFilter,
} from "../../cards/filters";
import { representativeVictimLoss } from "./representativeVictim";
import { currentLoyalty } from "../loyalty";
import { effectivePermanentView } from "../permanentView";
import { clearCardFieldsAt } from "../state/cardFieldLifecycle";
import { liveSupertypesOf } from "../snow";
import {
    getLegalTargets,
    pendingTargetingSource,
    targetingSourceFromCard,
} from "../rules";
import { isLand, PLACEHOLDER_CARD_ID } from "../constants";
import {
    effectiveMaxHandSize,
    PHASE_ORDER,
    untapStepHoldsTapped,
} from "../phases";
import type { Phase } from "../types";
import type { EvalWeights } from "./evalWeights";
import type {
    EachPlayerSide,
    HandStep,
    LatentLens,
    SweepOutcome,
} from "./grounding";
import { isEachPlayerRef } from "./grounding";

// The Representative Victim lives in its own leaf module (issue #4903), so
// the context-free ETB valuation can price a TYPED one without importing the
// rules engine this lens reads.
export { representativeVictimLoss } from "./representativeVictim";

/** Realised board loss of one permanent, as `evaluate` scores it. Supplied by
 *  the caller (`evaluate.ts`) rather than computed here, so there is exactly
 *  one per-permanent valuation in the engine and this module needs no import
 *  back into `evaluate.ts` (which imports this one). */
export type RealisedLoss = (perm: CardInstanceState) => number;

/** Issue #4874 — how one player's zones change when a sweep resolves:
 *  `leaving` go off their battlefield, `returned` come back to their hand.
 *
 *  The sweep card itself stays in the caster's hand on both sides (issue
 *  #4880): what the hand price reads is what the MEMBERS move, in the demand
 *  context the leaf actually holds. Taking the card out as well priced the
 *  relief of unloading it — an Armageddon held over Forests alone, which no
 *  cast can ever unload, was worth the `colorCoverage` its white pip costs
 *  the hand, so finding the Plains that fixes the colour bought nothing. */
export type SweepZoneChange = {
    leaving: ReadonlySet<string>;
    returned: readonly CardInstanceState[];
};

/** Issue #4874 — what the caster's opponents lose, net of what the caster
 *  loses, in the PER-PLAYER aggregate terms when every player's zones change
 *  as `changes` (keyed by player id) says: the terms
 *  `permanentRealisedValue` deliberately leaves out because no single
 *  permanent owns them (`manaDevelopment`, `colorCoverage`). A SWEEP names
 *  its whole member set, so the aggregate it moves is a fact of the board,
 *  not a double count. Supplied by `evaluate.ts` for the same reason
 *  `RealisedLoss` is. */
export type AggregateLoss = (
    changes: ReadonlyMap<string, SweepZoneChange>
) => number;

/** How many flat slots a requirement group fills, when the DEFINITION states
 *  a ceiling. A fixed `count: N` fills N; the object form's numeric `max` is
 *  an authored ceiling too (Force of Vigor's `{ min: 0, max: 2 }`), and every
 *  one of those slots belongs to THIS requirement. `undefined` for a genuinely
 *  open-ended count — `"X"` in either position, or a `{ min }` with no `max`
 *  — which is resolved against `chosenX` at announcement (CR 601.2c,
 *  `resolveTargetRequirementCount`) and has no ceiling a pre-announcement
 *  valuation can read.
 *
 *  Emitting ONE slot for a bounded range was the phantom-victim bug the
 *  issue-#3398 review caught: Force of Vigor's script names `{ target: 0 }`
 *  AND `{ target: 1 }`, slot 1 fell off the end of the list, and the lens
 *  answered "unknown" — which the valuer reads as one full representative
 *  victim. The card then priced at 160 in hand against a board holding
 *  nothing it could legally destroy, with the `base + MV` floor lifted
 *  underneath it because slot 0 HAD answered. */
function authoredSlotCount(req: TargetRequirement): number | undefined {
    if (typeof req.count === "number") return Math.max(1, req.count);
    if (req.count === "X") return undefined;
    const max = req.count.max;
    return typeof max === "number" ? Math.max(1, max) : undefined;
}

/** The FLAT target-slot list an Effect Script's `{ target: n }` indexes into:
 *  `targetRequirement` first (repeated for each slot its count authorises),
 *  then each `additionalTargetRequirements` group in array order — the same
 *  order `announceCast` concatenates the picks in (CR 601.2c), and the same
 *  order `moves.ts`' `groupsFor` enumerates them. An open-ended group
 *  contributes ONE slot here and absorbs every higher index through
 *  {@link openEndedSlotRequirement}. A card with no requirement yields an
 *  empty list. */
export function targetSlotRequirements(
    def: Pick<
        CardDefinition,
        "targetRequirement" | "additionalTargetRequirements"
    >
): TargetRequirement[] {
    const slots: TargetRequirement[] = [];
    for (const req of targetRequirementGroups(def)) {
        for (let i = 0; i < (authoredSlotCount(req) ?? 1); i++) slots.push(req);
    }
    return slots;
}

/** The requirement a slot index PAST {@link targetSlotRequirements}' list
 *  belongs to: the last OPEN-ENDED group, since only such a group can produce
 *  more slots than the definition authorises. `undefined` when every group is
 *  bounded — a script naming a slot beyond that list names a requirement the
 *  card does not declare, and the lens must answer "unknown" (keep the
 *  representative victim) rather than invent one. */
export function openEndedSlotRequirement(
    def: Pick<
        CardDefinition,
        "targetRequirement" | "additionalTargetRequirements"
    >
): TargetRequirement | undefined {
    let openEnded: TargetRequirement | undefined;
    for (const req of targetRequirementGroups(def)) {
        if (authoredSlotCount(req) === undefined) openEnded = req;
    }
    return openEnded;
}

/** The card's target-requirement GROUPS in flat-slot order (CR 601.2c). */
function targetRequirementGroups(
    def: Pick<
        CardDefinition,
        "targetRequirement" | "additionalTargetRequirements"
    >
): TargetRequirement[] {
    const groups: TargetRequirement[] = [];
    if (def.targetRequirement) groups.push(def.targetRequirement);
    for (const extra of def.additionalTargetRequirements ?? []) {
        groups.push(extra);
    }
    return groups;
}

/** What a lens needs to answer "what is the best legal victim worth HERE". */
export interface LatentBoardInputs {
    state: GameState;
    /** The player whose hand holds the card — the would-be caster, and the
     *  player whose OWN permanents are never counted as victims. */
    casterId: string;
    /** The hand card being valued; its instance id locates the targeting
     *  source (`pendingTargetingSource`, `kind: "cast"` reads the hand). */
    card: CardInstanceState;
    /** Its registry definition — where the target requirements live. */
    def: CardDefinition;
    weights: EvalWeights;
    realisedLoss: RealisedLoss;
    /** Issue #4781 — the worth `evaluate`'s hand term gives the permanent's
     *  card back in its owner's hand: what a bounce hands back. */
    returnedWorth: RealisedLoss;
    /** Issue #4874 — see `AggregateLoss`. */
    aggregateLoss: AggregateLoss;
    /** Issue #5163 — the margin a PERMANENT's standing restrictions move on
     *  `board` (`standingLockMargin`, the reading `permanentRealisedValue`
     *  makes): read by `standingLockWorth` on the
     *  board with the hand card entered. Omitted, the lens has no standing
     *  reading and a lock in hand keeps its context-free valuation. */
    standingWorth?: (board: GameState, perm: CardInstanceState) => number;
}

/** Issue #5163 — `state` with `card` moved from `casterId`'s hand onto
 *  `casterId`'s battlefield, untapped and unattached: the board a permanent
 *  spell in hand would leave behind once it resolved (CR 608.3a), which is
 *  where its standing worth is measured. */
export function withCardEntered(
    state: GameState,
    casterId: string,
    card: CardInstanceState
): { state: GameState; perm: CardInstanceState } {
    const perm: CardInstanceState = {
        ...card,
        zone: "battlefield",
        controllerId: casterId,
        isTapped: false,
        attachedTo: undefined,
    };
    return {
        perm,
        state: {
            ...state,
            players: state.players.map((p) =>
                p.id === casterId
                    ? {
                          ...p,
                          hand: p.hand.filter((c) => c.id !== card.id),
                          battlefield: [...p.battlefield, perm],
                      }
                    : p
            ),
        },
    };
}

/** A lens that prices a card in hand against THIS board (issue #3398).
 *
 *  `victimUnits(slot)` answers, for announced target slot `slot`:
 *   - `undefined` — the slot has no readable requirement (a modal card whose
 *     targets belong to a mode, an ability-site target, a card whose script
 *     names a slot the definition does not declare). The valuer then falls
 *     back to exactly ONE representative victim, i.e. the pre-#3398 constant:
 *     the unknown case must never invent a zero.
 *   - `0` — the requirement is readable and NO opponent permanent on this
 *     board satisfies it. A removal spell facing an empty board is worth
 *     nothing, which is the case the fixed constant got most wrong.
 *   - otherwise the best legal victim's realised loss over the representative
 *     victim's.
 *
 *  Memoised per slot: the same slot is read once per Op that names it, and
 *  `getLegalTargets` walks both battlefields. */
export function makeLatentBoardLens(
    inputs: LatentBoardInputs,
    base: LatentLens
): LatentLens {
    const {
        state,
        casterId,
        card,
        def,
        weights,
        realisedLoss,
        returnedWorth,
        aggregateLoss,
        standingWorth,
    } = inputs;
    // A cast-time modal card declares its targets PER MODE (CR 700.2d), and
    // which mode will be chosen is not a fact this valuation has. Fall back
    // to the representative victim for every slot rather than pricing the
    // spell by a requirement it may never use.
    const slots = def.modes?.length ? [] : targetSlotRequirements(def);
    // A slot index past the authored list belongs to the trailing open-ended
    // group when there is one; otherwise it is genuinely unknown.
    const openEnded = openEndedSlotRequirement(def);

    const denominator = representativeVictimLoss(weights);
    const memo = new Map<number, number | undefined>();
    let measured = false;
    let standingMemo: number | undefined;

    const compute = (slot: number): number | undefined =>
        unitsOf(slots[slot] ?? openEnded);

    const unitsOf = (
        requirement: TargetRequirement | undefined
    ): number | undefined => {
        if (!requirement) return undefined;
        const source = pendingTargetingSource(state, card.id, "cast");
        const legal = getLegalTargets(state, requirement, source, casterId);
        // Only a BATTLEFIELD victim is a board loss. A player / spell /
        // graveyard-card target is a different dimension entirely (damage to
        // the face, a counterspell, regrowth) and its Op does not read this
        // lens — so a requirement that admits no permanent at all is "not a
        // board question", not "worth zero".
        const permanentSlots = legal.filter((t) => t.type === "permanent");
        if (permanentSlots.length === 0 && !admitsPermanents(requirement)) {
            return undefined;
        }
        let best = 0;
        for (const target of permanentSlots) {
            for (const player of state.players) {
                // The caster's OWN board is not a victim: destroying it is a
                // cost the search will find on its own, never latent worth
                // held in hand.
                if (player.id === casterId) continue;
                const perm = player.battlefield.find((p) => p.id === target.id);
                if (!perm) continue;
                best = Math.max(best, realisedLoss(perm));
            }
        }
        return best / denominator;
    };

    return {
        weights: base.weights,
        requirementUnits(requirement) {
            const units = unitsOf(requirement);
            if (units !== undefined) measured = true;
            return units;
        },
        victimUnits(slot) {
            if (slots.length === 0) return base.victimUnits(slot);
            if (!memo.has(slot)) memo.set(slot, compute(slot));
            const units = memo.get(slot);
            if (units !== undefined) measured = true;
            return units;
        },
        sweepUnits(select, outcome = LEAVES) {
            const lossOf = memberLoss(outcome, realisedLoss, returnedWorth);
            const net = sweptNetLoss(
                state,
                casterId,
                select,
                lossOf,
                aggregateLoss,
                weights
            );
            if (net === undefined) return undefined;
            measured = true;
            return net / denominator;
        },
        eachPlayerDifferential(valueSide) {
            let total = 0;
            // Issue #5574 — the source a step gate is asked about, built once
            // for both sides: the permanent itself on the board face, the card
            // entered under its caster on the hand face (the board it would
            // stand on once it resolved, CR 608.3a — untapped). Issue #5578 —
            // as it stands: a gate declaring a tapped-state intervening-if
            // projects it onto each side's step (`stepGateOf`).
            let stepMemo: StepSource | undefined;
            const stepSource = (): StepSource => {
                if (stepMemo === undefined) {
                    stepMemo =
                        card.zone === "battlefield"
                            ? { state, perm: card }
                            : withCardEntered(state, casterId, card);
                }
                return stepMemo;
            };
            const boardDraw = () =>
                boardLibraryMean(state, weights, returnedWorth);
            for (const player of state.players) {
                const side = boardSide(
                    state,
                    player,
                    player.id === casterId,
                    card.id,
                    stepSource,
                    realisedLoss,
                    returnedWorth,
                    denominator,
                    weights,
                    boardDraw
                );
                total += valueSide(side);
                // ADR 0151 — both sides or none: a side the board could not
                // answer leaves the representative-member valuation standing.
                if (!side.answered()) return undefined;
            }
            measured = true;
            return total;
        },
        heldDifferentialFraction: weights.heldDifferentialFraction,
        // Issue #5163 (ADR 0151) — a symmetric lock's standing worth, read on
        // the board the card would leave behind: the same per-leaf netting
        // the board face reads, so the hand face and the board face of the
        // lock are one number. Read only for a definition that declares a
        // standing lock (`declaresStandingLock`, `cardValue.ts`).
        ...(standingWorth
            ? {
                  standingLockWorth() {
                      // Memoised: the hand term and a reader of the card's
                      // own number may both ask on one leaf.
                      if (standingMemo === undefined) {
                          const entered = withCardEntered(
                              state,
                              casterId,
                              card
                          );
                          standingMemo = standingWorth(
                              entered.state,
                              entered.perm
                          );
                      }
                      return standingMemo;
                  },
              }
            : {}),
        measured: () => measured,
    };
}

/** Issue #5574 — the source permanent and the board a step gate is asked
 *  against (`EachPlayerSide.stepGateHolds`). */
type StepSource = { state: GameState; perm: CardInstanceState };

/** Issue #5578 — whether `perm` will be tapped at the beginning of
 *  `playerId`'s NEXT `step`, the firing a standing each-step engine's
 *  tapped-state intervening-if (CR 603.4, `sourceTapCondition`) is read
 *  against. Untapped now stays untapped (no future tap is predicted). Tapped
 *  now untaps only in its controller's untap step (CR 502.3), and only if no
 *  lock holds it there (`untapStepHoldsTapped`): it reads untapped on
 *  `playerId`'s step when that untap step comes first. A `step` of the
 *  current turn is still to come only before its beginning (at a stable
 *  point IN the step, its trigger has already fired). Turn order is
 *  `state.players`' order. */
export function tappedOnNextStepOf(
    state: GameState,
    perm: CardInstanceState,
    playerId: string,
    step: Phase
): boolean {
    if (perm.isTapped !== true) return false;
    const order = state.players.map((p) => p.id);
    const active = state.activePlayerId;
    const now =
        state.phase === "MULLIGAN" ? -1 : PHASE_ORDER.indexOf(state.phase);
    // Turns from now: 0 = the current one, n = the n-th player after it.
    const turnsUntil = (id: string, stillToCome: boolean) =>
        id === active && !stillToCome
            ? order.length
            : (order.indexOf(id) - order.indexOf(active) + order.length) %
              order.length;
    const stepTurn = turnsUntil(playerId, now < PHASE_ORDER.indexOf(step));
    const untapTurn = turnsUntil(
        perm.controllerId,
        now <= PHASE_ORDER.indexOf("UNTAP")
    );
    // Same turn: the untap step comes before every step that fires a
    // trigger at its beginning.
    if (untapTurn > stepTurn) return true;
    return untapStepHoldsTapped(state, perm);
}

/** Issue #5627 — CR 603.3d: whether a standing each-step trigger announcing
 *  `requirement` (a PLAYER target) finds enough legal targets on
 *  `activePlayerId`'s step, chosen by its source's controller (CR 601.2c)
 *  through the engine's one target authority (`getLegalTargets`), on `state`
 *  with that player active — a comparative predicate (Oath of Druids'
 *  `playerControlsMoreThan: { than: "active" }`) reads the active player.
 *  Without them the trigger is removed from the stack and does nothing. */
export function stepTargetHolds(
    requirement: TargetRequirement,
    activePlayerId: string,
    self: PermanentView,
    state: GameState
): boolean {
    const { count } = requirement;
    const min =
        typeof count === "number" ? count : count === "X" ? 0 : count.min;
    if (min <= 0) return true;
    const source = self as unknown as CardInstanceState;
    const legal = getLegalTargets(
        { ...state, activePlayerId },
        requirement,
        targetingSourceFromCard(source, false),
        source.controllerId
    );
    return legal.length >= min;
}

/** Issue #5162 — `player`'s side of a Differential Reading, with the flag
 *  `eachPlayerDifferential` reads to know the side was answered. */
function boardSide(
    state: GameState,
    player: PlayerState,
    own: boolean,
    valuedCardId: string,
    stepSource: () => StepSource,
    realisedLoss: RealisedLoss,
    returnedWorth: RealisedLoss,
    denominator: number,
    weights: EvalWeights,
    boardDraw: () => number | undefined
): EachPlayerSide & { answered(): boolean } {
    let answered = false;
    // A read the board could not answer voids the whole side.
    let unreadable = false;
    return {
        own,
        answered: () => answered && !unreadable,
        handWorth() {
            answered = true;
            let worth = 0;
            for (const c of player.hand) {
                if (c.id !== valuedCardId) worth += returnedWorth(c);
            }
            return worth;
        },
        discardWorth(count) {
            answered = true;
            const worths = player.hand
                .filter((c) => c.id !== valuedCardId)
                .map((c) => returnedWorth(c))
                .sort((a, b) => a - b);
            let worth = 0;
            for (const w of worths.slice(0, count)) worth += w;
            return worth;
        },
        randomDiscardUnits(count) {
            const scale = boardDraw();
            const hand = handValues(player.hand, valuedCardId, returnedWorth);
            // No library card on the board to price a discard against: the
            // side is unreadable, never a measured zero.
            if (scale === undefined || scale <= 0 || !hand) {
                unreadable = true;
                return 0;
            }
            answered = true;
            if (hand.length === 0 || count <= 0) return 0;
            let sum = 0;
            for (const w of hand) sum += w;
            // CR 701.9b — a random discard: no chooser keeps its best.
            const discarded = Math.min(count, hand.length);
            return ((sum / hand.length) * discarded) / scale;
        },
        groundCount(value, namesSide = isEachPlayerRef) {
            const n = groundSideCount(
                state,
                player,
                valuedCardId,
                value,
                namesSide
            );
            if (n === undefined) unreadable = true;
            else answered = true;
            return n;
        },
        stepGateHolds(gate) {
            answered = true;
            const source = stepSource();
            return gate(
                player.id,
                source.perm as unknown as PermanentView,
                source.state
            );
        },
        drawUnits(count, before = []) {
            const scale = boardDraw();
            const hand = handValues(player.hand, valuedCardId, returnedWorth);
            // A hidden zone read as placeholders (a blind seat) has no worth
            // to compare: the side is unreadable, never guessed.
            if (
                scale === undefined ||
                !hand ||
                player.library.some(isPlaceholder)
            ) {
                unreadable = true;
                return 0;
            }
            const library = {
                size: player.library.length,
                mean: libraryMean(player.library, weights, returnedWorth) ?? 0,
            };
            const landing = handAfter(hand, library, before);
            // Nothing to draw: no worth either way, and nothing read off the
            // board — the side is neither answered nor voided by it.
            if (library.size === 0) return 0;
            answered = true;
            const drawn = Math.min(count, library.size);
            if (drawn <= 0 || scale <= 0) return 0;
            const withDraws = [...landing];
            for (let i = 0; i < drawn; i++) withDraws.push(library.mean);
            // CR 514.1 / 402.2 — the cleanup discard keeps the player's best
            // cards up to the maximum hand size, read over the hands that
            // can reach that cleanup (`cleanupKeptGain`).
            const cap = effectiveMaxHandSize(player, state);
            return cleanupKeptGain(landing, withDraws, cap) / scale;
        },
        sacrificeUnits(effectFilter, count) {
            const filter = sweepPermanentFilter(effectFilter);
            if (filter === UNREADABLE_SWEEP_FILTER) {
                unreadable = true;
                return undefined;
            }
            answered = true;
            const losses: number[] = [];
            for (const perm of player.battlefield) {
                const view = effectivePermanentView(state, perm);
                if (
                    filter !== undefined &&
                    !matchesPermanentFilter(view, filter, {
                        supertypesOf: liveSupertypesOf,
                    })
                ) {
                    continue;
                }
                losses.push(realisedLoss(perm));
            }
            losses.sort((a, b) => a - b);
            let taken = 0;
            for (const loss of losses.slice(0, count)) taken += loss;
            return taken / denominator;
        },
        manaUnits(mana) {
            // A hidden hand has no costs to read: the side is unreadable.
            if (player.hand.some(isPlaceholder)) {
                unreadable = true;
                return 0;
            }
            answered = true;
            return spendableExtraMana(state, player, valuedCardId, mana);
        },
        digUnits(effectFilter) {
            const filter = sweepPermanentFilter(effectFilter);
            if (filter === UNREADABLE_SWEEP_FILTER) {
                unreadable = true;
                return undefined;
            }
            // A hidden library has no contents to read: unreadable.
            if (player.library.some(isPlaceholder)) {
                unreadable = true;
                return { match: 0, milled: 0 };
            }
            const n = player.library.length;
            if (n === 0) return { match: 0, milled: 0 };
            answered = true;
            const worths = libraryMatchWorths(
                state,
                player,
                filter,
                realisedLoss
            );
            const m = worths.length;
            if (m === 0) return { match: 0, milled: n };
            const mean = worths.reduce((a, b) => a + b, 0) / m;
            return { match: mean / denominator, milled: (n - m) / (m + 1) };
        },
    };
}

/** Issue #5627 — the realised worth of each card of `player`'s library
 *  matching `filter` (`undefined`: every card), read as it would stand once
 *  put onto `player`'s battlefield: untapped, unattached, under `player`'s
 *  control, matched on its characteristics there. */
function libraryMatchWorths(
    state: GameState,
    player: PlayerState,
    filter: PermanentFilter | undefined,
    realisedLoss: RealisedLoss
): number[] {
    const worths: number[] = [];
    for (const c of player.library) {
        const landed: CardInstanceState = {
            ...c,
            zone: "battlefield",
            controllerId: player.id,
            isTapped: false,
            attachedTo: undefined,
        };
        if (
            filter !== undefined &&
            !matchesPermanentFilter(
                effectivePermanentView(state, landed),
                filter,
                { supertypesOf: liveSupertypesOf }
            )
        ) {
            continue;
        }
        worths.push(realisedLoss(landed));
    }
    return worths;
}

/** Issue #5626 — the units of `mana` (`EachPlayerSide.manaUnits`) one card
 *  of `player`'s hand spends on top of its whole mana base: for each card
 *  the base cannot pay for alone, the fewest units of the extra that let it
 *  (any subset of them: one {G} of a {R}{G} pool is one unit); the largest
 *  such count over the hand.
 *
 *  An under-read, by design (the safe direction): one card at a time — two
 *  cards each castable alone but together only with the extra read 0; an
 *  {X} cost is read at X = 0; the base is every source the player controls,
 *  this turn's land drop not added and an untap lock not subtracted. */
function spendableExtraMana(
    state: GameState,
    player: PlayerState,
    valuedCardId: string,
    mana: EffectManaPool
): number {
    const base = boardCensusFor(state, player).base;
    const extra: ReadonlySet<Color>[] = [];
    for (const color of MANA_COLORS) {
        for (let i = 0; i < (mana[color] ?? 0); i++) {
            extra.push(new Set<Color>([color]));
        }
    }
    const life = { life: player.life };
    let spent = 0;
    for (const c of player.hand) {
        if (c.id === valuedCardId) continue;
        const cost = getInstanceManaCost(c);
        if (canPayCost(base, cost, life)) continue;
        let fewest = Infinity;
        for (let mask = 1; mask < 1 << extra.length; mask++) {
            const subset = extra.filter((_, i) => (mask >> i) & 1);
            if (
                subset.length < fewest &&
                canPayCost([...base, ...subset], cost, life)
            ) {
                fewest = subset.length;
            }
        }
        if (fewest !== Infinity) spent = Math.max(spent, fewest);
    }
    return spent;
}

/** Issue #5559 — `value` grounded on the board with `$each` bound to
 *  `player` (`EachPlayerSide.groundCount`), or `undefined` for a shape the
 *  board cannot answer exactly. Every step of a script is grounded against
 *  the board BEFORE resolution: a later step's count does not see what an
 *  earlier step removed (a land creature counted by both of Balance's
 *  battlefield steps) — an accepted valuation approximation. A `difference` may come out negative; the
 *  consuming count clamps it (CR 107.1b). */
function groundSideCount(
    state: GameState,
    player: PlayerState,
    valuedCardId: string,
    value: EffectValue,
    namesSide: (ref: EffectPlayerRef) => boolean
): number | undefined {
    if (typeof value === "number") return value;
    if ("count" in value) {
        return groundZoneCount(
            state,
            player,
            valuedCardId,
            value.count,
            namesSide
        );
    }
    if ("difference" in value) {
        const { from, minus } = value.difference;
        const a = groundSideCount(state, player, valuedCardId, from, namesSide);
        const b = groundSideCount(
            state,
            player,
            valuedCardId,
            minus,
            namesSide
        );
        return a === undefined || b === undefined ? undefined : a - b;
    }
    // Issue #5574 — CR 305.6: the basic land types among lands the side's
    // player controls (Collapsing Borders' "for each basic land type among
    // lands they control"), through the engine's one Domain scan.
    if ("domain" in value && namesSide(value.domain.of)) {
        return (
            countDomain(state as never, player.id) * (value.domain.times ?? 1)
        );
    }
    return undefined;
}

/** Issue #5559 — an `EffectCountSpec` over battlefield or hand members,
 *  scoped to `$each` (`player`), the fewest any player has
 *  (`smallestAcrossPlayers`) or every player's (`acrossAllPlayers`). */
function groundZoneCount(
    state: GameState,
    player: PlayerState,
    valuedCardId: string,
    spec: EffectCountSpec,
    namesSide: (ref: EffectPlayerRef) => boolean
): number | undefined {
    if (spec.picks !== undefined || spec.countTypes) return undefined;
    if (spec.zone !== "battlefield" && spec.zone !== "hand") return undefined;
    const filter = sweepPermanentFilter(spec.filter);
    if (filter === UNREADABLE_SWEEP_FILTER) return undefined;
    // A hand count with a filter reads card characteristics no reveal has
    // made public here: not a board fact.
    if (spec.zone === "hand" && filter !== undefined) return undefined;
    const sizeOf = (p: PlayerState): number => {
        if (spec.zone === "hand") {
            return p.hand.filter((c) => c.id !== valuedCardId).length;
        }
        if (filter === undefined) return p.battlefield.length;
        return p.battlefield.filter((perm) =>
            matchesPermanentFilter(
                effectivePermanentView(state, perm),
                filter,
                {
                    supertypesOf: liveSupertypesOf,
                }
            )
        ).length;
    };
    let size: number;
    if (spec.smallestAcrossPlayers) {
        size = Math.min(...state.players.map(sizeOf));
    } else if (spec.acrossAllPlayers) {
        size = state.players.reduce((n, p) => n + sizeOf(p), 0);
    } else if (spec.controller !== undefined && namesSide(spec.controller)) {
        size = sizeOf(player);
    } else {
        return undefined;
    }
    return size * (spec.times ?? 1);
}

/** Issue #5164 — the mean context-free worth of `library`'s cards (its
 *  order is hidden, its contents are not), `undefined` for an empty library
 *  or one holding a placeholder (a hidden zone the seat cannot read).
 *  Memoised per library array and weight vector: a search leaf reads the
 *  same libraries for every board face and hand card that asks. */
function libraryMean(
    library: readonly CardInstanceState[],
    weights: EvalWeights,
    worth: RealisedLoss
): number | undefined {
    const hit = LIBRARY_MEAN_MEMO.get(library);
    if (hit && hit.weights === weights) return hit.mean;
    let mean: number | undefined;
    if (library.length > 0 && !library.some(isPlaceholder)) {
        let total = 0;
        for (const c of library) total += worth(c);
        mean = total / library.length;
    }
    LIBRARY_MEAN_MEMO.set(library, { weights, mean });
    return mean;
}

const LIBRARY_MEAN_MEMO = new WeakMap<
    readonly CardInstanceState[],
    { weights: EvalWeights; mean: number | undefined }
>();

/** Issue #5164 — the board's mean library card: the unit a Differential
 *  Reading's draws are counted in, so a draw of an average card is one
 *  `cardAdvantage` unit and the side with the better library draws more.
 *  `undefined` when any library is unreadable; 0 when every one is empty. */
function boardLibraryMean(
    state: GameState,
    weights: EvalWeights,
    worth: RealisedLoss
): number | undefined {
    let total = 0;
    let readable = 0;
    for (const player of state.players) {
        if (player.library.length === 0) continue;
        const mean = libraryMean(player.library, weights, worth);
        if (mean === undefined) return undefined;
        total += mean;
        readable += 1;
    }
    return readable === 0 ? 0 : total / readable;
}

/** Issue #5164 — the context-free worth of each card of `hand` but the one
 *  being valued, or `undefined` when the hand holds a placeholder. */
function handValues(
    hand: readonly CardInstanceState[],
    valuedCardId: string,
    worth: RealisedLoss
): number[] | undefined {
    const values: number[] = [];
    for (const c of hand) {
        if (isPlaceholder(c)) return undefined;
        if (c.id !== valuedCardId) values.push(worth(c));
    }
    return values;
}

/** Issue #5573 — the hand a draw lands in once `before`'s steps have run
 *  over `hand`, each card a context-free worth. `library` (its size and its
 *  mean card) is updated in place: a draw takes from it, a shuffle-in adds
 *  the hand's cards to it. */
function handAfter(
    hand: readonly number[],
    library: { size: number; mean: number },
    before: readonly HandStep[]
): number[] {
    let current = [...hand];
    for (const step of before) {
        switch (step.kind) {
            case "leaves":
                current = [];
                break;
            case "shuffledIn": {
                const total =
                    library.mean * library.size +
                    current.reduce((a, b) => a + b, 0);
                library.size += current.length;
                library.mean = library.size > 0 ? total / library.size : 0;
                current = [];
                break;
            }
            case "discards":
                // The chooser keeps its best (`discardWorth`).
                current = [...current]
                    .sort((a, b) => a - b)
                    .slice(Math.max(0, step.count));
                break;
            case "draws": {
                const drawn = Math.min(step.count, library.size);
                for (let i = 0; i < drawn; i++) current.push(library.mean);
                library.size -= drawn;
                break;
            }
        }
    }
    return current;
}

function isPlaceholder(c: CardInstanceState): boolean {
    return String(c.card.id ?? "") === PLACEHOLDER_CARD_ID;
}

/** Issue #5164 — the summed worth of the `cap` best of `values`: what a
 *  hand of those cards holds after the cleanup discard (CR 514.1). */
function keptWorth(values: readonly number[], cap: number): number {
    if (values.length <= cap) return values.reduce((a, b) => a + b, 0);
    const best = [...values].sort((a, b) => b - a);
    let kept = 0;
    for (let i = 0; i < cap; i++) kept += best[i];
    return kept;
}

/** Issue #5579 — how many cards either side of the leaf's hand the hand
 *  that reaches cleanup may hold. */
const CLEANUP_HAND_SPREAD = 1;

/** Issue #5579 — what the cleanup discard (CR 514.1) lets `withDraws` keep
 *  over `landing`, read over the hands that can reach that cleanup rather
 *  than the leaf's hand alone. Between the leaf and the player's cleanup it
 *  draws for its turn (CR 504.1) and plays a main phase: on average the two
 *  cancel (the reading issue #5164 shipped), but either may outrun the
 *  other by a card. Read at the leaf's hand only, one card in or out of a
 *  hand at the maximum hand size swung the reading by a whole kept card;
 *  averaged over the leaf's hand ± `CLEANUP_HAND_SPREAD` cards, one card
 *  moves it by a share of one, and the cleanup rule's reading stands at the
 *  extremes (a near-empty hand keeps the card whole, a hand past the
 *  maximum keeps only what it beats). A card more or fewer is read as a
 *  maximum hand size one fewer or more — the cards spent or drawn are not
 *  priced individually, and a hand with no card to spend still reads the
 *  room one spent card would leave (a maximum of 0 keeps a third of a card).
 *  The spread is the standing engine's horizon; a one-shot body (`before`)
 *  takes it too, though its caster's cleanup is this turn's, with no draw
 *  ahead of it — an approximation that cancels between sides of one shape. */
function cleanupKeptGain(
    landing: readonly number[],
    withDraws: readonly number[],
    cap: number
): number {
    let gain = 0;
    for (let k = -CLEANUP_HAND_SPREAD; k <= CLEANUP_HAND_SPREAD; k++) {
        const room = Math.max(0, cap - k);
        gain += keptWorth(withDraws, room) - keptWorth(landing, room);
    }
    return gain / (2 * CLEANUP_HAND_SPREAD + 1);
}

/** Issue #4773 — the realised loss a `forEach` over the battlefield takes
 *  from the caster's opponents MINUS what it takes from the caster, or
 *  `undefined` when the selector is not one this lens can read.
 *
 *  Until this read, a sweep's `$each` was no announced slot, so it priced at
 *  ONE representative victim whatever the board held: Armageddon sat in hand
 *  at a 2/2's worth while the lands it would take were worth far less, and
 *  casting it with the opponent a land ahead read as a loss at 1 ply. The
 *  members are the ones the resolution would take, the caster's own included
 *  (CR 701.8a destroy, CR 701.13a exile), priced by the same
 *  `realisedLoss` the targeted slots read.
 *
 *  Readable means: every player's battlefield or a fixed side of it
 *  (`controller` / `opponent`), and a filter this lens can match EXACTLY
 *  (`sweepPermanentFilter`). Any other filter field (a subtype chosen
 *  mid-resolution, a mana-value bound) answers `undefined` rather than
 *  guess: a matcher that skipped the field would count members the
 *  resolution spares, and one that refused them would price a real sweep at
 *  nothing.
 *
 *  Issue #4781 — each member's outcome is `lossOf` it, per the sweep's
 *  `SweepOutcome` (`memberLoss`): what it takes is its controller's loss,
 *  what it hands back its owner's gain.
 *
 *  Issue #4874 — plus, per player, what the member set moves in the
 *  per-player aggregate terms (`aggregateLoss`). Summed per permanent alone,
 *  the hand price of Armageddon over a board of mana rocks exceeded what the
 *  resolution realised: the caster's `manaDevelopment` fell to zero with its
 *  lands and nothing in the price said so, so holding the card beat casting
 *  it at every leaf and the Bot never cast it. The hand worth of a sweep must
 *  not exceed what resolving it moves the margin by. */
function sweptNetLoss(
    state: GameState,
    casterId: string,
    select: EffectForEachSelector,
    lossOf: MemberLoss,
    aggregateLoss: AggregateLoss,
    weights: EvalWeights
): number | undefined {
    if (select.set !== "permanents") return undefined;
    const filter = sweepPermanentFilter(select.filter);
    if (filter === UNREADABLE_SWEEP_FILTER) return undefined;
    const controller = select.controller;
    if (
        controller !== undefined &&
        controller !== "controller" &&
        controller !== "opponent"
    ) {
        return undefined;
    }
    // Issue #4880 — two ledgers: what the opponent can RECOVER from
    // (`recoverable`) and what is gone for good (`fixed`), each with the
    // member ids leaving and the cards handed back, so the aggregate terms
    // split the same way.
    const fixed = new SweepLedger();
    const recoverable = new SweepLedger();
    for (const player of state.players) {
        const own = player.id === casterId;
        if (controller === "controller" && !own) continue;
        if (controller === "opponent" && own) continue;
        for (const perm of player.battlefield) {
            // The same live view the resolution's `getBattlefieldIds` matches
            // against (layer-5 colours, layer-7 toughness, live supertypes).
            const view = effectivePermanentView(state, perm);
            if (
                filter !== undefined &&
                !matchesPermanentFilter(view, filter, {
                    supertypesOf: liveSupertypesOf,
                })
            ) {
                continue;
            }
            const outcome = lossOf(perm, view);
            const ledger = outcome.recoverable ? recoverable : fixed;
            ledger.net += own ? -outcome.taken : outcome.taken;
            ledger.net +=
                perm.ownerId === casterId
                    ? outcome.handedBack
                    : -outcome.handedBack;
            if (!outcome.leaves) continue;
            ledger.leave(player.id, perm.id);
            // CR 111.7 — a token hands nothing back; any other card lands in
            // its OWNER's hand (CR 400.3).
            if (outcome.handedBack > 0) {
                ledger.handBack(perm.ownerId, asReturnedToHand(perm));
            }
        }
    }
    // A ledger no member leaves changes no zone, so it moves no aggregate:
    // skip the census rather than read two identical boards.
    const aggregateOf = (ledgers: readonly SweepLedger[]): number =>
        ledgers.some((l) => l.leavers > 0)
            ? aggregateLoss(zoneChanges(state, ledgers))
            : 0;
    const aggregateAll = aggregateOf([fixed, recoverable]);
    const fraction = weights.recoverableSweepFraction;
    // A recoverable member always leaves (`MemberOutcome.recoverable`).
    if (recoverable.leavers === 0 || fraction === 1) {
        return fixed.net + recoverable.net + aggregateAll;
    }
    // The aggregate the FIXED members move alone; the rest of `aggregateAll`
    // is what the recoverable members move, and it regrows with them. The
    // aggregate terms are not additive per member (`min(lands, curveTop)`),
    // so the order is a choice: the fixed members are read first and the
    // INTERACTION goes to the recoverable side — a sweep taking Llanowar
    // Elves and Forests discounts the part of the Elves' curve demand that
    // only the missing lands made unreachable.
    const aggregateFixed = aggregateOf([fixed]);
    return (
        fixed.net +
        aggregateFixed +
        fraction * (recoverable.net + aggregateAll - aggregateFixed)
    );
}

/** Issue #4880 — one side of a sweep's member set: its net realised loss
 *  (the caster's opponents' minus the caster's), and the zone changes it
 *  makes per player. */
class SweepLedger {
    net = 0;
    readonly leaving = new Map<string, Set<string>>();
    readonly returned = new Map<string, CardInstanceState[]>();
    /** How many members leave the battlefield. */
    leavers = 0;
    leave(playerId: string, permId: string): void {
        const gone = this.leaving.get(playerId) ?? new Set<string>();
        gone.add(permId);
        this.leaving.set(playerId, gone);
        this.leavers++;
    }
    handBack(ownerId: string, card: CardInstanceState): void {
        const back = this.returned.get(ownerId) ?? [];
        back.push(card);
        this.returned.set(ownerId, back);
    }
}

/** The per-player `SweepZoneChange`s of `ledgers` together. */
function zoneChanges(
    state: GameState,
    ledgers: readonly SweepLedger[]
): Map<string, SweepZoneChange> {
    const changes = new Map<string, SweepZoneChange>();
    for (const player of state.players) {
        const leaving = new Set<string>();
        const returned: CardInstanceState[] = [];
        for (const ledger of ledgers) {
            for (const id of ledger.leaving.get(player.id) ?? []) {
                leaving.add(id);
            }
            returned.push(...(ledger.returned.get(player.id) ?? []));
        }
        changes.set(player.id, { leaving, returned });
    }
    return changes;
}

const LEAVES: SweepOutcome = { kind: "leaves" };

/** Issue #4781 — `perm` as the card a bounce hands back: a NEW object in
 *  its owner's hand (CR 400.7), so its type line and abilities go back to
 *  their bases and every field the Card Field Lifecycle table resets on a
 *  zone change (counters, damage, choices, ledgers) goes with the old object.
 *  Priced with `cardValue`, it is what the hand term will read once the
 *  bounce has resolved. Never written back: a copy. */
export function asReturnedToHand(perm: CardInstanceState): CardInstanceState {
    const card: CardInstanceState = {
        ...perm,
        zone: "hand",
        isTapped: false,
        types: [...(perm.baseTypes ?? perm.types)],
        subtypes: [...(perm.baseSubtypes ?? perm.subtypes)],
        staticAbilities: [
            ...(perm.baseStaticAbilities ?? perm.staticAbilities),
        ],
    };
    clearCardFieldsAt(card, "zone-change");
    return card;
}

/** What a sweep does to one member: `taken` is lost by its CONTROLLER,
 *  `handedBack` is gained by its OWNER (a bounce returns the card to its
 *  owner's hand, CR 400.3 — not to whoever controlled it). */
interface MemberOutcome {
    taken: number;
    handedBack: number;
    /** Issue #4874 — the member goes off the battlefield. */
    leaves: boolean;
    /** Issue #4880 — what the member takes can be won back by its owner in
     *  the ordinary course of the game: a land is replaced by the next land
     *  drop (CR 305.2), a card returned to hand is recast. */
    recoverable: boolean;
}

/** One member's outcome, given the raw permanent and its
 *  `effectivePermanentView`. */
type MemberLoss = (
    perm: CardInstanceState,
    view: CardInstanceState
) => MemberOutcome;

/** Issue #4781 — the per-member outcome each `SweepOutcome` inflicts:
 *   - `leaves`: the whole realised loss (CR 701.8a / 701.13a);
 *   - `lethalDamage`: the realised loss of a member the damage kills
 *     (`diesTo`), nothing for a survivor;
 *   - `returnsToHand`: the realised loss, and the card's worth back in its
 *     owner's hand handed back — so what a bounce takes is the difference. A
 *     token hands nothing back (CR 111.7: it ceases to exist off the
 *     battlefield). Pricing a bounce at the whole realised loss would read
 *     every returned body as destroyed, while `evaluate` counts it again in
 *     the owner's hand: the cast would realise a fraction of what holding the
 *     card was worth. */
function memberLoss(
    outcome: SweepOutcome,
    realisedLoss: RealisedLoss,
    returnedWorth: RealisedLoss
): MemberLoss {
    switch (outcome.kind) {
        case "leaves":
            return (perm, view) => ({
                taken: realisedLoss(perm),
                handedBack: 0,
                leaves: true,
                recoverable: isLand(view),
            });
        case "lethalDamage":
            return (perm, view) => {
                const dies = diesTo(view, outcome.amount);
                return {
                    taken: dies ? realisedLoss(perm) : 0,
                    handedBack: 0,
                    leaves: dies,
                    recoverable: dies && isLand(view),
                };
            };
        case "returnsToHand":
            return (perm) => ({
                taken: realisedLoss(perm),
                handedBack: perm.isToken ? 0 : returnedWorth(perm),
                leaves: true,
                // CR 111.7 — a token ceases to exist: nothing to recast.
                recoverable: !perm.isToken,
            });
    }
}

/** True when `damage` dealt to `view` (an `effectivePermanentView`) takes it
 *  off the battlefield by state-based action: CR 704.5g for a creature (the
 *  damage already marked counts, CR 120.3e), CR 704.5i for a planeswalker
 *  (CR 120.3c). Any other permanent is not removed by damage. */
function diesTo(view: CardInstanceState, damage: number): boolean {
    if (damage <= 0) return false;
    if (view.types.includes("Creature")) {
        const toughness = view.toughness ?? 0;
        return toughness - (view.damageMarked ?? 0) <= damage;
    }
    if (view.types.includes("Planeswalker")) {
        return currentLoyalty(view) <= damage;
    }
    return false;
}

/** The answer `sweepPermanentFilter` gives for a filter it cannot match
 *  exactly — distinct from `undefined`, which is "no filter, every
 *  permanent". */
export const UNREADABLE_SWEEP_FILTER = "unreadable-sweep-filter" as const;

/** The `EffectCardFilter` fields `sweepPermanentFilter` maps onto
 *  `PermanentFilter` 1:1, each a LITERAL the resolution's
 *  `toPermanentFilter` (`effects/interpreter.ts`) propagates unchanged and
 *  `effectivePermanentView` supplies every input of. A field outside this
 *  set — a dynamic `{ ref }`, a mana-value bound, a name read off the
 *  registry, `any`, `excludeSource` — makes the whole filter unreadable. */
const READABLE_SWEEP_FILTER_KEYS: ReadonlySet<string> = new Set([
    "type",
    "excludeType",
    "subtype",
    "supertype",
    "excludeSupertype",
    "color",
    "colorCountAtLeast",
    "isToken",
    "hasAbility",
    "excludeAbility",
    "tapped",
    "isAttacking",
    "enteredThisTurn",
    "controlledSinceTurnStart",
]);

/** Issue #4781 — the `PermanentFilter` a sweep's `EffectCardFilter` resolves
 *  to before a single resolution-time choice is made, or
 *  `UNREADABLE_SWEEP_FILTER` when it names anything that is not a literal
 *  this lens can match exactly: subtypes (CR 205.3), colours (CR 105.2) and
 *  supertypes (CR 205.4a) alongside the card types (CR 205.2a) the #4773 read
 *  began with. A subtype or colour given as a `{ ref }` / sacrificed-colours
 *  read is chosen at resolution and stays unreadable. */
export function sweepPermanentFilter(
    filter: EffectCardFilter | undefined
): PermanentFilter | undefined | typeof UNREADABLE_SWEEP_FILTER {
    if (filter === undefined) return undefined;
    if (!Object.keys(filter).every((k) => READABLE_SWEEP_FILTER_KEYS.has(k))) {
        return UNREADABLE_SWEEP_FILTER;
    }
    const { subtype, color } = filter;
    if (subtype !== undefined && !isLiteralList(subtype)) {
        return UNREADABLE_SWEEP_FILTER;
    }
    if (color !== undefined && !isLiteralList(color)) {
        return UNREADABLE_SWEEP_FILTER;
    }
    return {
        types: filter.type,
        excludeTypes: filter.excludeType,
        subtypes: subtype,
        supertypes: filter.supertype,
        excludeSupertypes: filter.excludeSupertype,
        colors: color,
        colorCountAtLeast: filter.colorCountAtLeast,
        isToken: filter.isToken,
        requireAbility: filter.hasAbility,
        excludeAbility: filter.excludeAbility,
        tapped: filter.tapped,
        isAttacking: filter.isAttacking,
        enteredThisTurn: filter.enteredThisTurn,
        controlledSinceTurnStart: filter.controlledSinceTurnStart,
    };
}

/** A string literal or a list of them — never a dynamic object read. */
function isLiteralList<T extends string>(
    value: T | readonly T[] | object
): value is T | T[] {
    return (
        typeof value === "string" ||
        (Array.isArray(value) && value.every((v) => typeof v === "string"))
    );
}

/** True when `requirement` could ever name a battlefield permanent — a
 *  structural read of its declared `type`, never of the board. Distinguishes
 *  "this spell removes permanents and the board is empty" (0 units) from
 *  "this spell was never about permanents" (unknown, keep the representative
 *  fallback). */
function admitsPermanents(requirement: TargetRequirement): boolean {
    if (requirement.zone && requirement.zone !== "battlefield") return false;
    const types = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];
    return types.some((t) => t !== "player" && t !== "spell" && t !== "card");
}
