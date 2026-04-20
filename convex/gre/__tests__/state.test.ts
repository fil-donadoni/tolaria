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
    tickDuration,
    type CardInstanceState,
    type Duration,
    type PlayerState,
    type GameState,
    type StackItem,
} from "../state";
import type { CardType } from "../../cards/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const card = overrides.card ?? { name: "Test Card", types: ["Creature"] };
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card,
        types: overrides.types ?? (card.types as CardType[]) ?? [],
        subtypes:
            (overrides.subtypes as string[]) ??
            (card.subtypes as string[]) ??
            [],
        power: overrides.power ?? (card.power as number | undefined),
        toughness:
            overrides.toughness ?? (card.toughness as number | undefined),
        staticAbilities:
            (overrides.staticAbilities as string[]) ??
            (card.staticAbilities as string[]) ??
            [],
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
        rngSeed: 0,
        rngCounter: 0,
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
        types: (cardData.types as CardType[]) ?? [],
        subtypes: (cardData.subtypes as string[]) ?? [],
        power: cardData.power as number | undefined,
        toughness: cardData.toughness as number | undefined,
        staticAbilities: (cardData.staticAbilities as string[]) ?? [],
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

        const resolved = resolveTopOfStack(state)!;

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

        const resolved = resolveTopOfStack(state)!;

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

        const resolved = resolveTopOfStack(state)!;

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

    it("creature entering battlefield gets instance power/toughness from card definition", () => {
        const item = makeStackItem(
            { name: "Bear", types: ["Creature"], power: 2, toughness: 2 },
            "p1"
        );
        const state = makeGameState();
        state.stack.push(item);

        resolveTopOfStack(state);

        const p1 = getPlayer(state, "p1");
        expect(p1.battlefield[0].power).toBe(2);
        expect(p1.battlefield[0].toughness).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Spell resolution with effects — SpellContext primitives
// ---------------------------------------------------------------------------

import { lightningBolt } from "../../cards/sets/lea";
import { giantGrowth } from "../../cards/sets/lea";
import { ancestralRecall } from "../../cards/sets/lea";
import { drawCard } from "../state";

describe("spell resolution: Lightning Bolt", () => {
    function makeBoltOnStack(
        castById: string,
        targets: StackItem["targets"]
    ): StackItem {
        return makeStackItem(
            {
                id: lightningBolt.id,
                name: lightningBolt.name,
                types: lightningBolt.types,
            },
            castById,
            { targets }
        );
    }

    it("deals 3 damage to a player", () => {
        const state = makeGameState();
        const bolt = makeBoltOnStack("p1", [{ type: "player", id: "p2" }]);
        state.stack.push(bolt);

        resolveTopOfStack(state);

        expect(getPlayer(state, "p2").life).toBe(17);
        // Bolt goes to caster's graveyard
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
    });

    it("kills a creature with toughness <= 3", () => {
        const state = makeGameState();
        const creature = makeCard({
            id: "bear1",
            card: { name: "Bear", types: ["Creature"], power: 2, toughness: 2 },
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            power: 2,
            toughness: 2,
        });
        getPlayer(state, "p2").battlefield.push(creature);

        const bolt = makeBoltOnStack("p1", [
            { type: "permanent", id: "bear1" },
        ]);
        state.stack.push(bolt);

        resolveTopOfStack(state);

        expect(getPlayer(state, "p2").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p2").graveyard).toHaveLength(1);
        expect(getPlayer(state, "p2").graveyard[0].id).toBe("bear1");
    });

    it("does NOT kill a creature with toughness > 3", () => {
        const state = makeGameState();
        const creature = makeCard({
            id: "giant1",
            card: {
                name: "Hill Giant",
                types: ["Creature"],
                power: 3,
                toughness: 4,
            },
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            power: 3,
            toughness: 4,
        });
        getPlayer(state, "p2").battlefield.push(creature);

        const bolt = makeBoltOnStack("p1", [
            { type: "permanent", id: "giant1" },
        ]);
        state.stack.push(bolt);

        resolveTopOfStack(state);

        // Creature survives
        expect(getPlayer(state, "p2").battlefield).toHaveLength(1);
        expect(getPlayer(state, "p2").graveyard).toHaveLength(0);
    });
});

describe("spell resolution: Giant Growth + Lightning Bolt interaction", () => {
    it("Giant Growth on a 1/1, then Lightning Bolt does NOT kill it", () => {
        const state = makeGameState();
        // 1/1 creature on p1's battlefield
        const creature = makeCard({
            id: "elf1",
            card: {
                name: "Llanowar Elves",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            power: 1,
            toughness: 1,
        });
        getPlayer(state, "p1").battlefield.push(creature);

        // Step 1: Giant Growth resolves on the elf (+3/+3)
        const growth = makeStackItem(
            {
                id: giantGrowth.id,
                name: giantGrowth.name,
                types: giantGrowth.types,
            },
            "p1",
            { targets: [{ type: "permanent", id: "elf1" }] }
        );
        state.stack.push(growth);
        resolveTopOfStack(state);

        // Verify: elf is now 4/4
        const elf = getPlayer(state, "p1").battlefield.find(
            (c) => c.id === "elf1"
        );
        expect(elf).toBeDefined();
        expect(elf!.power).toBe(4);
        expect(elf!.toughness).toBe(4);

        // Step 2: Lightning Bolt resolves on the elf (3 damage)
        const bolt = makeStackItem(
            {
                id: lightningBolt.id,
                name: lightningBolt.name,
                types: lightningBolt.types,
            },
            "p2",
            { targets: [{ type: "permanent", id: "elf1" }] }
        );
        state.stack.push(bolt);
        resolveTopOfStack(state);

        // Elf survives: 3 damage < 4 toughness
        expect(getPlayer(state, "p1").battlefield).toHaveLength(1);
        // p1's graveyard has Giant Growth (instant → graveyard after resolve)
        expect(
            getPlayer(state, "p1").graveyard.every((c) => c.id !== "elf1")
        ).toBe(true);
    });

    it("Lightning Bolt kills a 1/1 without Giant Growth", () => {
        const state = makeGameState();
        const creature = makeCard({
            id: "elf1",
            card: {
                name: "Llanowar Elves",
                types: ["Creature"],
                power: 1,
                toughness: 1,
            },
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            power: 1,
            toughness: 1,
        });
        getPlayer(state, "p1").battlefield.push(creature);

        const bolt = makeStackItem(
            {
                id: lightningBolt.id,
                name: lightningBolt.name,
                types: lightningBolt.types,
            },
            "p2",
            { targets: [{ type: "permanent", id: "elf1" }] }
        );
        state.stack.push(bolt);
        resolveTopOfStack(state);

        // Elf dies: 3 damage >= 1 toughness
        expect(getPlayer(state, "p1").battlefield).toHaveLength(0);
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// drawCard helper — CR 121.1 / CR 704.5b
// ---------------------------------------------------------------------------

describe("drawCard (CR 121.1)", () => {
    it("moves the top card of the library to hand", () => {
        const player = makePlayer({
            library: [
                makeCard({ id: "c1", zone: "library" }),
                makeCard({ id: "c2", zone: "library" }),
            ],
        });

        const drawn = drawCard(player);

        expect(drawn?.id).toBe("c1");
        expect(player.hand.map((c) => c.id)).toEqual(["c1"]);
        expect(player.library.map((c) => c.id)).toEqual(["c2"]);
    });

    it("sets hasDrawnFromEmpty and returns null on empty library (CR 704.5b)", () => {
        const player = makePlayer({ library: [] });

        const drawn = drawCard(player);

        expect(drawn).toBeNull();
        expect(player.hasDrawnFromEmpty).toBe(true);
        expect(player.hand).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Spell resolution: Ancestral Recall — CR 121.1
// "Target player draws three cards."
// ---------------------------------------------------------------------------

describe("spell resolution: Ancestral Recall", () => {
    function pushRecall(state: GameState, castBy: string, targetId: string) {
        const item = makeStackItem(
            {
                id: ancestralRecall.id,
                name: ancestralRecall.name,
                types: ancestralRecall.types,
            },
            castBy,
            { targets: [{ type: "player", id: targetId }] }
        );
        state.stack.push(item);
        return item;
    }

    it("target player draws three cards", () => {
        const state = makeGameState();
        const p2 = getPlayer(state, "p2");
        p2.library = [
            makeCard({ id: "c1", ownerId: "p2", zone: "library" }),
            makeCard({ id: "c2", ownerId: "p2", zone: "library" }),
            makeCard({ id: "c3", ownerId: "p2", zone: "library" }),
            makeCard({ id: "c4", ownerId: "p2", zone: "library" }),
        ];
        pushRecall(state, "p1", "p2");

        resolveTopOfStack(state);

        expect(p2.hand.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
        expect(p2.library.map((c) => c.id)).toEqual(["c4"]);
        // Caster's graveyard has the spell (instant → graveyard, CR 608.2k)
        expect(getPlayer(state, "p1").graveyard).toHaveLength(1);
        expect(
            (getPlayer(state, "p1").graveyard[0].card as { id: string }).id
        ).toBe(ancestralRecall.id);
    });

    it("targeting self draws three cards", () => {
        const state = makeGameState();
        const p1 = getPlayer(state, "p1");
        p1.library = [
            makeCard({ id: "a", ownerId: "p1", zone: "library" }),
            makeCard({ id: "b", ownerId: "p1", zone: "library" }),
            makeCard({ id: "c", ownerId: "p1", zone: "library" }),
        ];
        pushRecall(state, "p1", "p1");

        resolveTopOfStack(state);

        expect(p1.hand.map((c) => c.id)).toEqual(["a", "b", "c"]);
        expect(p1.library).toHaveLength(0);
    });

    it("flags hasDrawnFromEmpty if library runs out mid-draw (CR 704.5b)", () => {
        const state = makeGameState();
        const p2 = getPlayer(state, "p2");
        p2.library = [makeCard({ id: "only", ownerId: "p2", zone: "library" })];
        pushRecall(state, "p1", "p2");

        resolveTopOfStack(state);

        expect(p2.hand.map((c) => c.id)).toEqual(["only"]);
        expect(p2.library).toHaveLength(0);
        expect(p2.hasDrawnFromEmpty).toBe(true);
    });
});

describe("tickDuration (CR 514.2, 511.3)", () => {
    it("expires at its own boundary and is untouched at unrelated boundaries", () => {
        const d: Duration = { phase: "end-of-combat" };
        // An end-of-combat duration is unchanged at CLEANUP...
        expect(
            tickDuration(d, { phase: "CLEANUP", activePlayerId: "p1" })
        ).toEqual(d);
        // ...and expires at END_OF_COMBAT.
        expect(
            tickDuration(d, { phase: "END_OF_COMBAT", activePlayerId: "p1" })
        ).toBeNull();
    });

    it("skip > 0 decrements on match and only expires when it reaches 0", () => {
        const d: Duration = { phase: "end-of-turn", skip: 1 };
        const after1 = tickDuration(d, {
            phase: "CLEANUP",
            activePlayerId: "p1",
        });
        expect(after1).toEqual({ phase: "end-of-turn" });
        // Second CLEANUP expires the entry.
        expect(
            tickDuration(after1!, { phase: "CLEANUP", activePlayerId: "p2" })
        ).toBeNull();
    });

    it("player scope: non-matching active player leaves skip untouched", () => {
        // "until end of your next turn" created on p1's turn. First CLEANUP
        // is p1's — decrement. Second is p2's — skip stays. Third is p1's —
        // expire. This is the intended semantics of `playerId`.
        const created: Duration = {
            phase: "end-of-turn",
            skip: 1,
            playerId: "p1",
        };
        const afterP1 = tickDuration(created, {
            phase: "CLEANUP",
            activePlayerId: "p1",
        })!;
        expect(afterP1).toEqual({ phase: "end-of-turn", playerId: "p1" });
        // p2's CLEANUP: unchanged.
        const afterP2 = tickDuration(afterP1, {
            phase: "CLEANUP",
            activePlayerId: "p2",
        })!;
        expect(afterP2).toEqual(afterP1);
        // Next p1 CLEANUP: expired.
        expect(
            tickDuration(afterP2, { phase: "CLEANUP", activePlayerId: "p1" })
        ).toBeNull();
    });
});
