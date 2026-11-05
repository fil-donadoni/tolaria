import type { GameState } from "./state";
import type {
    DelayedTriggerTiming,
    GameEvent,
    UntilNextTurnAttackWatch,
} from "../cards/types";

/** The "until your next turn" attack windows (issue #2385, issue #8166). A row
 *  here is the whole of a timing's identity: `collectTriggers` fires it through
 *  `attackWatchFirings`, `advanceTurn` purges it at its controller's next turn,
 *  and the validator lets its body read the live `$event`. */
export const UNTIL_NEXT_TURN_ATTACK_WATCHES: Partial<
    Record<DelayedTriggerTiming, UntilNextTurnAttackWatch>
> = {
    "until-next-turn-creature-attacks-you": {
        attacked: "you-or-your-planeswalkers",
        firing: "per-attacker",
    },
    "until-next-turn-creatures-attack-your-opponents": {
        attacked: "your-opponents",
        firing: "batch",
    },
};

/** True for a timing that lasts until its controller's next turn begins. */
export function isUntilNextTurnAttackWatch(
    timing: DelayedTriggerTiming
): boolean {
    return UNTIL_NEXT_TURN_ATTACK_WATCHES[timing] !== undefined;
}

/** The attackers of this declaration a window with `attacked` cares about. In a
 *  two-player game the defending player is the one player who is not attacking
 *  (CR 506.2), so the side of the declaration says who is being attacked. An
 *  attacker with an `attackTargets` entry is attacking a planeswalker or battle
 *  rather than a player (CR 508.3b). */
function watchedAttackers(
    state: GameState,
    event: Extract<GameEvent, { type: "ATTACKERS_DECLARED" }>,
    controller: string,
    attacked: UntilNextTurnAttackWatch["attacked"]
): readonly string[] {
    if (attacked === "you-or-your-planeswalkers") {
        return event.attackingPlayerId === controller ? [] : event.attackerIds;
    }
    if (event.attackingPlayerId !== controller) return [];
    return event.attackerIds.filter(
        (id) => state.combat?.attackTargets?.[id] === undefined
    );
}

/** CR 508.3a / 725 (issue #7202) — true when this declaration has `watched`
 *  attacking the player who is the monarch right now. The defending player is
 *  the one player not attacking (CR 506.2); an `attackTargets` entry means a
 *  planeswalker or battle is attacked instead of that player (CR 508.3a), and a
 *  game with no monarch has no one to attack as the monarch (CR 725.1). */
export function watchedCreatureAttacksMonarch(
    state: GameState,
    event: Extract<GameEvent, { type: "ATTACKERS_DECLARED" }>,
    watched: string
): boolean {
    if (!event.attackerIds.includes(watched)) return false;
    if (state.combat?.attackTargets?.[watched] !== undefined) return false;
    const defender = state.players.find(
        (p) => p.id !== event.attackingPlayerId
    );
    return defender !== undefined && defender.id === state.monarchId;
}

/** The `ATTACKERS_DECLARED` events one window fires on for one declaration,
 *  each threaded onto its own stack item: one per creature, or one naming the
 *  whole group. No watched attacker means no firing at all. */
export function attackWatchFirings(
    state: GameState,
    event: Extract<GameEvent, { type: "ATTACKERS_DECLARED" }>,
    controller: string,
    watch: UntilNextTurnAttackWatch
): GameEvent[] {
    const attackerIds = watchedAttackers(
        state,
        event,
        controller,
        watch.attacked
    );
    if (attackerIds.length === 0) return [];
    const groups =
        watch.firing === "batch"
            ? [[...attackerIds]]
            : attackerIds.map((id) => [id]);
    return groups.map((ids) => ({
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: event.attackingPlayerId,
        attackerIds: ids,
    }));
}
