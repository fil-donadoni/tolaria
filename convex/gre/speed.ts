// Speed (Start your engines!, CR 702.179) — a number a player HAS, kept on the
// player rather than on any object (`PlayerState.speed`). Absent means the
// player has no speed (CR 702.179b), which is not the same state as speed 0
// even though an effect reading it sees 0 (CR 702.179f): only a player with
// speed owns the inherent trigger (CR 702.179d), and only a player with no
// speed is raised to 1 by the state-based action (CR 704.5aa).

import type { CardInstanceState, GameState } from "./state/declarations";

/** The `staticAbilities[]` keyword string that carries Start your engines!
 *  (Mechanics Registry id `start-your-engines`, CR 702.179). */
export const START_YOUR_ENGINES_KEYWORD = "start your engines!";

/** CR 702.179e — "A player has max speed if their speed is 4." */
export const MAX_SPEED = 4;

/** CR 702.179f — the value an effect reads: 0 for a player with no speed. */
export function speedOf(player: { readonly speed?: number }): number {
    return player.speed ?? 0;
}

/** CR 702.179e — whether this player has max speed. */
export function hasMaxSpeed(player: { readonly speed?: number }): boolean {
    return speedOf(player) === MAX_SPEED;
}

function hasStartYourEngines(card: CardInstanceState): boolean {
    return card.staticAbilities.includes(START_YOUR_ENGINES_KEYWORD);
}

/** CR 704.5aa — a player who controls a permanent with start your engines! and
 *  has no speed gets speed 1. Reads the controller, not whose battlefield array
 *  the permanent sits in, and the live `staticAbilities` (layer 6). Returns
 *  whether anything changed, for the SBA fixpoint. */
export function checkStartYourEnginesSBA(state: GameState): boolean {
    let changed = false;
    for (const owner of state.players) {
        for (const card of owner.battlefield) {
            if (!hasStartYourEngines(card)) continue;
            const controller = state.players.find(
                (p) => p.id === card.controllerId
            );
            if (controller === undefined || controller.speed !== undefined)
                continue;
            controller.speed = 1;
            changed = true;
        }
    }
    return changed;
}

/** CR 702.179d — the inherent trigger's event and check, read as the life is
 *  lost: an opponent of the active player lost life during the active player's
 *  turn, that player has speed below max, and the ability has not triggered
 *  this turn. Answers the player who owns the trigger, or `undefined`.
 *
 *  Decided here rather than at the trigger scan because that scan runs after
 *  the SBA sweep, and a player given their first speed by that sweep had no
 *  ability when this life was lost (CR 603.2). */
export function speedTriggerController(
    state: GameState,
    losingPlayerId: string
): string | undefined {
    const activeId = state.activePlayerId;
    if (losingPlayerId === activeId) return undefined;
    if (state.speedTriggeredOnTurn === state.turn) return undefined;
    const active = state.players.find((p) => p.id === activeId);
    if (active === undefined) return undefined;
    const speed = speedOf(active);
    return speed >= 1 && speed < MAX_SPEED ? activeId : undefined;
}

/** CR 702.179d + CR 603.4 — the trigger resolving: its "if your speed is less
 *  than 4" is re-read, so an ability that finds its controller at max speed
 *  does nothing. */
export function resolveSpeedIncrease(
    state: GameState,
    controllerId: string
): void {
    const controller = state.players.find((p) => p.id === controllerId);
    if (controller === undefined) return;
    const speed = speedOf(controller);
    if (speed >= 1 && speed < MAX_SPEED) controller.speed = speed + 1;
}
