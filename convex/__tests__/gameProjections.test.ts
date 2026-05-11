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
        // Ample default pool so projection tests aren't gated by canCast's
        // mana check (CR 601.2f). Tests focused on payment cover that path.
        manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
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
        rngSeed: 0,
        rngCounter: 0,
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

// Wire-format invariant: every transient field on a battlefield permanent
// must reach the client through projectPublicState / projectFullState.
// `slimCard` uses spread, so this is also a regression guard against any
// future refactor replacing the spread with explicit enumeration (the same
// class of bug that broke aura/pump P/T display through toPermanentView).
describe("projection forwards every transient battlefield field", () => {
    function stateWithEnrichedPermanent(): GameState {
        const enriched = makeCard("p1-b1", {
            zone: "battlefield",
            isTapped: true,
            isToken: true,
            isSummoningSick: true,
            isAttacking: true,
            isBlocking: true,
            hasAttackedThisTurn: true,
            hasBlockedThisTurn: true,
            manaCommitted: true,
            damageMarked: 2,
            regenerationShields: 1,
            chosenMana: { R: 1 },
            attachedTo: "host-id",
            temporaryPTMods: [
                { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
            ],
            counters: { "+1/+1": 1, "+1/+0": 2 },
            grantedStaticAbilities: [{ ability: "flying", auraId: "aura-1" }],
            grantedActivatedAbilities: [
                {
                    sourceCardId: "src",
                    abilityId: "ability",
                    auraId: "aura-1",
                },
            ],
            damagedBySources: ["bolt-1", "bolt-2"],
            controlChanges: [{ auraId: "aura-1", previousControllerId: "p1" }],
        });
        const p1 = makePlayer("p1", { battlefield: [enriched] });
        const p2 = makePlayer("p2");
        return {
            players: [p1, p2],
            stack: [],
            turn: 1,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            passCount: 0,
            phase: "PRECOMBAT_MAIN",
            rngSeed: 0,
            rngCounter: 0,
        };
    }

    it("projectPublicState preserves every transient field on slim cards", () => {
        const result = projectPublicState(
            stateWithEnrichedPermanent(),
            1,
            "p1"
        );
        const me = result.players.find((p) => p.id === "p1")!;
        const card = me.battlefield[0];
        expect(card.isTapped).toBe(true);
        expect(card.isToken).toBe(true);
        expect(card.isSummoningSick).toBe(true);
        expect(card.isAttacking).toBe(true);
        expect(card.isBlocking).toBe(true);
        expect(card.hasAttackedThisTurn).toBe(true);
        expect(card.hasBlockedThisTurn).toBe(true);
        expect(card.manaCommitted).toBe(true);
        expect(card.damageMarked).toBe(2);
        expect(card.regenerationShields).toBe(1);
        expect(card.chosenMana).toEqual({ R: 1 });
        expect(card.attachedTo).toBe("host-id");
        expect(card.temporaryPTMods).toEqual([
            { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
        ]);
        expect(card.counters).toEqual({ "+1/+1": 1, "+1/+0": 2 });
        expect(card.grantedStaticAbilities).toEqual([
            { ability: "flying", auraId: "aura-1" },
        ]);
        expect(card.grantedActivatedAbilities).toEqual([
            { sourceCardId: "src", abilityId: "ability", auraId: "aura-1" },
        ]);
        expect(card.damagedBySources).toEqual(["bolt-1", "bolt-2"]);
        expect(card.controlChanges).toEqual([
            { auraId: "aura-1", previousControllerId: "p1" },
        ]);
    });

    it("projectFullState preserves every transient field on slim cards", () => {
        const result = projectFullState(stateWithEnrichedPermanent(), 1);
        const me = result.players.find((p) => p.id === "p1")!;
        const card = me.battlefield[0];
        expect(card.attachedTo).toBe("host-id");
        expect(card.temporaryPTMods).toEqual([
            { power: 1, toughness: 0, duration: { phase: "end-of-turn" } },
        ]);
        expect(card.counters).toEqual({ "+1/+1": 1, "+1/+0": 2 });
        expect(card.hasAttackedThisTurn).toBe(true);
        expect(card.hasBlockedThisTurn).toBe(true);
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
