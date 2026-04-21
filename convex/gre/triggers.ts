// Trigger scan and stack push (CR 603).
//
// Flow: the engine applies a game action that emits one or more `GameEvent`s,
// then calls `collectTriggers` which returns one StackItem per (permanent,
// ability, event) match. Caller appends them to the stack and restarts
// priority from the active player.
//
// APNAP ordering (CR 603.3b) is out of scope for now — this implementation
// iterates the active player's permanents first, then the opponent's, in
// battlefield-declaration order. That's deterministic but not the rules-
// correct ordering for controlled simultaneous triggers.

import type { GameEvent } from "../cards/types";
import { tryGetCardById } from "../cards";
import type { CardInstanceState, GameState, StackItem } from "./state";
import { getPlayer } from "./state";

/** Builds a StackItem representing a triggered ability on the stack. */
function buildTriggerItem(
    self: CardInstanceState,
    triggeredAbilityId: string,
    event: GameEvent
): StackItem {
    return {
        ...self,
        id: crypto.randomUUID(),
        zone: "stack",
        castById: self.controllerId,
        triggeredAbilityId,
        triggerSourceId: self.id,
        triggerEvent: event,
    };
}

/** Scans all battlefield permanents for triggered abilities matching `events`.
 *  Returns new StackItems in the order they should be placed on the stack. */
export function collectTriggers(
    state: GameState,
    events: GameEvent[]
): StackItem[] {
    if (events.length === 0) return [];

    const active = getPlayer(state, state.activePlayerId);
    const opponents = state.players.filter(
        (p) => p.id !== state.activePlayerId
    );
    const ordered = [active, ...opponents];

    const out: StackItem[] = [];
    for (const player of ordered) {
        for (const permanent of player.battlefield) {
            const cardId = (permanent.card as { id?: string }).id;
            if (!cardId) continue;
            const def = tryGetCardById(cardId);
            const abilities = def?.triggeredAbilities;
            if (!abilities || abilities.length === 0) continue;
            for (const ability of abilities) {
                for (const event of events) {
                    if (event.type !== ability.event) continue;
                    if (!ability.matches(event, permanent)) continue;
                    out.push(buildTriggerItem(permanent, ability.id, event));
                }
            }
        }
    }
    return out;
}
