// Shared fixtures for card behavior tests. Keep this tight: fixtures only,
// no production logic. See `convex/cards/sets/__tests__/<set>.test.ts` for
// the testing convention (one describe per card, GRE + wire format).

import { getCardById } from "..";
import type { Phase } from "../../gre/types";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
    StackItem,
} from "../../gre/state";
import {
    assertExpectedInputCoherent,
    refreshExpectedInput,
} from "../../gre/expectedInput";

/** Builds a CardInstanceState from a registered card id. Honors overrides.
 *  The engine persists only the slim `{ id }` reference in `card.card`;
 *  definitions are hydrated server- and client-side from the in-memory
 *  registry via `getCardById`. */
export function makeInstance(
    cardId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    const def = getCardById(cardId);
    return {
        id:
            overrides.id ??
            `inst-${cardId.slice(0, 6)}-${crypto.randomUUID().slice(0, 8)}`,
        card: { id: def.id },
        types: def.types,
        subtypes: def.subtypes ?? [],
        power: def.power,
        toughness: def.toughness,
        staticAbilities: def.staticAbilities ?? [],
        controllerId: overrides.controllerId ?? "p1",
        ownerId: overrides.ownerId ?? overrides.controllerId ?? "p1",
        zone: overrides.zone ?? "battlefield",
        isTapped: false,
        ...overrides,
    };
}

export function makePlayer(
    id: string,
    overrides: Partial<PlayerState> = {}
): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

export function makeState(overrides: Partial<GameState> = {}): GameState {
    const state: GameState = {
        players: [makePlayer("p1"), makePlayer("p2")],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN" as Phase,
        rngSeed: 0,
        rngCounter: 0,
        ...overrides,
    };
    // ADR 0047 — maintain the authoritative Expected Input on every
    // fixture-built state, then assert the coherence invariant. We ALWAYS
    // recompute (overwriting any value carried in via an override spread of a
    // post-mutation state, e.g. `makeState({ ...state })` — the engine only
    // maintains the field at the persistence seam, so a spread can carry a
    // stale value). Wiring this into the shared fixture means every test that
    // builds a scenario exercises `computeExpectedInput` over its pending* /
    // combat / priority shape for free and stays green.
    refreshExpectedInput(state);
    assertExpectedInputCoherent(state);
    return state;
}

/** Pushes a spell onto the stack as if it had just been legally cast. `ownerId`
 *  defaults to `castById` (owner = caster) so graveyard assignments work. */
export function pushSpell(
    state: GameState,
    cardId: string,
    castById: string,
    targets: StackItem["targets"] = []
): StackItem {
    const item: StackItem = {
        ...makeInstance(cardId, {
            controllerId: castById,
            ownerId: castById,
            zone: "hand",
        }),
        castById,
        targets,
    };
    state.stack.push(item);
    return item;
}
