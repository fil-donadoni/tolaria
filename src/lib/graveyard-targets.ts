import type { CardInstance, PendingTarget, Player } from "~/types/game";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import {
    checkCardTargetFilters,
    pickCardFilterValues,
    type TargetFilterCtx,
} from "@convex/gre/targetFilters";

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
 *  `selectTarget` (`convex/game.ts`). Returns true if `card` in the
 *  graveyard owned by `ownerId` satisfies the pending target's requirement.
 *
 *  CR 109.2 / 400.7 — graveyard-zone target. The structural CardType gate
 *  (the pending target's `targetType` minus the non-card tokens, OR
 *  semantics, `"card"` matches any card) is checked directly here — it's the
 *  requirement's own STRUCTURAL `type` field, not a registry filter (ADR
 *  0068's `StructuralKey` list). Every OTHER filter dimension (`controller`,
 *  `mvFilter`, `excludeTypes`, `subtypeFilter`, `excludeSubtypes`,
 *  `colorFilterAny`, and whatever `CARD_FILTER_KEYS` grows next) delegates to
 *  `checkCardTargetFilters` — the SAME registry (`convex/gre/targetFilters.ts`,
 *  ADR 0068) `getLegalTargets` (the offered set) and the `selectTarget`
 *  mutation (the accepted set, `convex/game.ts`) already share, via
 *  `pickCardFilterValues` (issue #1950 review round 2, MINOR 5) so a future
 *  `CARD_FILTER_KEYS` addition is honored here automatically — no
 *  hand-maintained per-dimension mirror to keep in sync. This closes the
 *  BLOCKER 2 defect class: a hand-rolled mirror here previously checked only
 *  `controller`/type/`excludeTypes`/`mvFilter`, so `subtypeFilter` (Lord of
 *  the Undead's "target Zombie card") and `colorFilterAny` (Dreams of the
 *  Dead's "target white or black creature card") were offered as clickable
 *  here while the server's `selectTarget` correctly rejected them — a
 *  client/server split, not merely a CR gap.
 *
 *  `pendingTarget` already carries every filter field PRE-LOWERED
 *  (`PendingTarget`, `convex/gre/state.ts`) — the identical
 *  `CardFilterValues` shape `selectTarget` builds server-side from the very
 *  same object — so this only FORWARDS those fields via `pickCardFilterValues`,
 *  it never re-derives them from a `TargetRequirement`. */
export function matchesGraveyardTarget(
    card: CardInstance,
    ownerId: string,
    pendingTarget: PendingTarget,
    viewerId: string,
    activePlayerId: string
): boolean {
    const ownTypes = card.types ?? [];

    const reqTypes = Array.isArray(pendingTarget.targetType)
        ? pendingTarget.targetType
        : [pendingTarget.targetType];
    // Issue #1950 review round 3, MINOR 5 — copies `selectTarget`'s
    // graveyard-card structural gate (`convex/game.ts`) VERBATIM, including
    // its unconditional rejection when `cardTypes` ends up empty and
    // `"card"` wasn't requested (e.g. a bare `["any"]` requirement) — the
    // server THROWS in that case, so the client must reject too, not fall
    // through to "unrestricted" the way an `if (cardTypes.length > 0)` guard
    // used to. Unreachable across all 37 shipped graveyard requirements
    // today, but it's the one gate that wasn't yet delegated byte-for-byte.
    const wantsAnyCard = reqTypes.includes("card");
    const cardTypes = reqTypes.filter(
        (t) =>
            t !== "player" &&
            t !== "any" &&
            t !== "spell" &&
            t !== "spell-or-permanent" &&
            t !== "card"
    );
    if (!wantsAnyCard && !cardTypes.some((t) => ownTypes.includes(t))) {
        return false;
    }

    // Sound: the wire-projected `CardInstance` is a structural superset of
    // the fields `checkCardTargetFilters`/the layer system read off
    // `CardInstanceState` (the same cast pattern `matchesPermanentTargetFilters`,
    // `card-utils.ts`, uses for a battlefield candidate). The registry's
    // `card`-kind `controller` check reads `candidate.ownerId` (CR 109.3 /
    // 400.7 — a graveyard card's controller-relationship filter is checked
    // against the GRAVEYARD'S OWNER, not a battlefield-only `controllerId`),
    // so it's pinned here to the graveyard we're scanning rather than trusted
    // to already be correct on the wire object.
    const candidate = {
        ...card,
        ownerId,
    } as unknown as CardInstanceState;

    const ctx: TargetFilterCtx = {
        // Minimal `GameState`-shaped view — the registry's `controller`
        // check only needs `chooserId`/`activePlayerId`, never a full board
        // scan, for the card kind.
        state: {} as unknown as GameState,
        sourceColors: [],
        sourceTypes: [],
        sourceSubtypes: [],
        chooserId: viewerId,
        activePlayerId,
    };

    return (
        checkCardTargetFilters(
            ctx,
            candidate,
            pickCardFilterValues(pendingTarget)
        ) === null
    );
}

/** Computes the graveyards (and their legal cards) eligible for the current
 *  graveyard target. Used by the graveyard target dialog (issue #314) to decide
 *  whether to show the graveyard-choice step (≥2 eligible) and which cards to
 *  list. The order places the viewer's own graveyard first. */
export function getEligibleGraveyards(
    pendingTarget: PendingTarget,
    allPlayers: Player[],
    viewerId: string,
    activePlayerId: string
): EligibleGraveyard[] {
    const result: EligibleGraveyard[] = [];
    for (const player of allPlayers) {
        const cards = player.graveyard.filter((c) =>
            matchesGraveyardTarget(
                c,
                player.id,
                pendingTarget,
                viewerId,
                activePlayerId
            )
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
