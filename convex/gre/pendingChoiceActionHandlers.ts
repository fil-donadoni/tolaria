// The legal-actions column of the Pending Choice handler registry (issue
// #4443): one enumerator per `PendingChoiceKind`, called by `legalActions`'
// choice arm (ADR 0047). Each yields the complete set of submissions the
// chooser may legally make for that kind — never an empty set for a kind that
// has an answer, which would be a frozen game. PURE.

import {
    canPayMayPayCost,
    getPendingChoiceMax,
    getPendingChoiceMin,
    numberChoiceRange,
    type GameState,
    type PendingChoice,
} from "./state";
import { combinations, MAX_COMBINATIONS } from "./moves";
import { eligibleZonePickCards } from "./zonePickEligibility";
import type { ChoiceAction, LegalAction } from "./legalActions";

/** The builders a choice enumerator wraps its answers in: `wrap` tags a
 *  `ChoiceAction` with the choice window and chooser; `submit` builds the
 *  `submit-choice` payload for the head's own identity. */
export type ChoiceActionContext = {
    playerId: string;
    wrap: (action: ChoiceAction) => LegalAction;
    submit: (cardInstanceIds: string[]) => LegalAction;
};

/** One kind's legal-action enumerator. */
export type ChoiceActionsHandler = (
    state: GameState,
    head: PendingChoice,
    ctx: ChoiceActionContext
) => LegalAction[];

/** CR 117.3a / 118.4 — yes/no may-pay: declining is always legal; accepting
 *  only when every leg of the cost (mana / life / sacrifice) is payable. */
export const mayPayActions: ChoiceActionsHandler = (
    state,
    head,
    { playerId, wrap }
) => {
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
};

/** CR 614.12 / ADR 0051 — land-entry pay-choice (shock land): declining
 *  (enter tapped) is always legal; paying only when the cost is affordable. */
export const landEntryActions: ChoiceActionsHandler = (
    state,
    head,
    { playerId, wrap }
) => {
    const actions: LegalAction[] = [
        wrap({ kind: "submit-land-entry", accept: false }),
    ];
    if (!head.cost || canPayMayPayCost(state, playerId, head.cost)) {
        actions.unshift(wrap({ kind: "submit-land-entry", accept: true }));
    }
    return actions;
};

/** CR 201.2 / 202.3 — name a card: the domain is the whole registry, so a
 *  single open-payload action represents the family. */
export const nameCardActions: ChoiceActionsHandler = (_state, _head, ctx) => [
    ctx.wrap({ kind: "submit-name-card" }),
];

/** CR 107.1b / 107.3f (issue #1701) — a numeric nomination: the domain is a
 *  range, so a single open-payload action carrying the live bounds
 *  represents the family. Amount 0 is always inside it (it IS the decline),
 *  so this action is never empty and the window can never freeze. */
export const numberPickActions: ChoiceActionsHandler = (
    state,
    head,
    { playerId, wrap }
) => {
    const payer = state.players.find((p) => p.id === playerId);
    const { min, max } = numberChoiceRange(head, payer);
    return [wrap({ kind: "submit-number-choice", min, max })];
};

/** CR 705.2 (ADR 0023) — random reveal: a no-decision acknowledgement. */
export const randomRevealActions: ChoiceActionsHandler = (
    _state,
    head,
    { wrap }
) => [
    wrap({
        kind: "submit-random-reveal-ack",
        stackItemId: head.stackItemId,
        choiceId: head.choiceId,
    }),
];

/** CR 702.35a — reflexive Madness cast-choice: the only choice-action is to
 *  DECLINE (→ graveyard). The ACCEPT ("Cast") is a normal cast of the exiled
 *  card, enumerated as a priority-window `cast-spell` move, not here. */
export const madnessCastActions: ChoiceActionsHandler = (
    _state,
    _head,
    ctx
) => [ctx.wrap({ kind: "submit-madness-decline" })];

/** CR 702.88a — reflexive Rebound cast-choice: the only choice-action is to
 *  DECLINE (the card remains exiled). The ACCEPT ("Cast") is a normal cast
 *  of the exiled card, enumerated as a priority-window `cast-spell` move,
 *  not here. Mirrors `madness-cast` above. */
export const reboundCastActions: ChoiceActionsHandler = (
    _state,
    _head,
    ctx
) => [ctx.wrap({ kind: "submit-rebound-decline" })];

/** CR 614.12 — abstract option pick: exactly one of the author-supplied
 *  option ids. CR 603.3c (issue #2461) — a modal TRIGGER's announce-time
 *  mode pick is the same submission shape, and `options` already holds only
 *  the CHOOSABLE modes, so every enumerated action is a legal announcement.
 *  Without this arm the announcement would fall to the zone-pick
 *  enumerator, find no zone, and return nothing — a frozen game (ADR 0047). */
export const optionPickActions: ChoiceActionsHandler = (_state, head, ctx) =>
    (head.options ?? []).map((o) => ctx.submit([o.id]));

/** ADR 0053 (pile division) — pick a pile: exactly one of "A" / "B". Both
 *  are always legal regardless of pile contents (an empty pile is a legal
 *  choice — CR doesn't forbid choosing an empty pile). */
export const pilePickActions: ChoiceActionsHandler = (_state, _head, ctx) =>
    (["A", "B"] as const).map((id) => ctx.submit([id]));

/** CR 603.3b (ADR 0058) — trigger-order: a single canonical ordering (the
 *  slice in collection order). Any permutation is legal for the human path,
 *  but self-ordering own triggers is tactically immaterial, so the move space
 *  stays flat — one action, not N! — to preserve ISMCTS budget (ADR 0058). */
export const triggerOrderActions: ChoiceActionsHandler = (
    _state,
    head,
    ctx
) => [ctx.submit(head.candidateIds ?? [])];

/** CR 115.4 — "any target" damage-target pick: one of the damageable
 *  permanents (`candidateIds`) or players (`candidatePlayerIds`). */
export const damageTargetActions: ChoiceActionsHandler = (_state, head, ctx) =>
    [...(head.candidateIds ?? []), ...(head.candidatePlayerIds ?? [])].map(
        (id) => ctx.submit([id])
    );

/** A kind whose answer no `ChoiceAction` variant carries: nothing to offer. */
export const noChoiceActions: ChoiceActionsHandler = () => [];

/** Zone-pick family + mulligan-bottom (CR 608.2 / 103.5): every valid
 *  submission is a duplicate-free subset of the eligible pool with size in
 *  [min, max] — mirroring `applyPendingChoiceSubmit`'s validation. Capped at
 *  MAX_COMBINATIONS like every combinatorial window in moves.ts. The pool is
 *  `eligibleZonePickCards` (`zonePickEligibility.ts`), the shared authority
 *  the `choose-permanents` candidate generator reads too. */
export const zonePickActions: ChoiceActionsHandler = (state, head, ctx) => {
    const ids = eligibleZonePickCards(state, head).map((c) => c.id);
    const min = Math.max(0, getPendingChoiceMin(head.count));
    const max = Math.min(getPendingChoiceMax(head.count), ids.length);
    const actions: LegalAction[] = [];
    for (let size = min; size <= max; size++) {
        for (const combo of combinations(ids, size)) {
            actions.push(ctx.submit(combo));
            if (actions.length >= MAX_COMBINATIONS) return actions;
        }
    }
    return actions;
};
