// `foragedTrigger` — factory for "Whenever you forage" triggered abilities
// (CR 701.61a: To forage means "Exile three cards from your graveyard or
// sacrifice a Food.").
//
// `FORAGED` is queued by the `forage` Op once the forager has performed a
// half (`SpellContext.noteForaged`), so this factory only gates the forager's
// relation to the trigger's controller (CR 109.5: "you" is the triggered
// ability's controller).

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TriggeredAbility,
} from "../../types";

export interface ForagedTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3). */
    oracleText: string;
    /** Effect Script (ADR 0045), run with the source's controller and
     *  `$source` bound. */
    effects: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `FORAGED` (CR 701.61a): only
 *  "you" is printed. */
export function foragedTrigger(args: ForagedTriggerArgs): TriggeredAbility {
    return {
        id: args.id,
        oracleText: args.oracleText,
        event: "FORAGED",
        matches: (event: GameEvent, self: PermanentView): boolean =>
            event.type === "FORAGED" && event.playerId === self.controllerId,
        effects: args.effects,
    };
}
