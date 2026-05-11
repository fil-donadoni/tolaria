import { describe, expect, it } from "vitest";
import { compactState, expandState } from "../serialize";
import type { GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import {
    lightningBolt,
    mountain,
    plains,
    savannahLions,
} from "../../cards/sets/lea";

function freshState(): GameState {
    const p1 = makePlayer("p1", {
        library: [
            makeInstance(mountain.id, { controllerId: "p1", zone: "library" }),
            makeInstance(mountain.id, { controllerId: "p1", zone: "library" }),
            makeInstance(lightningBolt.id, {
                controllerId: "p1",
                zone: "library",
            }),
        ],
        hand: [
            makeInstance(lightningBolt.id, {
                controllerId: "p1",
                zone: "hand",
            }),
        ],
    });
    const p2 = makePlayer("p2", {
        library: [
            makeInstance(plains.id, { controllerId: "p2", zone: "library" }),
        ],
        battlefield: [
            makeInstance(savannahLions.id, {
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
                isTapped: false,
            }),
        ],
    });
    return makeState({ players: [p1, p2] });
}

describe("game_state serialize round-trip", () => {
    it("re-expands a fresh state to a deeply-equal GameState", () => {
        const state = freshState();
        const compact = compactState(state);
        const expanded = expandState(compact);
        expect(expanded).toEqual(state);
    });

    it("preserves non-default battlefield flags", () => {
        const state = freshState();
        const lion = state.players[1].battlefield[0];
        lion.isTapped = true;
        lion.isSummoningSick = true;
        lion.damageMarked = 1;
        lion.counters = { "+1/+1": 2 };
        const expanded = expandState(compactState(state));
        const got = expanded.players[1].battlefield[0];
        expect(got.isTapped).toBe(true);
        expect(got.isSummoningSick).toBe(true);
        expect(got.damageMarked).toBe(1);
        expect(got.counters).toEqual({ "+1/+1": 2 });
    });

    it("preserves a non-zero mana pool", () => {
        const state = freshState();
        state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 3, G: 1, C: 0 };
        const expanded = expandState(compactState(state));
        expect(expanded.players[0].manaPool).toEqual({
            W: 0,
            U: 0,
            B: 0,
            R: 3,
            G: 1,
            C: 0,
        });
    });

    it("preserves stack items with cast metadata", () => {
        const state = freshState();
        const bolt = state.players[0].hand[0];
        state.stack = [
            {
                ...bolt,
                zone: "stack",
                castById: "p1",
                chosenX: 0,
                targets: [{ type: "player", id: "p2" }],
            },
        ];
        const expanded = expandState(compactState(state));
        expect(expanded.stack).toHaveLength(1);
        const top = expanded.stack[0];
        expect(top.castById).toBe("p1");
        expect(top.chosenX).toBe(0);
        expect(top.targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("library entries derive owner/controller/zone implicitly", () => {
        const state = freshState();
        const compact = compactState(state);
        const lib = (compact.players as Array<Record<string, unknown>>)[0]
            .library as Array<[string, string]>;
        expect(Array.isArray(lib[0])).toBe(true);
        expect(lib[0]).toHaveLength(2);
        const expanded = expandState(compact);
        for (const card of expanded.players[0].library) {
            expect(card.controllerId).toBe("p1");
            expect(card.ownerId).toBe("p1");
            expect(card.zone).toBe("library");
            expect(card.isTapped).toBe(false);
        }
    });

    it("compact form is materially smaller than raw JSON", () => {
        const state = freshState();
        const rawSize = JSON.stringify(state).length;
        const compactSize = JSON.stringify(compactState(state)).length;
        expect(compactSize).toBeLessThan(rawSize * 0.7);
    });
});
