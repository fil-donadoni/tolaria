import type { PendingChoice, Player } from "~/types/game";

/** The cards of a `graveyard-order` choice (CR 404.3, issue #9554) as the
 *  ordering strip takes them: topmost first — the choice's own `candidateIds`
 *  orientation — resolved against the zone owner's projected graveyard (a
 *  public zone, so every card crosses the wire with its identity). A candidate
 *  that is no longer in that graveyard is dropped. */
export function graveyardOrderCards(
    choice: Pick<PendingChoice, "candidateIds" | "zoneOwnerId" | "playerId">,
    players: readonly Pick<Player, "id" | "graveyard">[]
): { instanceId: string; defId: string }[] {
    const ownerId = choice.zoneOwnerId ?? choice.playerId;
    const graveyard = players.find((p) => p.id === ownerId)?.graveyard ?? [];
    const byId = new Map(graveyard.map((c) => [c.id, c]));
    return (choice.candidateIds ?? []).flatMap((id) => {
        const card = byId.get(id);
        return card ? [{ instanceId: card.id, defId: card.card.id }] : [];
    });
}
