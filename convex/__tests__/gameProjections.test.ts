import { describe, it, expect } from "vitest";
import { projectFullState, projectPublicState } from "../gameProjections";
import type { CardInstanceState, GameState, PlayerState } from "../gre/state";

function makeCard(
    id: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: "def-" + id, name: "Cardname " + id, manaCost: { R: 1 } },
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
        ...overrides,
    };
}

function makePlayer(
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

function makeState(overrides: Partial<GameState> = {}): GameState {
    const p1 = makePlayer("p1", {
        hand: [makeCard("p1-h1"), makeCard("p1-h2")],
        library: [makeCard("p1-l1", { zone: "library" })],
        battlefield: [makeCard("p1-b1", { zone: "battlefield" })],
    });
    const p2 = makePlayer("p2", {
        hand: [
            makeCard("p2-h1", { controllerId: "p2", ownerId: "p2" }),
            makeCard("p2-h2", { controllerId: "p2", ownerId: "p2" }),
            makeCard("p2-h3", { controllerId: "p2", ownerId: "p2" }),
        ],
        library: [
            makeCard("p2-l1", {
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
            makeCard("p2-l2", {
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
        ],
    });
    return {
        players: [p1, p2],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    };
}

describe("projectPublicState (CR: shape contract)", () => {
    const state = makeState();
    const result = projectPublicState(state, 42, "p1");

    it("includes seq at top level", () => {
        expect(result.seq).toBe(42);
    });

    it("reduces own library to { count } (not an array)", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        expect(Array.isArray(me.library)).toBe(false);
        expect(me.library).toEqual({ count: 1 });
    });

    it("reduces opponent library to { count } (not an array)", () => {
        const opp = result.players.find((p) => p.id === "p2")!;
        expect(Array.isArray(opp.library)).toBe(false);
        expect(opp.library).toEqual({ count: 2 });
    });

    it("keeps own hand as array of slim cards with legalActions", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        expect(me.hand).toHaveLength(2);
        for (const card of me.hand) {
            expect(card).not.toBeNull();
            expect(card!.legalActions).toBeDefined();
            expect(Array.isArray(card!.legalActions)).toBe(true);
        }
    });

    it("nulls every opponent hand slot but preserves length", () => {
        const opp = result.players.find((p) => p.id === "p2")!;
        expect(opp.hand).toHaveLength(3);
        expect(opp.hand.every((c) => c === null)).toBe(true);
    });

    it("slims every card.card to { id } only (drops name, manaCost, …)", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        for (const card of me.hand) {
            expect(Object.keys(card!.card)).toEqual(["id"]);
        }
        for (const card of me.battlefield) {
            expect(Object.keys(card.card)).toEqual(["id"]);
        }
    });

    it("projects battlefield, graveyard, exile as arrays", () => {
        const me = result.players.find((p) => p.id === "p1")!;
        expect(Array.isArray(me.battlefield)).toBe(true);
        expect(Array.isArray(me.graveyard)).toBe(true);
        expect(Array.isArray(me.exile)).toBe(true);
    });
});

describe("projectFullState (CR: debug contract)", () => {
    const state = makeState();
    const result = projectFullState(state, 7);

    it("includes seq at top level", () => {
        expect(result.seq).toBe(7);
    });

    it("keeps every library as array (no { count } collapsing)", () => {
        for (const player of result.players) {
            expect(Array.isArray(player.library)).toBe(true);
        }
    });

    it("computes legalActions for every hand card of every player", () => {
        for (const player of result.players) {
            for (const card of player.hand) {
                expect(card.legalActions).toBeDefined();
                expect(Array.isArray(card.legalActions)).toBe(true);
            }
        }
    });

    it("slims card defs across all zones (hand, library, battlefield, graveyard, exile, stack)", () => {
        for (const player of result.players) {
            for (const card of [
                ...player.hand,
                ...player.library,
                ...player.battlefield,
                ...player.graveyard,
                ...player.exile,
            ]) {
                expect(Object.keys(card.card)).toEqual(["id"]);
            }
        }
        for (const item of result.stack) {
            expect(Object.keys(item.card)).toEqual(["id"]);
        }
    });
});

describe("projectPublicState legal actions timing", () => {
    it("yields 'cast' on a Creature in main phase with empty stack", () => {
        const state = makeState();
        const result = projectPublicState(state, 1, "p1");
        const me = result.players.find((p) => p.id === "p1")!;
        expect(me.hand[0]!.legalActions).toContain("cast");
    });

    it("returns all debug actions when allActions=true", () => {
        const state = makeState();
        const result = projectPublicState(state, 1, "p1", true);
        const me = result.players.find((p) => p.id === "p1")!;
        expect(me.hand[0]!.legalActions.length).toBeGreaterThan(1);
    });
});
