// `giftGivenTrigger` — factory for `GIFT_GIVEN` triggered abilities
// (CR 702.174c: "Some effects trigger whenever a player gives a gift").
//
// `GIFT_GIVEN` is emitted by the resolver as an instant or sorcery whose gift
// cost was paid, or a permanent's gift trigger, resolves (`gre/gift.ts`), so
// this factory only narrows the event and gates the giver's relation to the
// trigger's controller (CR 109.5: "you" is the triggered ability's controller).

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TriggeredAbility,
} from "../../types";

/** Who must have given the gift, relative to the trigger source's controller:
 *  "you" is Jolly Gerbils' "whenever you give a gift". */
export type GiftGivenScope = "you" | "opponents" | "any";

export interface GiftGivenTriggerArgs {
    id: string;
    oracleText: string;
    scope: GiftGivenScope;
    /** Effect Script (ADR 0045), run with the source's controller and
     *  `$source` bound. */
    effects: EffectOp[];
}

function matchesGiftGivenScope(
    scope: GiftGivenScope,
    giver: string,
    self: PermanentView
): boolean {
    switch (scope) {
        case "you":
            return giver === self.controllerId;
        case "opponents":
            return giver !== self.controllerId;
        case "any":
            return true;
    }
}

/** Builds a `TriggeredAbility` listening for `GIFT_GIVEN` (CR 702.174c). */
export function giftGivenTrigger(args: GiftGivenTriggerArgs): TriggeredAbility {
    return {
        id: args.id,
        oracleText: args.oracleText,
        event: "GIFT_GIVEN",
        matches: (event: GameEvent, self: PermanentView): boolean =>
            event.type === "GIFT_GIVEN" &&
            matchesGiftGivenScope(args.scope, event.playerId, self),
        effects: args.effects,
    };
}
