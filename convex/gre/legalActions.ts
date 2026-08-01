// legalActions(state) — legal-move enumeration derived from the Expected
// Input contract (ADR 0047, issue #801, PRD #795).
//
// The Expected Input gate (`assertExpectedInput`, #799) answers "is this the
// right moment, from the right player, for this kind of input?" for every game
// mutation. This module is the gate's enumeration dual: instead of validating
// a submitted action, it YIELDS the concrete action set the acting player may
// legally submit right now — submittable choices, selectable targets,
// declarable blockers, castable/activatable options under priority.
//
// Move generation reads the SAME contract the gate enforces: the entry point
// switches (compiler-enforced exhaustively) on `computeExpectedInput(state)` —
// the single decision site the gate itself uses — never re-deriving the
// waiting state from scattered pending* fields. Parity is proven by tests in
// `__tests__/legalActions.test.ts`: every enumerated action passes the gate,
// and every gate-accepted (kind × player) class has at least one enumerated
// action.
//
// PURE: no mutation, no ctx, no randomness — callable from the server and
// from the client-side bot code path (exported through the sanctioned
// `convex/gre/index.ts` barrel, ADR 0001). Combinatorial windows are capped at
// `MAX_COMBINATIONS`, same policy as `moves.ts`.

import type { TargetRequirement, TargetSelection } from "../cards/types";
import type {
    CardInstanceState,
    ExpectedInput,
    GameState,
    PendingChoice,
    PendingTarget,
    PendingTargetFilterKey,
} from "./state";
import {
    canPayMayPayCost,
    getPendingChoiceMax,
    getPendingChoiceMin,
    getPlayer,
    matchesPermanentFilter,
    PENDING_TARGET_FILTER_KEYS,
} from "./state";
import { computeExpectedInput, type GateRequest } from "./expectedInput";
import {
    sacrificeCandidates,
    nextUnmetRequirement,
    isSacrificeCandidateLegal,
} from "./sacrificeChoice";
import {
    getLegalTargets,
    getPendingTargetSourceColors,
    getPendingTargetSourceSubtypes,
    getPendingTargetSourceTypes,
} from "./rules";
import {
    combinations,
    enumerateMoves,
    enumerateBlockerMoves,
    MAX_COMBINATIONS,
    type Move,
} from "./moves";
import { computeHardSkipFilters, effectivePermanentView } from "./phases";

// ---------------------------------------------------------------------------
// Action vocabulary
// ---------------------------------------------------------------------------

/** The subset of bot macro-moves that belong to a `priority` Expected Input
 *  window (CR 117). The remaining `Move` kinds (choice submissions,
 *  declare-blockers) belong to the `choice` / `blockers` variants and are
 *  represented by their own action types below. */
export type PriorityMove = Extract<
    Move,
    {
        kind:
            | "pass"
            | "mulligan"
            | "play-land"
            | "summon-companion"
            | "cast-spell"
            | "activate-ability"
            | "declare-attackers";
    }
>;

/** Actions legal while the game waits for `priority` input (CR 117). Besides
 *  the macro-moves, an in-progress payment (pendingCast / pendingActivation —
 *  the payer holds priority, CR 601.2g / 602.2b) offers its abort
 *  continuation, and an open combat-damage assignment sub-flow (CR 510.1)
 *  offers its confirmation. */
export type PriorityAction =
    | PriorityMove
    /** Abort an in-progress spell payment; taps roll back (CR 601.2g —
     *  reversing an announced cast before it is committed). */
    | { kind: "cancel-cast" }
    /** Abort an in-progress ability activation payment (CR 602.2b). */
    | { kind: "cancel-activation" }
    /** Confirm this player's combat damage assignment (CR 510.1c). Folded
     *  into a priority window but owned by the damage-assigner sub-flow, so
     *  its gate request carries `anyPlayer` (see `gateRequestFor`). */
    | { kind: "confirm-damage" };

/** Actions legal while the game waits for the head PendingChoice (CR 608.2 /
 *  101.4). Each maps 1:1 onto its submission mutation. */
export type ChoiceAction =
    /** Zone-pick / order / option / damage-target submission
     *  (`submitResolutionChoice`). `cardInstanceIds` is a complete, valid
     *  payload: ids from the eligible pool, count within [min, max]. */
    | {
          kind: "submit-choice";
          stackItemId: string;
          step: number;
          choiceId: string;
          cardInstanceIds: string[];
      }
    /** Yes/no answer to a `may-pay` choice (`submitMayPay`, CR 117.3a /
     *  118.4). `accept: true` is enumerated only when the cost is payable. */
    | { kind: "submit-may-pay"; accept: boolean }
    /** Yes/no answer to a `land-entry-tapped` shock-land choice
     *  (`submitLandEntryChoice`, CR 614.12, ADR 0051). `accept: true` (pay to
     *  enter untapped) is enumerated only when the cost is payable. */
    | { kind: "submit-land-entry"; accept: boolean }
    /** Name a card (`submitNameCard`, CR 201.2 / 202.3). The payload domain is
     *  the entire card registry, so it is carried OPEN — one action stands for
     *  the whole family and the caller supplies the name. */
    | { kind: "submit-name-card" }
    /** Acknowledge a suspended random reveal (`submitRandomRevealAck`,
     *  CR 705.2, ADR 0023) — a no-decision resume. */
    | {
          kind: "submit-random-reveal-ack";
          stackItemId: string;
          choiceId: string;
      }
    /** Decline a reflexive `madness-cast` choice (`submitMadnessDecline`,
     *  CR 702.35d) — the card goes to the graveyard. The ACCEPT ("Cast") is a
     *  normal cast action on the exiled card, not a choice action. */
    | { kind: "submit-madness-decline" }
    /** Decline a reflexive `rebound-cast` choice (`submitReboundDecline`, CR
     *  702.88c) — the card remains exiled (no zone change, unlike Madness's
     *  decline). The ACCEPT ("Cast") is a normal cast action on the exiled
     *  card, not a choice action. */
    | { kind: "submit-rebound-decline" };

/** Actions legal while the game waits for `target` input — mid-cast /
 *  mid-activation target selection (CR 601.2c / 602.2b). */
export type TargetAction =
    /** Pick one more legal target (`selectTarget`). For divide-as-you-choose
     *  spells (CR 601.2d) the minimal legal `amount` (1) is carried. */
    | { kind: "select-target"; target: TargetSelection; amount?: number }
    /** Finalize a variable-count selection once ≥ min targets are chosen
     *  (`confirmTargets`, CR 601.2c). */
    | { kind: "confirm-targets" }
    /** Abort target selection (`cancelTarget`) — legal at any point of the
     *  selection (CR 601.2g; for retarget kinds it declines the retarget,
     *  CR 707.10b / 114.6). */
    | { kind: "cancel-target" };

/** Actions legal while the game waits for `blockers` input (CR 509.1): one
 *  complete blocker assignment per action (macro-level, like the bot's
 *  declare-blockers Move — realised through selectBlocker /
 *  assignBlockerTarget / confirmBlockers). */
export type BlockersAction = {
    kind: "declare-blockers";
    assignments: { blockerId: string; attackerId: string }[];
};

/** Actions legal while the game waits for `sacrifice` input — the parked
 *  attack-declaration land tax (CR 508.1c/1g / 701.21a, Flooded Woodlands).
 *  One action per legal land the attacking player may sacrifice next; realised
 *  through `selectSacrifice`. */
export type SacrificeAction = {
    kind: "select-sacrifice";
    cardInstanceId: string;
};

/** Actions legal while the game waits for `attack-mana-tax` input — the parked
 *  per-attacker MANA attack tax (CR 508.1c/1g, Propaganda / Collective
 *  Restraint). The attacking player either pays (auto-tap or a manual land tap,
 *  realised through `autoTapForAttackTax` / `tapForAttackTax`) or cancels the
 *  whole declaration (`cancelAttackTax`). */
export type AttackManaTaxAction =
    | { kind: "auto-tap-attack-tax" }
    | { kind: "tap-attack-tax"; cardInstanceId: string }
    | { kind: "cancel-attack-tax" };

/** One legal action at the current decision point, tagged with the Expected
 *  Input variant (`expect`) and acting player (`playerId`) it belongs to — the
 *  exact class the gate (`assertExpectedInput`) authorizes. Build the gate
 *  request for an action with {@link gateRequestFor}. */
export type LegalAction =
    | { expect: "priority"; playerId: string; action: PriorityAction }
    | { expect: "choice"; playerId: string; action: ChoiceAction }
    | { expect: "target"; playerId: string; action: TargetAction }
    | { expect: "blockers"; playerId: string; action: BlockersAction }
    | { expect: "sacrifice"; playerId: string; action: SacrificeAction }
    | {
          expect: "attack-mana-tax";
          playerId: string;
          action: AttackManaTaxAction;
      };

/** The {@link GateRequest} the action's mutation would submit to the Expected
 *  Input gate. Combat-damage confirmation folds into a priority window whose
 *  acting player is owned by the sub-flow, not by `priorityPlayerId` — its
 *  mutations pass `anyPlayer` (CR 510.1c, see `confirmDamage` in game.ts). */
export function gateRequestFor(action: LegalAction): GateRequest {
    if (
        action.expect === "priority" &&
        action.action.kind === "confirm-damage"
    ) {
        return {
            playerId: action.playerId,
            expect: "priority",
            anyPlayer: true,
        };
    }
    return { playerId: action.playerId, expect: action.expect };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** The complete set of legal actions at the current decision point, derived
 *  from the Expected Input contract (ADR 0047). Reads the SAME single decision
 *  site as the gate (`computeExpectedInput`) and dispatches on the variant —
 *  exhaustively, compiler-enforced via the `never` check. Empty only when the
 *  game is over (CR 104.2a — a finished game accepts no further actions).
 *  Pure. */
export function legalActions(state: GameState): LegalAction[] {
    const expected = computeExpectedInput(state);
    // CR 104.2a — a finished game waits for no input.
    if (expected === undefined) return [];
    switch (expected.kind) {
        case "choice":
            return choiceActions(state, expected);
        case "target":
            return targetActions(state, expected);
        case "blockers":
            return blockersActions(state, expected);
        case "sacrifice":
            return sacrificeActions(state, expected);
        case "attack-mana-tax":
            return attackManaTaxActions(state, expected);
        case "priority":
            return priorityActions(state, expected);
        default: {
            // Compiler-enforced exhaustiveness over ExpectedInput variants:
            // adding a variant without a branch here fails to compile.
            const exhaustive: never = expected;
            return exhaustive;
        }
    }
}

// ---------------------------------------------------------------------------
// choice variant (CR 608.2 / 101.4)
// ---------------------------------------------------------------------------

function choiceActions(
    state: GameState,
    expected: Extract<ExpectedInput, { kind: "choice" }>
): LegalAction[] {
    const head = state.pendingChoices![0];
    const playerId = expected.playerId;
    const wrap = (action: ChoiceAction): LegalAction => ({
        expect: "choice",
        playerId,
        action,
    });

    // CR 117.3a / 118.4 — yes/no may-pay: declining is always legal; accepting
    // only when every leg of the cost (mana / life / sacrifice) is payable.
    if (head.kind === "may-pay") {
        const actions: LegalAction[] = [
            wrap({ kind: "submit-may-pay", accept: false }),
        ];
        if (
            !head.cost ||
            canPayMayPayCost(state, playerId, head.cost, head.manaRestriction)
        ) {
            actions.unshift(wrap({ kind: "submit-may-pay", accept: true }));
        }
        return actions;
    }

    // CR 614.12 / ADR 0051 — land-entry pay-choice (shock land): declining
    // (enter tapped) is always legal; paying only when the cost is affordable.
    if (head.kind === "land-entry-tapped") {
        const actions: LegalAction[] = [
            wrap({ kind: "submit-land-entry", accept: false }),
        ];
        if (!head.cost || canPayMayPayCost(state, playerId, head.cost)) {
            actions.unshift(wrap({ kind: "submit-land-entry", accept: true }));
        }
        return actions;
    }

    // CR 201.2 / 202.3 — name a card: the domain is the whole registry, so a
    // single open-payload action represents the family.
    if (head.kind === "name-card") {
        return [wrap({ kind: "submit-name-card" })];
    }

    // CR 705.2 (ADR 0023) — random reveal: a no-decision acknowledgement.
    if (head.kind === "random-reveal") {
        return [
            wrap({
                kind: "submit-random-reveal-ack",
                stackItemId: head.stackItemId,
                choiceId: head.choiceId,
            }),
        ];
    }

    // CR 702.35d — reflexive Madness cast-choice: the only choice-action is to
    // DECLINE (→ graveyard). The ACCEPT ("Cast") is a normal cast of the exiled
    // card, enumerated as a priority-window `cast-spell` move, not here.
    if (head.kind === "madness-cast") {
        return [wrap({ kind: "submit-madness-decline" })];
    }

    // CR 702.88a — reflexive Rebound cast-choice: the only choice-action is to
    // DECLINE (the card remains exiled). The ACCEPT ("Cast") is a normal cast
    // of the exiled card, enumerated as a priority-window `cast-spell` move,
    // not here. Mirrors `madness-cast` above.
    if (head.kind === "rebound-cast") {
        return [wrap({ kind: "submit-rebound-decline" })];
    }

    const submit = (cardInstanceIds: string[]): LegalAction =>
        wrap({
            kind: "submit-choice",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds,
        });

    // CR 614.12 — abstract option pick: exactly one of the author-supplied
    // option ids.
    if (head.kind === "option-pick") {
        return (head.options ?? []).map((o) => submit([o.id]));
    }

    // ADR 0053 (pile division) — pick a pile: exactly one of "A" / "B". Both
    // are always legal regardless of pile contents (an empty pile is a legal
    // choice — CR doesn't forbid choosing an empty pile).
    if (head.kind === "pick-pile") {
        return (["A", "B"] as const).map((id) => submit([id]));
    }

    // CR 603.3b (ADR 0058) — trigger-order: a single canonical ordering (the
    // slice in collection order). Any permutation is legal for the human path,
    // but self-ordering own triggers is tactically immaterial, so the move space
    // stays flat — one action, not N! — to preserve ISMCTS budget (ADR 0058).
    if (head.kind === "trigger-order") {
        return [submit(head.candidateIds ?? [])];
    }

    // CR 115.4 — "any target" damage-target pick: one of the damageable
    // permanents (`candidateIds`) or players (`candidatePlayerIds`).
    if (head.kind === "choose-damage-target") {
        return [
            ...(head.candidateIds ?? []),
            ...(head.candidatePlayerIds ?? []),
        ].map((id) => submit([id]));
    }

    // Zone-pick family + mulligan-bottom (CR 608.2 / 103.5): every valid
    // submission is a duplicate-free subset of the eligible pool with size in
    // [min, max] — mirroring `applyPendingChoiceSubmit`'s validation. Capped
    // at MAX_COMBINATIONS like every combinatorial window in moves.ts.
    const ids = eligibleZonePickIds(state, head);
    const min = Math.max(0, getPendingChoiceMin(head.count));
    const max = Math.min(getPendingChoiceMax(head.count), ids.length);
    const actions: LegalAction[] = [];
    for (let size = min; size <= max; size++) {
        for (const combo of combinations(ids, size)) {
            actions.push(submit(combo));
            if (actions.length >= MAX_COMBINATIONS) return actions;
        }
    }
    return actions;
}

/** The instance ids the chooser may legally include in a zone-pick submission
 *  — the enumeration mirror of `applyPendingChoiceSubmit`'s per-id validation:
 *  zone membership (of `zoneOwnerId ?? playerId`, or every battlefield for
 *  `allControllers` — CR 707), the `filter` (against the effective permanent
 *  view, CR 202.2), the `candidateIds` allow-list, and the `untap-pick` extra
 *  constraints (CR 502.1: tapped, not "does-not-untap", not vetoed by a
 *  hard-skip filter like Winter Orb's). */
function eligibleZonePickIds(state: GameState, head: PendingChoice): string[] {
    const zoneOwner = getPlayer(state, head.zoneOwnerId ?? head.playerId);
    let pool: CardInstanceState[];
    switch (head.zone) {
        case "battlefield":
            pool = head.allControllers
                ? state.players.flatMap((p) => p.battlefield)
                : zoneOwner.battlefield;
            break;
        case "hand":
            pool = zoneOwner.hand;
            break;
        case "library":
            pool = zoneOwner.library;
            break;
        case "graveyard":
            pool = zoneOwner.graveyard;
            break;
        default:
            pool = [];
    }
    let cards = pool;
    if (head.zone === "battlefield" && head.filter) {
        cards = cards.filter((c) =>
            matchesPermanentFilter(
                effectivePermanentView(state, c),
                head.filter!
            )
        );
    }
    if (head.candidateIds) {
        cards = cards.filter((c) => head.candidateIds!.includes(c.id));
    }
    if (head.kind === "untap-pick") {
        // CR 502.1 — only tapped permanents that are allowed to untap.
        const vetoFilters = computeHardSkipFilters(state);
        cards = cards.filter(
            (c) =>
                c.isTapped &&
                !c.staticAbilities.includes("does-not-untap") &&
                !vetoFilters.some((f) =>
                    matchesPermanentFilter(effectivePermanentView(state, c), f)
                )
        );
    }
    return cards.map((c) => c.id);
}

// ---------------------------------------------------------------------------
// target variant (CR 601.2c / 602.2b)
// ---------------------------------------------------------------------------

/** Mirrors game.ts `minTargetCount` for the PendingTarget count shape. */
function minTargetCount(count: PendingTarget["count"]): number {
    return typeof count === "number" ? count : count.min;
}

/** Upper bound on targets; `max` is open-ended (Infinity) when a range omits
 *  it (CR 601.2c — capped only by legal target availability). */
function maxTargetCount(count: PendingTarget["count"]): number {
    return typeof count === "number" ? count : (count.max ?? Infinity);
}

/** Rebuilds the TargetRequirement the server validates against from the
 *  PendingTarget snapshot (the fields `announceCast` / `activateAbility`
 *  flattened onto it at announcement — the exact surface `selectTarget`
 *  enforces). Working from the snapshot rather than the card definition keeps
 *  this correct for modal spells, dynamic `getTargetRequirement` abilities,
 *  and copy-retargets alike, and X-dependent values (`mvFilter`) arrive
 *  already resolved.
 *
 *  The filter half is copied through `PENDING_TARGET_FILTER_KEYS` (`state.ts`)
 *  rather than a hand-written field list. The hand-written list was fail-OPEN
 *  and had already drifted by TWELVE keys (issue #1956): every dropped filter
 *  makes this enumerator offer a `select-target` action that
 *  `applyOneTargetSelection` then rejects — proven with a Lightning Bolt
 *  targeting a PLAYER on the stack, where `getLegalTargets` returned `[]` for
 *  Confound while `legalActions` still yielded the action. `moves.ts` never
 *  had the bug (it enumerates from the card's real requirement); this module
 *  is the third co-authority `targetFilters.ts` names, so it gets the same
 *  compile-forced key set as the clear list and the retarget producers.
 *
 *  Only the STRUCTURAL fields stay hand-written — `type` / `count` / `zone`
 *  are `StructuralKey`s (not registry filters) and are renamed on the
 *  `PendingTarget` (`targetType`), so they can't ride the generic copy. */
function requirementFromPendingTarget(pt: PendingTarget): TargetRequirement {
    const out: Record<string, unknown> = {
        type: pt.targetType,
        count: pt.count,
        ...(pt.zone ? { zone: pt.zone } : {}),
    };
    for (const key of Object.keys(
        PENDING_TARGET_FILTER_KEYS
    ) as PendingTargetFilterKey[]) {
        const value = pt[key];
        if (value !== undefined) out[key] = value;
    }
    // The `PendingTarget` field IS the lowered `TargetRequirement` value for
    // each key by construction (`pendingTargetFiltersFromRequirement` writes
    // `lower()`'s own output), so the deliberately WIDENED `PendingTarget`
    // declarations (`colorFilter?: string` where the requirement says `Color`)
    // carry across unchanged — one cast here instead of a per-key one, which
    // is what let the old hand-written list drift in the first place.
    return out as unknown as TargetRequirement;
}

function targetActions(
    state: GameState,
    expected: Extract<ExpectedInput, { kind: "target" }>
): LegalAction[] {
    const pt = state.pendingTarget!;
    const playerId = expected.playerId;
    const wrap = (action: TargetAction): LegalAction => ({
        expect: "target",
        playerId,
        action,
    });
    const actions: LegalAction[] = [];

    // CR 601.2d — divide-as-you-choose: a further target is selectable only
    // while at least 1 point of the budget remains unassigned.
    const spentBudget = pt.divideAmounts
        ? Object.values(pt.divideAmounts).reduce((a, b) => a + b, 0)
        : 0;
    const budgetOpen =
        pt.divideTotal === undefined || pt.divideTotal - spentBudget >= 1;

    if (pt.selected.length < maxTargetCount(pt.count) && budgetOpen) {
        const kind = pt.kind ?? "cast";
        const legal = getLegalTargets(
            state,
            requirementFromPendingTarget(pt),
            // CR 702.16b / 611 — protection and cantBeTargeted guards read the
            // source's live colors / types / subtypes, same helpers
            // `selectTarget` uses.
            getPendingTargetSourceColors(state, pt.cardInstanceId, kind),
            playerId,
            pt.chosenX,
            getPendingTargetSourceTypes(state, pt.cardInstanceId, kind),
            getPendingTargetSourceSubtypes(state, pt.cardInstanceId, kind),
            // CR 113.3 — an activated ability is not a spell; casts and
            // copy/retargets are.
            kind !== "ability",
            // CR 601.2c — `getLegalTargets` itself now excludes objects
            // already chosen under this same requirement
            // (`isAlreadySelectedTarget`, `targetFilters.ts`) — the single
            // authority the human path (`selectTarget`, `game.ts`) also
            // calls, so this enumerator no longer needs its own copy of the
            // check.
            pt.selected
        );
        for (const target of legal) {
            actions.push(
                wrap({
                    kind: "select-target",
                    target,
                    // CR 601.2d — the minimal legal division assigns 1.
                    ...(pt.divideTotal !== undefined ? { amount: 1 } : {}),
                })
            );
            if (actions.length >= MAX_COMBINATIONS) break;
        }
    }

    // CR 601.2c — a variable-count selection finalizes via confirmTargets once
    // at least `min` targets are chosen (fixed-N auto-finalizes on the last
    // pick and never rests here with count reached).
    if (
        typeof pt.count === "object" &&
        pt.selected.length >= minTargetCount(pt.count)
    ) {
        actions.push(wrap({ kind: "confirm-targets" }));
    }

    // Aborting the selection is always legal for the chooser (CR 601.2g;
    // declining a retarget, CR 707.10b / 114.6).
    actions.push(wrap({ kind: "cancel-target" }));
    return actions;
}

// ---------------------------------------------------------------------------
// blockers variant (CR 509.1)
// ---------------------------------------------------------------------------

function blockersActions(
    state: GameState,
    expected: Extract<ExpectedInput, { kind: "blockers" }>
): LegalAction[] {
    // The contract names the declaring player (defending player, or the
    // attacking player under Melee — computeExpectedInput already resolved
    // that, CR 509.1); enumerate every legal complete assignment for them.
    const declarer = getPlayer(state, expected.playerId);
    return enumerateBlockerMoves(state, declarer).map((move) => ({
        expect: "blockers",
        playerId: expected.playerId,
        action: move as BlockersAction,
    }));
}

// ---------------------------------------------------------------------------
// priority variant (CR 117)
// ---------------------------------------------------------------------------

const PRIORITY_MOVE_KINDS: ReadonlySet<Move["kind"]> = new Set([
    "pass",
    "mulligan",
    "play-land",
    "summon-companion",
    "cast-spell",
    "activate-ability",
    "declare-attackers",
]);

// ---------------------------------------------------------------------------
// sacrifice variant (CR 508.1c/1g / 701.21a — attack-declaration land tax)
// ---------------------------------------------------------------------------

/** One `select-sacrifice` action per legal land the attacking player may
 *  sacrifice next for the parked attack tax (Flooded Woodlands). Keyed on the
 *  next unmet requirement's filter, filtered to legal candidates. */
function sacrificeActions(
    state: GameState,
    expected: Extract<ExpectedInput, { kind: "sacrifice" }>
): LegalAction[] {
    const sel = state.combat?.pendingAttackSacrifice;
    if (!sel) return [];
    const req = nextUnmetRequirement(sel);
    if (!req) return [];
    return sacrificeCandidates(state, sel.playerId, req.filter)
        .filter((c) => isSacrificeCandidateLegal(state, sel, c.id))
        .map((c) => ({
            expect: "sacrifice" as const,
            playerId: expected.playerId,
            action: { kind: "select-sacrifice" as const, cardInstanceId: c.id },
        }));
}

// ---------------------------------------------------------------------------
// attack-mana-tax variant (CR 508.1c/1g — Propaganda / Collective Restraint)
// ---------------------------------------------------------------------------

/** Legal actions for the parked per-attacker mana attack tax: pay it (auto-tap,
 *  or the server-validated manual per-source tap the UI drives directly) or
 *  cancel the whole declaration. The manual per-source taps are enumerated at
 *  the interaction layer (`useBattlefieldInteraction`) from the payer's mana
 *  sources; here the macro choices — pay / cancel — represent the family. */
function attackManaTaxActions(
    _state: GameState,
    expected: Extract<ExpectedInput, { kind: "attack-mana-tax" }>
): LegalAction[] {
    const playerId = expected.playerId;
    return [
        {
            expect: "attack-mana-tax",
            playerId,
            action: { kind: "auto-tap-attack-tax" },
        },
        {
            expect: "attack-mana-tax",
            playerId,
            action: { kind: "cancel-attack-tax" },
        },
    ];
}

function priorityActions(
    state: GameState,
    expected: Extract<ExpectedInput, { kind: "priority" }>
): LegalAction[] {
    const playerId = expected.playerId;
    const wrap = (action: PriorityAction): LegalAction => ({
        expect: "priority",
        playerId,
        action,
    });

    // CR 601.2g — an in-progress spell payment: the payer holds priority and
    // may abort the cast (taps roll back) or pass priority, which abandons
    // the payment (see passPriority's abandonPendingPayment). Fresh casts /
    // activations are illegal while another payment is open.
    if (state.pendingCast) {
        return [wrap({ kind: "cancel-cast" }), wrap({ kind: "pass" })];
    }
    // CR 602.2b — same for an in-progress ability activation payment.
    if (state.pendingActivation) {
        return [wrap({ kind: "cancel-activation" }), wrap({ kind: "pass" })];
    }

    // CR 510.1 — open combat damage assignment sub-flow: folded into a
    // priority window, but passing is blocked until every distinct assigner
    // confirms. Enumerate a confirm-damage per outstanding assigner (the
    // mutation gates with anyPlayer and validates assigner identity itself).
    if (
        (state.phase === "FIRST_STRIKE_DAMAGE" ||
            state.phase === "COMBAT_DAMAGE") &&
        state.combat &&
        state.combat.damageConfirmed === false
    ) {
        const assigners = new Set(
            Object.values(state.combat.damageAssignerIds ?? {})
        );
        const confirmed = new Set(
            state.combat.damageAssignmentConfirmedBy ?? []
        );
        return [...assigners]
            .filter((id) => !confirmed.has(id))
            .map((id) => ({
                expect: "priority" as const,
                playerId: id,
                action: { kind: "confirm-damage" as const },
            }));
    }

    // Settled priority window (CR 117), pre-game mulligan declaration
    // (CR 103.4), or attacker declaration (CR 508.1): the bot macro-move
    // enumerator already yields exactly the legal set for these windows —
    // reuse it rather than re-deriving. The filter keeps the type honest
    // (enumerateMoves never emits choice/blocker kinds here; blockers windows
    // are the `blockers` variant and choice submissions the `choice` one).
    return enumerateMoves(state, playerId)
        .filter((m): m is PriorityMove => PRIORITY_MOVE_KINDS.has(m.kind))
        .map((m) => wrap(m));
}
