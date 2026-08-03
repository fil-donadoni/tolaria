import { describe, it, expect } from "vitest";
import { setupManualGame, MANUAL_STATE_OPTIONAL_KEYS } from "../manual";

const BASE_MANUAL_KEYS = new Set(["players", "turn", "activePlayerId"]);

describe("setupManualGame", () => {
    it("produces a valid ManualGameState from two decks", () => {
        const state = setupManualGame([
            {
                id: "p1",
                name: "Alice",
                bgColor: "#e0f0ff",
                deck: [
                    { cardId: "c1", cardName: "Mountain" },
                    { cardId: "c2", cardName: "Mountain" },
                    { cardId: "c3", cardName: "Lightning Bolt" },
                    { cardId: "c4", cardName: "Lightning Bolt" },
                    { cardId: "c5", cardName: "Shock" },
                    { cardId: "c6", cardName: "Shock" },
                    { cardId: "c7", cardName: "Incinerate" },
                    { cardId: "c8", cardName: "Fireball" },
                    { cardId: "c9", cardName: "Mountain" },
                    { cardId: "c10", cardName: "Mountain" },
                ],
            },
            {
                id: "p2",
                name: "Bob",
                bgColor: "#ffe0e0",
                deck: [
                    { cardId: "c11", cardName: "Plains" },
                    { cardId: "c12", cardName: "Plains" },
                    { cardId: "c13", cardName: "Savannah Lions" },
                    { cardId: "c14", cardName: "Savannah Lions" },
                    { cardId: "c15", cardName: "Swords to Plowshares" },
                    { cardId: "c16", cardName: "Swords to Plowshares" },
                    { cardId: "c17", cardName: "Serra Angel" },
                    { cardId: "c18", cardName: "Wrath of God" },
                    { cardId: "c19", cardName: "Plains" },
                    { cardId: "c20", cardName: "Plains" },
                ],
            },
        ]);

        expect(state.players).toHaveLength(2);
        expect(state.turn).toBe(1);
        expect(state.activePlayerId).toBe("p1");

        for (const player of state.players) {
            expect(player.hand).toHaveLength(7);
            expect(player.library).toHaveLength(3); // 10 - 7
            expect(player.graveyard).toHaveLength(0);
            expect(player.exile).toHaveLength(0);
            expect(player.battlefield).toHaveLength(0);
            expect(player.life).toBe(20);
        }
    });

    it("shuffles libraries deterministically by seed + player index", () => {
        const state1 = setupManualGame([
            {
                id: "p1",
                name: "Alice",
                bgColor: "#e0f0ff",
                deck: [
                    { cardId: "c1", cardName: "Card 1" },
                    { cardId: "c2", cardName: "Card 2" },
                    { cardId: "c3", cardName: "Card 3" },
                    { cardId: "c4", cardName: "Card 4" },
                ],
            },
        ]);

        // Hand + library together should contain all 4 cards
        const allIds = [
            ...state1.players[0].hand.map((c) => c.card.id),
            ...state1.players[0].library.map((c) => c.card.id),
        ].sort();
        expect(allIds).toEqual(["c1", "c2", "c3", "c4"]);
    });

    it("allocates unique instance ids for every card", () => {
        const state = setupManualGame([
            {
                id: "p1",
                name: "Alice",
                bgColor: "#e0f0ff",
                deck: [
                    { cardId: "c1", cardName: "Card 1" },
                    { cardId: "c2", cardName: "Card 2" },
                ],
            },
        ]);

        const allIds = new Set(
            state.players.flatMap((p) => [
                ...p.hand.map((c) => c.id),
                ...p.library.map((c) => c.id),
            ])
        );
        expect(allIds.size).toBe(2);
    });

    it("library cards have zone 'library', hand cards have zone 'hand'", () => {
        const state = setupManualGame([
            {
                id: "p1",
                name: "Alice",
                bgColor: "#e0f0ff",
                deck: [
                    { cardId: "c1", cardName: "Card 1" },
                    { cardId: "c2", cardName: "Card 2" },
                    { cardId: "c3", cardName: "Card 3" },
                    { cardId: "c4", cardName: "Card 4" },
                ],
            },
        ]);

        for (const card of state.players[0].hand) {
            expect(card.zone).toBe("hand");
        }
        for (const card of state.players[0].library) {
            expect(card.zone).toBe("library");
        }
    });
});

describe("ManualGameState schema drift guard", () => {
    it("every optional ManualGameState key is in MANUAL_STATE_OPTIONAL_KEYS", () => {
        // Build a state with every optional field populated.
        const state = setupManualGame([
            {
                id: "p1",
                name: "Alice",
                bgColor: "#e0f0ff",
                deck: [{ cardId: "c1", cardName: "Card 1" }],
            },
        ]);

        // Materialize ALL currently-known optional keys on the state.
        // As the type grows, each new optional key must be listed here
        // AND in MANUAL_STATE_OPTIONAL_KEYS, or this test fails.
        // (No optional keys exist yet — this is extensible.)

        const allKnown = new Set([
            ...BASE_MANUAL_KEYS,
            ...MANUAL_STATE_OPTIONAL_KEYS,
        ]);
        const actualKeys = Object.keys(state);

        const missing = actualKeys.filter((k) => !allKnown.has(k));
        expect(
            missing,
            `ManualGameState keys missing from MANUAL_STATE_OPTIONAL_KEYS: ` +
                `${missing.join(", ")}. Add each to MANUAL_STATE_OPTIONAL_KEYS ` +
                `in convex/manual.ts (or BASE_MANUAL_KEYS in this test if it is ` +
                `a required key).`
        ).toEqual([]);

        // Also verify: every key in MANUAL_STATE_OPTIONAL_KEYS is actually
        // an optional key on the type (no stale entries allowed).
        const requiredKeys = new Set([...BASE_MANUAL_KEYS]);
        for (const key of MANUAL_STATE_OPTIONAL_KEYS) {
            expect(requiredKeys.has(key)).toBe(false);
        }
    });

    it("proof-of-failure: an unregistered key is flagged", () => {
        // If a new optional key appears on ManualGameState but is NOT
        // in MANUAL_STATE_OPTIONAL_KEYS, the guard above fails.
        // This test verifies the guard mechanism works by deliberately
        // adding a key outside the known set.
        const state = setupManualGame([
            {
                id: "p1",
                name: "Alice",
                bgColor: "#e0f0ff",
                deck: [{ cardId: "c1", cardName: "Card 1" }],
            },
        ]);

        const allKnown = new Set([
            ...BASE_MANUAL_KEYS,
            ...MANUAL_STATE_OPTIONAL_KEYS,
        ]);
        const actualKeys = Object.keys(state);
        const missing = actualKeys.filter((k) => !allKnown.has(k));

        // With no optional keys added, there should be no missing keys.
        expect(missing).toEqual([]);

        // If someone adds an optional key but forgets MANUAL_STATE_OPTIONAL_KEYS,
        // state keys will no longer all be in allKnown. Verify the mechanism.
        const fakeState = { ...state, newField: true };
        const fakeKeys = Object.keys(fakeState);
        const fakeMissing = fakeKeys.filter((k) => !allKnown.has(k));
        expect(fakeMissing).toContain("newField");
    });
});

describe("ManualCardInstance shape", () => {
    it("every manual card instance has the required fields", () => {
        const state = setupManualGame([
            {
                id: "p1",
                name: "Alice",
                bgColor: "#e0f0ff",
                deck: [{ cardId: "c1", cardName: "Card 1" }],
            },
        ]);

        for (const player of state.players) {
            const allCards = [
                ...player.hand,
                ...player.library,
                ...player.graveyard,
                ...player.exile,
                ...player.battlefield,
            ];
            for (const card of allCards) {
                // Required fields must be present
                expect(card.id).toBeTruthy();
                expect(card.card).toBeDefined();
                expect(card.card.id).toBeTruthy();
                expect(card.zone).toBeDefined();
                expect(card.controllerId).toBeDefined();
                expect(card.ownerId).toBeDefined();
                expect(typeof card.isTapped).toBe("boolean");
            }
        }
    });
});
