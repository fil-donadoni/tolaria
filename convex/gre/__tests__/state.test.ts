import { describe, it, expect } from "vitest";
import {
    getBasicLandMana,
    getPlayer,
    getOpponentId,
    moveCard,
    removeFromZone,
    isManaCostCovered,
    normalizeManaCost,
    payManaCost,
    resolveTopOfStack,
    type CardInstanceState,
    type PlayerState,
    type GameState,
    type StackItem,
} from "../state";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: overrides.card ?? { name: "Test Card", types: ["Creature"] },
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        isTapped: false,
        ...overrides,
    };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
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

function makeGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        players: [makePlayer({ id: "p1" }), makePlayer({ id: "p2" })],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// getBasicLandMana — CR 305.6
// Each basic land subtype has an intrinsic mana ability.
// ---------------------------------------------------------------------------

describe("getBasicLandMana", () => {
    it("Plains produces W", () => {
        const card = makeCard({
            card: { name: "Plains", types: ["Land"], subtypes: ["Plains"] },
        });
        expect(getBasicLandMana(card)).toBe("W");
    });

    it("Island produces U", () => {
        const card = makeCard({
            card: { name: "Island", types: ["Land"], subtypes: ["Island"] },
        });
        expect(getBasicLandMana(card)).toBe("U");
    });

    it("Swamp produces B", () => {
        const card = makeCard({
            card: { name: "Swamp", types: ["Land"], subtypes: ["Swamp"] },
        });
        expect(getBasicLandMana(card)).toBe("B");
    });

    it("Mountain produces R", () => {
        const card = makeCard({
            card: { name: "Mountain", types: ["Land"], subtypes: ["Mountain"] },
        });
        expect(getBasicLandMana(card)).toBe("R");
    });

    it("Forest produces G", () => {
        const card = makeCard({
            card: { name: "Forest", types: ["Land"], subtypes: ["Forest"] },
        });
        expect(getBasicLandMana(card)).toBe("G");
    });

    it("dual land returns first matching color (CR 305.6 — each subtype grants its own ability)", () => {
        // Tundra has Plains and Island subtypes
        const card = makeCard({
            card: {
                name: "Tundra",
                types: ["Land"],
                subtypes: ["Plains", "Island"],
            },
        });
        // Current implementation returns the first match
        expect(getBasicLandMana(card)).toBe("W");
    });

    it("returns null for land without basic land subtype", () => {
        // e.g. Mishra's Factory — an artifact land with no basic subtypes
        const card = makeCard({
            card: { name: "Mishra's Factory", types: ["Land"], subtypes: [] },
        });
        expect(getBasicLandMana(card)).toBeNull();
    });

    it("returns null for non-land card", () => {
        const card = makeCard({
            card: { name: "Lightning Bolt", types: ["Instant"] },
        });
        expect(getBasicLandMana(card)).toBeNull();
    });

    it("returns null when subtypes is missing", () => {
        const card = makeCard({
            card: { name: "Some Land", types: ["Land"] },
        });
        expect(getBasicLandMana(card)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getPlayer
// ---------------------------------------------------------------------------

describe("getPlayer", () => {
    it("returns the matching player", () => {
        const state = makeGameState();
        const player = getPlayer(state, "p1");
        expect(player.id).toBe("p1");
    });

    it("throws if player not found", () => {
        const state = makeGameState();
        expect(() => getPlayer(state, "nonexistent")).toThrow(
            "Player not found: nonexistent"
        );
    });
});

// ---------------------------------------------------------------------------
// getOpponentId
// ---------------------------------------------------------------------------

describe("getOpponentId", () => {
    it("returns the other player's id", () => {
        const state = makeGameState();
        expect(getOpponentId(state, "p1")).toBe("p2");
        expect(getOpponentId(state, "p2")).toBe("p1");
    });
});

// ---------------------------------------------------------------------------
// moveCard — zone transitions
// ---------------------------------------------------------------------------

describe("moveCard", () => {
    it("moves a card from hand to battlefield", () => {
        const card = makeCard({ zone: "hand" });
        const player = makePlayer({ hand: [card] });

        const moved = moveCard(player, card.id, "hand", "battlefield");

        expect(player.hand).toHaveLength(0);
        expect(player.battlefield).toHaveLength(1);
        expect(moved.zone).toBe("battlefield");
        expect(moved.id).toBe(card.id);
    });

    it("moves a card from library to hand (draw)", () => {
        const card = makeCard({ zone: "library" });
        const player = makePlayer({ library: [card] });

        moveCard(player, card.id, "library", "hand");

        expect(player.library).toHaveLength(0);
        expect(player.hand).toHaveLength(1);
        expect(player.hand[0].zone).toBe("hand");
    });

    it("moves a card from library to graveyard (mill)", () => {
        const card = makeCard({ zone: "library" });
        const player = makePlayer({ library: [card] });

        moveCard(player, card.id, "library", "graveyard");

        expect(player.library).toHaveLength(0);
        expect(player.graveyard).toHaveLength(1);
        expect(player.graveyard[0].zone).toBe("graveyard");
    });

    it("moves a card from battlefield to graveyard (destroy)", () => {
        const card = makeCard({ zone: "battlefield" });
        const player = makePlayer({ battlefield: [card] });

        moveCard(player, card.id, "battlefield", "graveyard");

        expect(player.battlefield).toHaveLength(0);
        expect(player.graveyard).toHaveLength(1);
    });

    it("moves a card from library to exile", () => {
        const card = makeCard({ zone: "library" });
        const player = makePlayer({ library: [card] });

        moveCard(player, card.id, "library", "exile");

        expect(player.library).toHaveLength(0);
        expect(player.exile).toHaveLength(1);
        expect(player.exile[0].zone).toBe("exile");
    });

    it("throws when card is not in the source zone", () => {
        const card = makeCard({ zone: "hand" });
        const player = makePlayer({ hand: [card] });

        expect(() =>
            moveCard(player, card.id, "battlefield", "graveyard")
        ).toThrow(`Card ${card.id} not found in battlefield`);
    });

    it("throws when card id does not exist", () => {
        const player = makePlayer({ hand: [] });
        expect(() =>
            moveCard(player, "nonexistent", "hand", "battlefield")
        ).toThrow("Card nonexistent not found in hand");
    });

    it("preserves other cards in source zone", () => {
        const card1 = makeCard({ id: "c1", zone: "hand" });
        const card2 = makeCard({ id: "c2", zone: "hand" });
        const card3 = makeCard({ id: "c3", zone: "hand" });
        const player = makePlayer({ hand: [card1, card2, card3] });

        moveCard(player, "c2", "hand", "battlefield");

        expect(player.hand).toHaveLength(2);
        expect(player.hand.map((c) => c.id)).toEqual(["c1", "c3"]);
        expect(player.battlefield).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// removeFromZone — for casting to stack
// ---------------------------------------------------------------------------

describe("removeFromZone", () => {
    it("removes card from hand and sets zone to stack", () => {
        const card = makeCard({ zone: "hand" });
        const player = makePlayer({ hand: [card] });

        const removed = removeFromZone(player, card.id, "hand");

        expect(player.hand).toHaveLength(0);
        expect(removed.zone).toBe("stack");
        expect(removed.id).toBe(card.id);
    });

    it("throws when card not found", () => {
        const player = makePlayer();
        expect(() => removeFromZone(player, "nope", "hand")).toThrow(
            "Card nope not found in hand"
        );
    });
});

// ---------------------------------------------------------------------------
// normalizeManaCost
// ---------------------------------------------------------------------------

describe("normalizeManaCost", () => {
    it("converts ManaCost to pure numeric record", () => {
        expect(normalizeManaCost({ X: 3, W: 1 })).toEqual({ X: 3, W: 1 });
    });

    it("drops zero values", () => {
        expect(normalizeManaCost({ W: 0, U: 1 })).toEqual({ U: 1 });
    });

    it("treats string X as 0", () => {
        expect(normalizeManaCost({ X: "any" as unknown as number })).toEqual(
            {}
        );
    });

    it("returns empty for empty cost", () => {
        expect(normalizeManaCost({})).toEqual({});
    });
});

// ---------------------------------------------------------------------------
// isManaCostCovered — CR 117.6: checking mana payment
// ---------------------------------------------------------------------------

describe("isManaCostCovered", () => {
    it("returns true when pool exactly matches colored cost", () => {
        const pool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { W: 1 })).toBe(true);
    });

    it("returns true when pool has excess mana", () => {
        const pool = { W: 3, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { W: 1 })).toBe(true);
    });

    it("returns false when colored mana insufficient", () => {
        const pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { W: 1 })).toBe(false);
    });

    it("handles generic mana paid by any color (CR 117.6)", () => {
        const pool = { W: 2, U: 1, B: 1, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { X: 3, W: 1 })).toBe(true);
    });

    it("fails when generic mana cannot be covered", () => {
        const pool = { W: 1, U: 1, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { X: 3, W: 1 })).toBe(false);
    });

    it("handles zero-cost spells", () => {
        const pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, {})).toBe(true);
    });

    it("handles multi-colored cost", () => {
        const pool = { W: 1, U: 1, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { W: 1, U: 1 })).toBe(true);
    });

    it("fails multi-colored when one color missing", () => {
        const pool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { W: 1, U: 1 })).toBe(false);
    });

    it("colorless mana (C) is distinct from generic (CR 107.4b)", () => {
        const pool = { W: 5, U: 0, B: 0, R: 0, G: 0, C: 0 };
        expect(isManaCostCovered(pool, { C: 1 })).toBe(false);

        const poolWithC = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
        expect(isManaCostCovered(poolWithC, { C: 1 })).toBe(true);
    });

    it("does not mutate the original pool", () => {
        const pool = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 0 };
        isManaCostCovered(pool, { W: 1 });
        expect(pool.W).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// payManaCost — CR 117.6: deducting mana
// ---------------------------------------------------------------------------

describe("payManaCost", () => {
    it("deducts exact colored cost", () => {
        const pool = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 0 };
        payManaCost(pool, { W: 1 });
        expect(pool.W).toBe(1);
    });

    it("deducts generic cost from color with most mana (greedy)", () => {
        const pool = { W: 3, U: 1, B: 0, R: 0, G: 0, C: 0 };
        // Cost: {2} generic
        payManaCost(pool, { X: 2 });
        // Should take 2 from W (highest)
        expect(pool.W).toBe(1);
        expect(pool.U).toBe(1);
    });

    it("deducts generic across multiple colors when needed", () => {
        const pool = { W: 1, U: 1, B: 1, R: 0, G: 0, C: 0 };
        // Cost: {3} generic — needs all three
        payManaCost(pool, { X: 3 });
        expect(pool.W).toBe(0);
        expect(pool.U).toBe(0);
        expect(pool.B).toBe(0);
    });

    it("deducts colored first, then generic from remainder", () => {
        // Armageddon: {3}{W}
        const pool = { W: 2, U: 1, B: 1, R: 1, G: 0, C: 0 };
        payManaCost(pool, { X: 3, W: 1 });
        // First: pay W:1 → pool.W = 1
        // Then: generic 3 from highest: W(1), U(1), B(1) or R(1)
        expect(pool.W + pool.U + pool.B + pool.R + pool.G + pool.C).toBe(1);
    });

    it("handles zero-cost spells without modifying pool", () => {
        const pool = { W: 3, U: 0, B: 0, R: 0, G: 0, C: 0 };
        payManaCost(pool, {});
        expect(pool.W).toBe(3);
    });

    it("mutates the pool in place", () => {
        const pool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
        payManaCost(pool, { W: 1 });
        expect(pool.W).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// resolveTopOfStack — CR 608.3 (permanents), CR 608.2k (instants/sorceries)
// ---------------------------------------------------------------------------

function makeStackItem(
    cardData: Record<string, unknown>,
    castById: string,
    overrides: Partial<StackItem> = {}
): StackItem {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardData,
        controllerId: castById,
        ownerId: castById,
        zone: "stack",
        isTapped: false,
        castById,
        ...overrides,
    };
}

describe("resolveTopOfStack", () => {
    it("creature spell enters the battlefield under caster's control (CR 608.3)", () => {
        const item = makeStackItem(
            { name: "Savannah Lions", types: ["Creature"] },
            "p1"
        );
        const state = makeGameState();
        state.stack.push(item);

        const resolved = resolveTopOfStack(state);

        expect(state.stack).toHaveLength(0);
        expect(resolved.zone).toBe("battlefield");
        expect(resolved.isTapped).toBe(false);
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield).toHaveLength(1);
        expect(p1.battlefield[0].id).toBe(item.id);
    });

    it("artifact spell enters the battlefield (CR 608.3)", () => {
        const item = makeStackItem(
            { name: "Sol Ring", types: ["Artifact"] },
            "p1"
        );
        const state = makeGameState();
        state.stack.push(item);

        resolveTopOfStack(state);

        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield).toHaveLength(1);
    });

    it("enchantment spell enters the battlefield (CR 608.3)", () => {
        const item = makeStackItem(
            { name: "Animate Wall", types: ["Enchantment"] },
            "p1"
        );
        const state = makeGameState();
        state.stack.push(item);

        resolveTopOfStack(state);

        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield).toHaveLength(1);
    });

    it("instant goes to owner's graveyard after resolution (CR 608.2k)", () => {
        const item = makeStackItem(
            { name: "Lightning Bolt", types: ["Instant"] },
            "p1"
        );
        const state = makeGameState();
        state.stack.push(item);

        const resolved = resolveTopOfStack(state);

        expect(state.stack).toHaveLength(0);
        expect(resolved.zone).toBe("graveyard");
        const p1 = getPlayer(state, "p1");
        expect(p1.graveyard).toHaveLength(1);
        expect(p1.battlefield).toHaveLength(0);
    });

    it("sorcery goes to owner's graveyard after resolution (CR 608.2k)", () => {
        const item = makeStackItem(
            { name: "Armageddon", types: ["Sorcery"] },
            "p1"
        );
        const state = makeGameState();
        state.stack.push(item);

        resolveTopOfStack(state);

        const p1 = getPlayer(state, "p1");
        expect(p1.graveyard).toHaveLength(1);
    });

    it("resolves top item only (LIFO — CR 405.5)", () => {
        const bolt = makeStackItem(
            { name: "Lightning Bolt", types: ["Instant"] },
            "p1",
            { id: "bolt" }
        );
        const lions = makeStackItem(
            { name: "Savannah Lions", types: ["Creature"] },
            "p1",
            { id: "lions" }
        );
        const state = makeGameState();
        state.stack.push(bolt, lions); // lions on top

        const resolved = resolveTopOfStack(state);

        expect(resolved.id).toBe("lions");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe("bolt");
    });

    it("throws when stack is empty", () => {
        const state = makeGameState();
        expect(() => resolveTopOfStack(state)).toThrow("Stack is empty");
    });

    it("permanent enters under caster's control even if owner differs", () => {
        // Edge case: controllerId and castById differ from ownerId
        const item = makeStackItem(
            { name: "Savannah Lions", types: ["Creature"] },
            "p1",
            { ownerId: "p2" }
        );
        const state = makeGameState();
        state.stack.push(item);

        resolveTopOfStack(state);

        // Enters under caster (p1)'s battlefield
        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield).toHaveLength(1);
    });

    it("instant goes to owner's graveyard even if cast by opponent", () => {
        const item = makeStackItem(
            { name: "Lightning Bolt", types: ["Instant"] },
            "p2",
            { ownerId: "p1" }
        );
        const state = makeGameState();
        state.stack.push(item);

        resolveTopOfStack(state);

        // Goes to owner (p1)'s graveyard
        const p1 = getPlayer(state, "p1");
        expect(p1.graveyard).toHaveLength(1);
        const p2 = getPlayer(state, "p2");
        expect(p2.graveyard).toHaveLength(0);
    });
});
