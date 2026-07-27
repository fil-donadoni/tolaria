import type { CardInstance, PendingTarget, Player } from "~/types/game";
import { getInstanceManaCost } from "@convex/cards";
import { manaValue } from "@convex/gre/constants";

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
 *  owned by `ownerId` satisfies the pending target's controller-relationship,
 *  card-type (positive AND negative), and mana-value filters. Must stay in
 *  sync with the server check.
 *
 *  CR 109.2 / 400.7 — graveyard-zone target. The card-type union (the pending
 *  target's `targetType` minus the non-card tokens) is matched with OR
 *  semantics; `"card"` matches any card. `excludeTypes` (CR 109.1, issue
 *  #1378 review follow-up — Guardian Scalelord's "nonland permanent card",
 *  the Phelia idiom) EXCLUDES a card whose types intersect the excluded set —
 *  checked independently of the positive `targetType` match, since a
 *  DUAL-TYPED card (a land Creature) can satisfy the positive list while
 *  still needing to be excluded. `mvFilter` (CR 202.3, issue #1378 —
 *  Guardian Scalelord's dynamic power-based ceiling, and every existing
 *  literal-ceiling graveyard reanimator: Sevinne's Reclamation
 *  (`c19/white.ts`), Karmic Guide-style sos/multicolor.ts, ulg/black.ts) is
 *  ALREADY a plain-number bound by the time it reaches `PendingTarget` — the
 *  server resolves any `"X"` / `"sourcePower"` sentinel BEFORE building
 *  `PendingTarget.mvFilter` (`pendingTargetFiltersFromRequirement`,
 *  `gre/rules.ts`), so the client never needs to know the dynamic grammar,
 *  only the already-resolved bound. `mvFilter` and `excludeTypes` were
 *  previously UNCHECKED here — every such-restricted graveyard target
 *  offered every card in the graveyard as clickable regardless of mana value
 *  / excluded type, relying entirely on the server's `selectTarget`
 *  rejection to catch an illegal pick after the fact. */
export function matchesGraveyardTarget(
    card: CardInstance,
    ownerId: string,
    pendingTarget: PendingTarget,
    viewerId: string
): boolean {
    const controllerFilter = pendingTarget.controller ?? "any";
    if (controllerFilter === "you" && ownerId !== viewerId) return false;
    if (controllerFilter === "opponent" && ownerId === viewerId) return false;

    const ownTypes = card.types ?? [];

    const reqTypes = Array.isArray(pendingTarget.targetType)
        ? pendingTarget.targetType
        : [pendingTarget.targetType];
    if (!reqTypes.includes("card")) {
        const cardTypes = reqTypes.filter(
            (t) =>
                t !== "player" &&
                t !== "any" &&
                t !== "spell" &&
                t !== "spell-or-permanent" &&
                t !== "card"
        );
        if (cardTypes.length > 0) {
            if (!cardTypes.some((t) => ownTypes.includes(t))) return false;
        }
    }

    const excludeTypes = pendingTarget.excludeTypes;
    if (excludeTypes && excludeTypes.some((t) => ownTypes.includes(t))) {
        return false;
    }

    const mvFilter = pendingTarget.mvFilter;
    if (mvFilter) {
        const mv = manaValue(getInstanceManaCost(card));
        if (mvFilter.equals !== undefined && mv !== mvFilter.equals) {
            return false;
        }
        if (mvFilter.min !== undefined && mv < mvFilter.min) return false;
        if (mvFilter.max !== undefined && mv > mvFilter.max) return false;
    }

    return true;
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
