// `cardsPutIntoLibraryTrigger` — factory for `CARDS_PUT_INTO_LIBRARY`
// triggered abilities (issue #3242, CR 603.2c — "whenever one or more cards are
// put into a library from anywhere", Wan Shi Tong, All-Knowing).
//
// `CARDS_PUT_INTO_LIBRARY` is emitted ONCE per resolving instruction, however
// many cards it moved (`emitCardsPutIntoLibrary` / `withCardsPutIntoLibraryBatch`,
// `gre/state.ts`), so the choke point is already the batch and the factory adds
// no batching of its own — `cardsExiledTrigger`'s reasoning, unchanged.
//
// A card that never left its library (scry, surveil, a reorder) emits nothing,
// which is the official Wan Shi Tong ruling; the factory need not filter it.

import type {
    CardsPutIntoLibraryEvent,
    EffectOp,
    GameEvent,
    PermanentView,
    TriggeredAbility,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Whose library the cards entered, relative to the trigger source's
 *  controller (CR 109.2). Read off each card's `ownerId` — CR 400.3 puts a card
 *  only into its owner's library. "any" is "a library". */
export type CardsPutIntoLibraryScope = "you" | "opponents" | "any";

export interface CardsPutIntoLibraryTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a). */
    oracleText: string;
    /** See `CardsPutIntoLibraryScope`. */
    scope: CardsPutIntoLibraryScope;
    /** Effect Script (ADR 0045), run with the source's controller and
     *  `$source` bound. */
    effects: EffectOp[];
}

function matchesScope(
    scope: CardsPutIntoLibraryScope,
    cardOwnerId: string,
    selfControllerId: string
): boolean {
    switch (scope) {
        case "you":
            return cardOwnerId === selfControllerId;
        case "opponents":
            return cardOwnerId !== selfControllerId;
        case "any":
            return true;
    }
}

/** True when at least one card of the batch entered a library `scope` names. */
function batchQualifies(
    scope: CardsPutIntoLibraryScope,
    event: CardsPutIntoLibraryEvent,
    selfControllerId: string
): boolean {
    return event.cards.some((c) =>
        matchesScope(scope, c.ownerId, selfControllerId)
    );
}

/** Builds a `TriggeredAbility` listening for `CARDS_PUT_INTO_LIBRARY` (issue
 *  #3242). One trigger per batch that has a qualifying card (CR 603.2c). */
export function cardsPutIntoLibraryTrigger(
    args: CardsPutIntoLibraryTriggerArgs
): TriggeredAbility {
    const matches = (event: GameEvent, self: PermanentView): boolean =>
        event.type === "CARDS_PUT_INTO_LIBRARY" &&
        batchQualifies(args.scope, event, self.controllerId);
    return withTriggerGate(
        {
            id: args.id,
            oracleText: args.oracleText,
            event: "CARDS_PUT_INTO_LIBRARY",
            matches,
            effects: args.effects,
        },
        {}
    );
}
