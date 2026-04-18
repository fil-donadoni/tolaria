import type { CardInstance, Player } from "~/types/game";
import type { CardInstanceState, GameState } from "@convex/gre/state";
import { getEffectivePower, getEffectiveToughness } from "@convex/gre/layers";

// The layer-system helpers read a minimal subset of GameState/CardInstanceState
// (players[].battlefield[].{id, controllerId, isTapped, types, card.id, power, toughness}).
// Frontend types are structurally compatible; cast is safe for this read-only path.
function asState(allPlayers: Player[]): GameState {
    return { players: allPlayers } as unknown as GameState;
}

function asCard(card: CardInstance): CardInstanceState {
    return card as unknown as CardInstanceState;
}

export function effectivePower(
    allPlayers: Player[],
    card: CardInstance
): number {
    return getEffectivePower(asState(allPlayers), asCard(card));
}

export function effectiveToughness(
    allPlayers: Player[],
    card: CardInstance
): number {
    return getEffectiveToughness(asState(allPlayers), asCard(card));
}
