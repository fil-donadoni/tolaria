import type { PendingChoice } from "~/types/game";

/** Whether a mid-resolution `choose-exile-card` choice (CR 608.2 — Dauthi
 *  Voidwalker's sacrifice) is active for `viewer` and picks from `player`'s
 *  exile zone. Mirrors {@link isGraveyardChoiceActive}: the zone is public,
 *  so per-card eligibility is the choice's `candidateIds` allow-list, checked
 *  at click time. The zone owner is usually the OPPONENT of the chooser
 *  (`zoneOwnerId`, resolved server-side to a concrete player id) — only that
 *  player's pile becomes selectable. */
export function isExileChoiceActive(
    choice: PendingChoice | undefined,
    player: { id: string },
    viewerId: string
): boolean {
    if (!choice) return false;
    if (choice.kind !== "choose-exile-card") return false;
    if (choice.playerId !== viewerId) return false;
    if (choice.zone !== "exile") return false;
    const zoneOwner = choice.zoneOwnerId ?? choice.playerId;
    return player.id === zoneOwner;
}
