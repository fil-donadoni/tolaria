// The Pending Choice handler registry (CR 608.2, issue #4443): ONE row per
// `PendingChoiceKind`, naming how a submission for that kind is applied
// (`submit`, read by `applyPendingChoiceSubmit`) and which submissions are
// legal (`legalActions`, read by `legalActions`' choice arm). Typed as a
// `Record` over the whole union, so a kind added without a row — or a row
// removed — is a compile error, and every consumer that dispatches on the
// kind reads this table rather than a ladder of its own. Precedent:
// `CHOICE_CANDIDATE_GENERATORS`.
//
// The as-enters family is not a row: it reuses existing kinds' shapes and is
// routed on `asEntersCardId` before this table is consulted.

import type { PendingChoiceKind } from "./state";
import {
    answeredBy,
    counted,
    submitDamageTargetPick,
    submitDiscardHand,
    submitDrawLookKeep,
    submitLegendKeep,
    submitMidResolutionPick,
    submitMulliganBottom,
    submitOptionPick,
    submitPilePick,
    submitPlayerPick,
    submitTriggerMode,
    submitTriggerOrder,
    submitUntapPick,
    zoned,
    type ChoiceSubmitHandler,
} from "./pendingChoiceSubmitHandlers";
import {
    damageTargetActions,
    landEntryActions,
    madnessCastActions,
    mayPayActions,
    nameCardActions,
    noChoiceActions,
    numberPickActions,
    optionPickActions,
    pilePickActions,
    randomRevealActions,
    reboundCastActions,
    triggerOrderActions,
    zonePickActions,
    type ChoiceActionsHandler,
} from "./pendingChoiceActionHandlers";

export type PendingChoiceHandler = {
    submit: ChoiceSubmitHandler;
    legalActions: ChoiceActionsHandler;
};

/** The ordinary zone pick: validated against its zone, answered into
 *  `collectedChoices`, resolution resumed. */
const ZONE_PICK: PendingChoiceHandler = {
    submit: zoned(submitMidResolutionPick),
    legalActions: zonePickActions,
};

export const PENDING_CHOICE_HANDLERS: Record<
    PendingChoiceKind,
    PendingChoiceHandler
> = {
    "keep-permanents": ZONE_PICK,
    "sacrifice-permanents": ZONE_PICK,
    "keep-hand": ZONE_PICK,
    "search-library": ZONE_PICK,
    "pick-source": ZONE_PICK,
    "reorder-library": ZONE_PICK,
    "reveal-hand": ZONE_PICK,
    "choose-permanents": ZONE_PICK,
    partition: ZONE_PICK,
    "choose-hand-card": ZONE_PICK,
    "choose-graveyard-card": ZONE_PICK,
    "choose-exile-card": ZONE_PICK,
    "choose-library-card": ZONE_PICK,
    "order-top": ZONE_PICK,
    "look-distribute": ZONE_PICK,
    "choose-categorized": ZONE_PICK,
    "choose-aura-host": ZONE_PICK,
    "divide-piles": ZONE_PICK,
    "discard-hand": {
        submit: zoned(submitDiscardHand),
        legalActions: zonePickActions,
    },
    "legend-keep": {
        submit: zoned(submitLegendKeep),
        legalActions: zonePickActions,
    },
    "untap-pick": {
        submit: zoned(submitUntapPick),
        legalActions: zonePickActions,
    },
    "draw-look-keep": {
        submit: zoned(submitDrawLookKeep),
        legalActions: zonePickActions,
    },
    "mulligan-bottom": {
        submit: zoned(submitMulliganBottom),
        legalActions: zonePickActions,
    },
    "choose-damage-target": {
        submit: counted(submitDamageTargetPick),
        legalActions: damageTargetActions,
    },
    "choose-player": {
        submit: counted(submitPlayerPick),
        // `choose-player` picks a PLAYER id, which the zone enumerator cannot
        // see: with no `zone` it offers only the empty "up to one" pick. Kept
        // as shipped — the kind has no producer in the catalogue
        // (`docs/findings/4476-choose-player-kind-has-no-producer.md`).
        legalActions: zonePickActions,
    },
    "option-pick": {
        submit: counted(submitOptionPick),
        legalActions: optionPickActions,
    },
    "trigger-mode": {
        submit: counted(submitTriggerMode),
        legalActions: optionPickActions,
    },
    "pick-pile": {
        submit: counted(submitPilePick),
        legalActions: pilePickActions,
    },
    "trigger-order": {
        submit: counted(submitTriggerOrder),
        legalActions: triggerOrderActions,
    },
    // The kinds answered by their own mutation, never `submitResolutionChoice`.
    "may-pay": {
        submit: answeredBy("submitMayPay"),
        legalActions: mayPayActions,
    },
    "name-card": {
        submit: answeredBy("submitNameCard"),
        legalActions: nameCardActions,
    },
    "land-entry-tapped": {
        submit: answeredBy("submitLandEntryChoice"),
        legalActions: landEntryActions,
    },
    "number-pick": {
        submit: answeredBy("submitNumberChoice"),
        legalActions: numberPickActions,
    },
    "random-reveal": {
        submit: answeredBy("submitRandomRevealAck"),
        legalActions: randomRevealActions,
    },
    "madness-cast": {
        submit: answeredBy("submitMadnessDecline"),
        legalActions: madnessCastActions,
    },
    "rebound-cast": {
        submit: answeredBy("submitReboundDecline"),
        legalActions: reboundCastActions,
    },
    "draw-replacement": {
        submit: answeredBy("submitDrawReplacementPay"),
        // CR 614 (ADR 0061) — `draw-replacement` is answered by
        // `submitDrawReplacementPay`, and no `ChoiceAction` variant carries
        // that answer yet. It has no `zone` and `count: 1`, so the zone-pick
        // enumerator it used to fall into yielded nothing; that is kept.
        legalActions: noChoiceActions,
    },
};

/** The kind's row. A kind outside the union (a persisted choice from a newer
 *  or corrupted snapshot) has none and is refused loudly — never a silent
 *  fall into some default handler. */
export function pendingChoiceHandlerFor(
    kind: PendingChoiceKind
): PendingChoiceHandler {
    // An own-property test, not a bare index: `"toString"` is not a kind.
    if (!Object.prototype.hasOwnProperty.call(PENDING_CHOICE_HANDLERS, kind)) {
        throw new Error(
            `Unhandled pending choice kind: ${JSON.stringify(kind)}`
        );
    }
    return PENDING_CHOICE_HANDLERS[kind];
}
