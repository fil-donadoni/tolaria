import type { CardInstance, PendingTarget, Player } from "~/types/game";

/** A player's graveyard that is eligible for the current graveyard target,
 *  together with the legal cards inside it (issue #314). */
export interface EligibleGraveyard {
    /** Owner of the graveyard (the `targetPlayerId` submitted to `selectTarget`). */
    playerId: string;
    /** Display name of the graveyard owner. */
    playerName: string;
    /** Whether this graveyard belongs to the viewer (drives "My" vs
     *  "Opponent's" labelling). */
    isMine: boolean;
    /** The cards in this graveyard that satisfy the target requirement. */
    cards: CardInstance[];
}

/** True when the pending target is a graveyard-zone target the local viewer is
 *  the one choosing (CR 109.2 / 400.7). */
export function isGraveyardTargetForViewer(
    pendingTarget: PendingTarget | undefined,
    viewerId: string
): boolean {
    return (
        !!pendingTarget &&
        pendingTarget.zone === "graveyard" &&
        pendingTarget.playerId === viewerId
    );
}

/** Client-side mirror of the backend's graveyard-target validation in
 *  `selectTarget` (convex/game.ts). Returns true if `card` in the graveyard
 *  owned by `ownerId` satisfies the pending target's controller-relationship
 *  and card-type filters. Must stay in sync with the server check.
 *
 *  CR 109.2 / 400.7 — graveyard-zone target. The card-type union (the pending
 *  target's `targetType` minus the non-card tokens) is matched with OR
 *  semantics; `"card"` matches any card. */
export function matchesGraveyardTarget(
    card: CardInstance,
    ownerId: string,
    pendingTarget: PendingTarget,
    viewerId: string
): boolean {
    const controllerFilter = pendingTarget.controller ?? "any";
    if (controllerFilter === "you" && ownerId !== viewerId) return false;
    if (controllerFilter === "opponent" && ownerId === viewerId) return false;

    const reqTypes = Array.isArray(pendingTarget.targetType)
        ? pendingTarget.targetType
        : [pendingTarget.targetType];
    if (reqTypes.includes("card")) return true;
    const cardTypes = reqTypes.filter(
        (t) =>
            t !== "player" &&
            t !== "any" &&
            t !== "spell" &&
            t !== "spell-or-permanent" &&
            t !== "card"
    );
    if (cardTypes.length === 0) return true;
    const ownTypes = card.types ?? [];
    return cardTypes.some((t) => ownTypes.includes(t));
}

/** Computes the graveyards (and their legal cards) eligible for the current
 *  graveyard target. Used by the graveyard target dialog (issue #314) to decide
 *  whether to show the graveyard-choice step (≥2 eligible) and which cards to
 *  list. The order places the viewer's own graveyard first. */
export function getEligibleGraveyards(
    pendingTarget: PendingTarget,
    allPlayers: Player[],
    viewerId: string
): EligibleGraveyard[] {
    const result: EligibleGraveyard[] = [];
    for (const player of allPlayers) {
        const cards = player.graveyard.filter((c) =>
            matchesGraveyardTarget(c, player.id, pendingTarget, viewerId)
        );
        if (cards.length === 0) continue;
        result.push({
            playerId: player.id,
            playerName: player.name,
            isMine: player.id === viewerId,
            cards,
        });
    }
    result.sort((a, b) => Number(b.isMine) - Number(a.isMine));
    return result;
}
