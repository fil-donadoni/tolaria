// `cardLeftGraveyardTrigger` — "whenever a [<type>] card leaves [your]
// graveyard" (issue #9423, Murktide Regent: "Whenever an instant or sorcery
// card leaves your graveyard, put a +1/+1 counter on this creature").
//
// Listens on `CARD_LEFT_GRAVEYARD`, emitted ONCE PER CARD from the single
// departure chokepoint (`noteGraveyardDeparture`, `gre/state.ts`) — every exit
// reaches it: exile, the battlefield, the hand, the library and the stack. So
// CR 603.2c is already satisfied upstream: N qualifying cards leaving together
// (a delve cost, Endurance's whole-graveyard sweep) trigger the ability N
// times, which is the official Murktide Regent ruling.
//
// CR 603.10a — a leaves-a-graveyard ability LOOKS BACK IN TIME:
//   - the card is judged as it last existed in the graveyard (the event's
//     `types` snapshot), never as the new object it became (CR 400.7) — an
//     instant cast with flashback is a spell on the stack by now;
//   - a source that was not on the battlefield when the card left does not
//     trigger: the departing card itself (a reanimated creature with this
//     ability does not see its own departure), and every card that left a
//     graveyard for the battlefield in the same simultaneous move
//     (`battlefieldCohort`).

import type {
    CardLeftGraveyardEvent,
    CardType,
    EffectOp,
    GameEvent,
    PermanentView,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Whose graveyard the card left, relative to the source's controller
 *  (CR 400.3 — a card is only ever in its owner's graveyard). */
export type CardLeftGraveyardScope = "yours" | "opponents" | "any";

export interface CardLeftGraveyardTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs. */
    oracleText: string;
    /** See `CardLeftGraveyardScope`. */
    graveyard: CardLeftGraveyardScope;
    /** CR 205.2a — the card must have ANY of these card types as it last
     *  existed in the graveyard ("an instant or sorcery card" =
     *  `["Instant", "Sorcery"]`). Absent = every card. */
    cardTypes?: ReadonlyArray<CardType>;
    /** CR 603.4 check-time predicate. */
    condition?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect Script (ADR 0045), run with the source's controller and
     *  `$source` bound. */
    effects: EffectOp[];
}

/** CR 603.10a — true when `self` was on the battlefield as the card left: it
 *  is neither the departing card nor one of the cards that entered the
 *  battlefield from a graveyard together with it. */
function sourceWasPresent(
    event: CardLeftGraveyardEvent,
    self: PermanentView
): boolean {
    if (event.cardInstanceId === self.id) return false;
    return !(event.battlefieldCohort ?? []).includes(self.id);
}

function matchesScope(
    scope: CardLeftGraveyardScope,
    ownerId: string,
    selfControllerId: string
): boolean {
    switch (scope) {
        case "yours":
            return ownerId === selfControllerId;
        case "opponents":
            return ownerId !== selfControllerId;
        case "any":
            return true;
    }
}

/** Builds a `TriggeredAbility` listening for `CARD_LEFT_GRAVEYARD` (issue
 *  #9423). One trigger per qualifying card (CR 603.2c). */
export function cardLeftGraveyardTrigger(
    args: CardLeftGraveyardTriggerArgs
): TriggeredAbility {
    const { id, oracleText, graveyard, cardTypes, condition, effects } = args;
    const matches = (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (event.type !== "CARD_LEFT_GRAVEYARD") return false;
        // CR 108.2b — "a card": a token that briefly sat in a graveyard
        // (CR 111.7) and was moved out before the SBA check is not one.
        if (event.isToken === true) return false;
        if (!sourceWasPresent(event, self)) return false;
        if (!matchesScope(graveyard, event.ownerId, self.controllerId))
            return false;
        if (
            cardTypes !== undefined &&
            !cardTypes.some((t) => event.types.includes(t))
        )
            return false;
        return condition === undefined || condition(event, self, state);
    };
    return withTriggerGate(
        {
            id,
            oracleText,
            event: "CARD_LEFT_GRAVEYARD",
            matches,
            effects,
        },
        args
    );
}
