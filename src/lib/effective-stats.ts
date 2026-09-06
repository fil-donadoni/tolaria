import type { CardInstance } from "~/types/game";
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
import type { ContinuousEffect } from "@convex/gre/continuousEffects";

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

/** The minimum player shape the layer projection reads: id, battlefield, the
 *  graveyard's card TYPES and the hand's SIZE. Deliberately wider than
 *  `Player[]` so a caller holding a narrower structural player list —
 *  `buildTriggerStateView`'s, which is the crew/affordability hint's input —
 *  can feed the SAME computation instead of re-deriving P/T off base `power`
 *  (the hint-vs-server divergence class). `Player[]` is assignable to it. */
export type LayerPlayersInput = ReadonlyArray<{
    id: string;
    battlefield: ReadonlyArray<CardInstance>;
    graveyard?: ReadonlyArray<CardInstance>;
    hand: ReadonlyArray<unknown>;
}>;

function toLayerState(
    players: LayerPlayersInput,
    emblems: EmblemInstance[] | undefined,
    continuousEffects: readonly ContinuousEffect[] | undefined
): LayerStateView {
    return {
        players: players.map((p) => ({
            id: p.id,
            battlefield: p.battlefield.map(toPermanentView),
            // Graveyard cards feed graveyard-counting CDAs (Lhurgoyf). Only
            // `.types` is read; the projected client state carries it.
            graveyard: (p.graveyard ?? []).map((c) => ({
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
        // CR 613 (ADR 0082, PRD #2064 S6) — the Continuous Effects Registry,
        // forwarded from the wire `GameState.continuousEffects`. Layer 7's
        // until-boundary modifications (a Giant Growth pump, a "base power 0
        // until end of turn" set) are ENTRIES since S6, so a walk that does not
        // receive this field recomputes P/T without them and the pump is
        // invisible on the board while the server counts it. That is why the
        // parameter is REQUIRED at every call site rather than optional like
        // `emblems`: this is the exact reducer-drops-a-field class the doc
        // comment above is about, and `tsc` is the only thing that can make
        // forgetting it impossible.
        continuousEffects,
    };
}

export function effectivePower(
    allPlayers: LayerPlayersInput,
    card: CardInstance,
    emblems: EmblemInstance[] | undefined,
    continuousEffects: readonly ContinuousEffect[] | undefined
): number {
    return getEffectivePower(
        toLayerState(allPlayers, emblems, continuousEffects),
        toPermanentView(card)
    );
}

export function effectiveToughness(
    allPlayers: LayerPlayersInput,
    card: CardInstance,
    emblems: EmblemInstance[] | undefined,
    continuousEffects: readonly ContinuousEffect[] | undefined
): number {
    return getEffectiveToughness(
        toLayerState(allPlayers, emblems, continuousEffects),
        toPermanentView(card)
    );
}
