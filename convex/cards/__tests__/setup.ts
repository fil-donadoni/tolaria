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

/** Builds a CardInstanceState from a registered card id. Honors overrides.
 *  `card.card` keeps the same fat shape the engine produces (name + manaCost
 *  etc.) — the projection is responsible for slimming. */
export function makeInstance(
    cardId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    const def = getCardById(cardId);
    return {
        id:
            overrides.id ??
            `inst-${cardId.slice(0, 6)}-${crypto.randomUUID().slice(0, 8)}`,
        card: {
            id: def.id,
            name: def.name,
            manaCost: def.manaCost,
            supertypes: def.supertypes,
        },
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
        deck: {},
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
    return {
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
