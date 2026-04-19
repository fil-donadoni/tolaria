import type { CardInstance, Player } from "~/types/game";
import type { CardType, PermanentView } from "@convex/cards/types";
import {
    getEffectivePower,
    getEffectiveToughness,
    type LayerStateView,
} from "@convex/gre/layers";

/**
 * Projects a frontend CardInstance into the PermanentView the layer system expects.
 * `types` is optional on CardInstance (to accommodate placeholders / test fixtures),
 * but always defined at runtime for battlefield cards coming from getPublicState.
 * The widening of string[] → CardType[] is enforced upstream by the server projection.
 */
function toPermanentView(card: CardInstance): PermanentView {
    return {
        id: card.id,
        controllerId: card.controllerId,
        ownerId: card.ownerId,
        types: (card.types ?? []) as CardType[],
        subtypes: card.subtypes ?? [],
        isTapped: card.isTapped,
        power: card.power,
        toughness: card.toughness,
        card: card.card,
    };
}

function toLayerState(players: Player[]): LayerStateView {
    return {
        players: players.map((p) => ({
            battlefield: p.battlefield.map(toPermanentView),
        })),
    };
}

export function effectivePower(
    allPlayers: Player[],
    card: CardInstance
): number {
    return getEffectivePower(toLayerState(allPlayers), toPermanentView(card));
}

export function effectiveToughness(
    allPlayers: Player[],
    card: CardInstance
): number {
    return getEffectiveToughness(
        toLayerState(allPlayers),
        toPermanentView(card)
    );
}
