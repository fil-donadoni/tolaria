import type { CardInstanceState, GameState } from "./state";
import {
    getPlayer,
    phaseInUntapCycleBundles,
    phaseOutPermanent,
    recomputeContinuousEffects,
} from "./state";

/** True when `card` hangs, directly or through another attachment, off a
 *  permanent in `directIds`. */
function isAttachedWithin(
    state: GameState,
    card: CardInstanceState,
    directIds: ReadonlySet<string>
): boolean {
    const seen = new Set([card.id]);
    let hostId = card.attachedTo;
    while (hostId !== undefined && !seen.has(hostId)) {
        if (directIds.has(hostId)) return true;
        seen.add(hostId);
        const currentHostId: string = hostId;
        hostId = state.players
            .flatMap((player) => player.battlefield)
            .find((c) => c.id === currentHostId)?.attachedTo;
    }
    return false;
}

/** CR 502.1 / 702.26a — the phasing turn-based action of `activePlayerId`'s
 *  untap step: all phased-in permanents with phasing that player controls phase
 *  out and, simultaneously, all phased-out permanents that had phased out under
 *  that player's control phase in.
 *
 *  Simultaneity is the order below. The set that phases out is read BEFORE
 *  anything phases in, so a permanent that phases in with phasing stays in until
 *  this player's next untap step; and what phases out is stamped with the turn,
 *  so it cannot phase straight back in.
 *
 *  CR 702.26h — an object that would phase out both directly and indirectly just
 *  phases out indirectly: an attachment with phasing on a host that is phasing
 *  out goes with the host's bundle (CR 702.26g), never in its own, and so comes
 *  back only along with that host.
 *
 *  CR 702.26p — the check is a set membership: more instances change nothing. */
export function phasingTurnBasedAction(
    state: GameState,
    activePlayerId: string
): void {
    const withPhasing = getPlayer(state, activePlayerId).battlefield.filter(
        (card) => card.staticAbilities.includes("phasing")
    );
    const withPhasingIds = new Set(withPhasing.map((card) => card.id));
    const phasingOutDirectly = withPhasing.filter(
        (card) => !isAttachedWithin(state, card, withPhasingIds)
    );

    const bundlesBefore = state.phasedOut?.length ?? 0;
    phaseInUntapCycleBundles(state, activePlayerId);
    const phasedIn = (state.phasedOut?.length ?? 0) !== bundlesBefore;
    for (const card of phasingOutDirectly) {
        phaseOutPermanent(state, card.id, {
            returnOn: { kind: "untap-cycle" },
        });
    }
    // CR 702.26c — the game treats what phased in as existing again, in time for
    // the untap below. `phaseOutPermanent` has already recomposed its own.
    if (phasedIn && phasingOutDirectly.length === 0) {
        recomputeContinuousEffects(state);
    }
}
