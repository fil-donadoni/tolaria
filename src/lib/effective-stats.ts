import type { CardInstance, Player } from "~/types/game";
import type { CardType, PermanentView } from "@convex/cards/types";
import {
    getEffectivePower,
    getEffectiveToughness,
    type LayerStateView,
} from "@convex/gre/layers";

/**
 * Projects a frontend CardInstance into the PermanentView the layer system expects.
 *
 * Spread-based forwarding by design: every CardInstance field reaches the
 * predicate/layer compute unchanged at runtime. We only narrow `types` /
 * `subtypes` because they're optional on CardInstance (placeholders / test
 * fixtures) but required on PermanentView; battlefield cards from the server
 * projection always carry them. NEVER replace this with an explicit
 * enumeration — that's the regression class that silently dropped
 * `attachedTo` / `temporaryPTMods` / `counters` and broke aura buffs / pump
 * activations on the client (see effective-stats.test.ts "wire-format
 * invariant").
 */
function toPermanentView(card: CardInstance): PermanentView {
    return {
        ...card,
        types: (card.types ?? []) as CardType[],
        subtypes: card.subtypes ?? [],
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
