// Regression suite for the slim card shape ({card: {id}} — no embedded def
// fields). The pre-existing rules.test.ts inlines fat synthetic cards
// (`{name, manaCost, types, ...}`), so it accidentally exercises a code path
// that production no longer hits: `card.card.manaCost` reads succeed in tests
// but yield `undefined` in production. Production must go through
// `getInstanceManaCost` / `getCardById`, and these tests prove it does by
// constructing instances via `makeInstance(cardId)` (registry-backed slim).

import { describe, expect, it } from "vitest";
import { getLegalActions } from "../rules";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    elvishArchers,
    lightningBolt,
    savannahLions,
} from "../../cards/sets/lea";
import type { GameState, PlayerState, StackItem } from "../state";

function withTurnOf(state: GameState, playerId: string): GameState {
    return {
        ...state,
        activePlayerId: playerId,
        priorityPlayerId: playerId,
    };
}

describe("cast legality on slim card shape", () => {
    it("Elvish Archers is NOT castable without any mana (CR 601.2f)", () => {
        const card = makeInstance(elvishArchers.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [card],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        const actions = getLegalActions(state, player, card);
        expect(actions).not.toContain("cast");
    });

    it("Elvish Archers IS castable with GG in the pool", () => {
        const card = makeInstance(elvishArchers.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const player = makePlayer("p1", {
            hand: [card],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 },
        });
        const state = withTurnOf(makeState({ players: [player] }), "p1");

        const actions = getLegalActions(state, player, card);
        expect(actions).toContain("cast");
    });

    it("Elvish Archers is NOT castable during the opponent's main phase (CR 307.1)", () => {
        const card = makeInstance(elvishArchers.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [card],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 5, C: 0 },
        });
        const p2 = makePlayer("p2");
        const state = withTurnOf(makeState({ players: [p1, p2] }), "p2");

        const actions = getLegalActions(state, p1, card);
        expect(actions).not.toContain("cast");
    });

    it("Savannah Lions (sorcery-timing creature) blocked while stack non-empty (CR 307.1)", () => {
        const lions = makeInstance(savannahLions.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const stackBolt: StackItem = {
            ...makeInstance(lightningBolt.id, {
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
        };
        const player: PlayerState = makePlayer("p1", {
            hand: [lions],
            manaPool: { W: 5, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = withTurnOf(
            makeState({ players: [player], stack: [stackBolt] }),
            "p1"
        );

        const actions = getLegalActions(state, player, lions);
        expect(actions).not.toContain("cast");
    });

    it("Lightning Bolt (instant) castable on opponent turn with priority (CR 117.1, 304.1)", () => {
        const bolt = makeInstance(lightningBolt.id, {
            controllerId: "p1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [bolt],
            manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2");
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p2",
            priorityPlayerId: "p1",
        });

        const actions = getLegalActions(state, p1, bolt);
        expect(actions).toContain("cast");
    });
});
