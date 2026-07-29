import type { CardInstance, Player } from "~/types/game";
import type {
    CardType,
    EmblemInstance,
    PermanentView,
} from "@convex/cards/types";
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

function toLayerState(
    players: Player[],
    emblems?: EmblemInstance[]
): LayerStateView {
    return {
        players: players.map((p) => ({
            id: p.id,
            battlefield: p.battlefield.map(toPermanentView),
            // Graveyard cards feed graveyard-counting CDAs (Lhurgoyf). Only
            // `.types` is read; the projected client state carries it.
            graveyard: p.graveyard.map((c) => ({
                types: (c.types ?? []) as CardType[],
            })),
            // Hand-size-gated conditions (CR 611.2c, issue #1379 — Carnage
            // Interpreter's "as long as you have one or fewer cards in
            // hand") only need the COUNT. The opponent's hand projects as
            // `(CardInstance | null)[]` (identity hidden, ADR 0026) but the
            // array LENGTH survives unchanged, so this reads identically to
            // the server-side `.hand.length`.
            hand: { length: p.hand.length },
        })),
        // CR 114 (issue #1221) — command-zone emblems contribute source-less,
        // owner-scoped continuous statics (Sorin, Lord of Innistrad's +1/+0
        // anthem). The projected client state carries the top-level `emblems`
        // field unchanged; forwarding it here is what makes an emblem anthem
        // visible client-side (dropping it would recompute P/T without the
        // buff — the classic "reducer drops a field" bug).
        emblems,
    };
}

export function effectivePower(
    allPlayers: Player[],
    card: CardInstance,
    emblems?: EmblemInstance[]
): number {
    return getEffectivePower(
        toLayerState(allPlayers, emblems),
        toPermanentView(card)
    );
}

export function effectiveToughness(
    allPlayers: Player[],
    card: CardInstance,
    emblems?: EmblemInstance[]
): number {
    return getEffectiveToughness(
        toLayerState(allPlayers, emblems),
        toPermanentView(card)
    );
}
