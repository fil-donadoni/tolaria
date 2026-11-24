// CR 702.174c — "Some effects trigger whenever a player gives a gift. Such an
// ability triggers whenever an instant or sorcery spell that player controls
// whose gift cost was paid resolves. It also triggers whenever the gift
// triggered ability of a permanent that player controls resolves."
//
// The event is the RESOLUTION's, not the delivery's, so it is emitted by the
// resolver (`resolveTopOfStackInner`, `gre/state.ts`) as either object begins
// a fresh resolution past the target-legality gate (CR 608.2b: an object
// countered on resolution does not resolve and gives nothing), never by an Op.
// The gift's effect itself is the object's own Effect Script
// (`cards/abilities/gift.ts`).
import type { CardDefinition, GameEvent } from "../cards/types";
import { CASTABLE_PERMANENT_TYPES } from "./constants";
import { additionalCostKeywordOf, additionalCostPaidCount } from "./kicker";
import type { GameState, StackItem } from "./state";

/** Was a gift given by `item` resolving? `isSpell` is the resolver's own
 *  spell/ability discriminator. */
export function stackItemGivesGift(
    item: StackItem,
    cardDef: CardDefinition | undefined,
    isSpell: boolean
): boolean {
    if (cardDef === undefined) return false;
    if (isSpell) {
        // CR 702.174b — only an INSTANT or SORCERY spell gives a gift as it
        // resolves; a permanent spell's gift is its twin trigger's.
        const permanent = item.types.some((t) =>
            CASTABLE_PERMANENT_TYPES.includes(
                t as (typeof CASTABLE_PERMANENT_TYPES)[number]
            )
        );
        if (permanent) return false;
        return (cardDef.kickers ?? []).some(
            (entry) =>
                additionalCostKeywordOf(entry) === "gift" &&
                additionalCostPaidCount(item, entry.id) >= 1
        );
    }
    if (item.triggeredAbilityId === undefined) return false;
    const twin = cardDef.triggeredAbilities?.find(
        (a) => a.id === item.triggeredAbilityId
    )?.additionalCostTwin;
    return (
        twin?.keyword === "gift" &&
        additionalCostPaidCount(item, twin.costId) >= 1
    );
}

/** CR 702.174c — queue `GIFT_GIVEN` for `item`'s controller when its
 *  resolution gives a gift. */
export function emitGiftGivenIfGiven(
    state: GameState,
    item: StackItem,
    cardDef: CardDefinition | undefined,
    isSpell: boolean
): void {
    if (!stackItemGivesGift(item, cardDef, isSpell)) return;
    const event: GameEvent = {
        type: "GIFT_GIVEN",
        playerId: item.controllerId,
    };
    state.pendingEvents = (state.pendingEvents ?? []).concat([event]);
}
