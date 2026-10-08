// `libraryToGraveyardTrigger` — "when this card is put into your graveyard from
// your library" (CR 603.6c / 113.6k).
//
// The source IS the card that moved, so it is no battlefield permanent: it
// functions from the graveyard it just landed in (CR 113.6k — a trigger
// condition that cannot trigger from the battlefield functions in every zone it
// can trigger from; the `zone: "graveyard"` scan Nether Shadow opted into), and
// it is self-scoped — only its OWN trip fires it.
//
// "From your library" is the mill (CR 701.17, `CARD_MILLED`) and the other
// library → graveyard move the engine funnels through the general zone-change
// primitive (`CARD_PUT_INTO_GRAVEYARD` with `fromZone: "library"`, e.g. the
// CR 614 reveal-bin). Two events, one Oracle line (CR 603.2).

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface LibraryToGraveyardTriggerArgs {
    id: string;
    oracleText: string;
    targetRequirement?: TargetRequirement;
    /** CR 603.4 check-time predicate. */
    condition?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if, re-checked as the ability resolves. */
    interveningIf?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    effects: EffectOp[];
}

export function libraryToGraveyardTrigger(
    args: LibraryToGraveyardTriggerArgs
): TriggeredAbility {
    const { id, oracleText, targetRequirement, condition, interveningIf } =
        args;
    const ability: TriggeredAbility = {
        id,
        oracleText,
        event: ["CARD_MILLED", "CARD_PUT_INTO_GRAVEYARD"],
        // CR 113.6k — functions while the source sits in the graveyard.
        zone: "graveyard",
        matches: (event, self, state) => {
            const own =
                (event.type === "CARD_MILLED" &&
                    event.cardInstanceId === self.id) ||
                (event.type === "CARD_PUT_INTO_GRAVEYARD" &&
                    event.fromZone === "library" &&
                    event.cardInstanceId === self.id);
            return (
                own &&
                (condition === undefined || condition(event, self, state))
            );
        },
        effects: args.effects,
    };
    if (interveningIf !== undefined) ability.interveningIf = interveningIf;
    if (targetRequirement !== undefined)
        ability.targetRequirement = targetRequirement;
    return withTriggerGate(ability, args);
}
