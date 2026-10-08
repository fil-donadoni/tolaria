// `graveyardEntryTrigger` — "whenever a [<colour>] card is put into a
// graveyard from anywhere" (CR 603.2 / 603.6c / 400.7e).
//
// "From anywhere" is ONE Oracle line over the ways the engine moves a card
// into a graveyard, so ONE ability listens on the four events that partition
// them (Worldspine Wurm's shape, `sets/rtr/green.cards.ts`):
//
//   - `PERMANENT_LEFT` with `toZone: "graveyard"` — battlefield → graveyard,
//     every permanent type, not just creatures;
//   - `CARD_DISCARDED` (CR 701.9) and `CARD_MILLED` (CR 701.17);
//   - `CARD_PUT_INTO_GRAVEYARD` — the residual general move, AND a spell card
//     leaving the stack (resolved, countered or fizzled).
//
// CR 603.6c: a "from anywhere" trigger is NOT a leaves-the-battlefield ability,
// so it looks at the card in the graveyard it reached rather than back in
// time: the card must be there (a CR 614 exile redirect means it never
// arrived), must be a CARD (a token is not one — CR 111.7 lets it reach the
// graveyard only until the next state-based check), and — when the words name
// a colour — must have that colour by its own mana cost there (CR 202.2).

import { manaCostForCardId } from "../../manaCostLookup";
import { getColorsFromCost } from "../../colors";
import type {
    Color,
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Whose graveyard the card must reach (CR 400.3 — always its OWNER's). */
export type GraveyardEntryOwner = "any" | "yours" | "opponents";

export interface GraveyardEntryTriggerArgs {
    id: string;
    oracleText: string;
    /** Whose graveyard the card is put into, relative to the source's
     *  controller. */
    graveyard: GraveyardEntryOwner;
    /** "another card": the source's own entry does not fire it. */
    excludeSelf?: boolean;
    /** CR 105.2 — the card must have ANY of these colours (a single colour is
     *  the "a black card" shape). Absent = every card. */
    colors?: ReadonlyArray<Color>;
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

/** The events a general "put into a graveyard" can arrive on. */
export const GRAVEYARD_ENTRY_EVENTS = [
    "PERMANENT_LEFT",
    "CARD_DISCARDED",
    "CARD_MILLED",
    "CARD_PUT_INTO_GRAVEYARD",
] as const satisfies ReadonlyArray<GameEvent["type"]>;

/** (owner, card instance) of a card an event put into a graveyard, or null
 *  when the event is not such a move. */
function entryOf(
    event: GameEvent
): { ownerId: string; cardInstanceId: string } | null {
    switch (event.type) {
        case "PERMANENT_LEFT":
            return event.toZone === "graveyard"
                ? { ownerId: event.ownerId, cardInstanceId: event.instanceId }
                : null;
        case "CARD_DISCARDED":
            return {
                ownerId: event.playerId,
                cardInstanceId: event.cardInstanceId,
            };
        case "CARD_MILLED":
        case "CARD_PUT_INTO_GRAVEYARD":
            return {
                ownerId: event.ownerId,
                cardInstanceId: event.cardInstanceId,
            };
        default:
            return null;
    }
}

export function graveyardEntryTrigger(
    args: GraveyardEntryTriggerArgs
): TriggeredAbility {
    const {
        id,
        oracleText,
        graveyard,
        excludeSelf,
        colors,
        targetRequirement,
        condition,
        interveningIf,
        effects,
    } = args;

    const ability: TriggeredAbility = {
        id,
        oracleText,
        event: [...GRAVEYARD_ENTRY_EVENTS],
        matches: (event, self, state) => {
            const entry = entryOf(event);
            if (entry === null) return false;
            if (excludeSelf === true && entry.cardInstanceId === self.id)
                return false;
            if (graveyard === "yours" && entry.ownerId !== self.controllerId)
                return false;
            if (
                graveyard === "opponents" &&
                entry.ownerId === self.controllerId
            )
                return false;
            const landed = state?.players
                .find((p) => p.id === entry.ownerId)
                ?.graveyard?.find((c) => c.id === entry.cardInstanceId);
            if (landed === undefined) return false;
            // The trigger scan hands over the real `GameState`, typed narrower
            // as the view: the token flag and the card id ride on the
            // graveyard instance at runtime.
            const raw = landed as { isToken?: boolean; card?: { id?: string } };
            if (raw.isToken) return false;
            if (colors !== undefined) {
                const cardId = raw.card?.id;
                if (cardId === undefined) return false;
                const have = getColorsFromCost(manaCostForCardId(cardId));
                if (!colors.some((c) => have.includes(c))) return false;
            }
            return condition === undefined || condition(event, self, state);
        },
        effects,
    };
    if (interveningIf !== undefined) ability.interveningIf = interveningIf;
    if (targetRequirement !== undefined)
        ability.targetRequirement = targetRequirement;
    return withTriggerGate(ability, args);
}
