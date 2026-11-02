// CR 611.2a — player-scoped rules-modifying effects with no object to carry
// them: `GameState.playerRestrictions`, one reader and one writer.
//
// A dependency-free leaf (type-only imports), so the engine's life-gain choke
// point, the Effect Script executor, the bot and the client can all read it
// without pulling the card registry in (see `playerCounters.ts` for why that
// matters).
import type {
    GameState,
    PlayerRestriction,
    PlayerRestrictionKind,
} from "./state/declarations";

/** True when `playerId` is under a `kind` restriction. Reads a
 *  `playerRestrictions` slice only, so a projected wire state (which carries
 *  the field through the `...state` spread) answers the same as the engine. */
export function playerHasRestriction(
    state: Pick<GameState, "playerRestrictions">,
    playerId: string,
    kind: PlayerRestrictionKind
): boolean {
    return (state.playerRestrictions ?? []).some(
        (r) => r.playerId === playerId && r.kind === kind
    );
}

/** Puts `playerId` under `kind` for the rest of the game (CR 611.2a).
 *  Idempotent: a second grant of a lock the player already has adds nothing,
 *  since the effect is the same rule either way. */
export function addPlayerRestriction(
    state: GameState,
    playerId: string,
    kind: PlayerRestrictionKind
): void {
    if (playerHasRestriction(state, playerId, kind)) return;
    const entry: PlayerRestriction = { playerId, kind };
    state.playerRestrictions = [...(state.playerRestrictions ?? []), entry];
}
