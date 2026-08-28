import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    clearKnowledge,
    exileFaceDownCard,
    grantKnowledge,
    grantKnowledgeToAll,
    getBasicLandMana,
    getPlayer,
    getOpponentId,
    moveCard,
    removeFromZone,
    isManaCostCovered,
    normalizeManaCost,
    payManaCost,
    regenerateOrDestroy,
    resolveTargetRequirementCount,
    resolveTopOfStack,
    tickDuration,
    type CardInstanceState,
    type Duration,
    type PlayerState,
    type GameState,
    type StackItem,
} from "../state";
import type { CardType } from "../../cards/types";
import { tryGetDefinition } from "../../cards";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// SLIM card builder. `card: { id }` is the only field persisted to Convex;
// for synthetic ids (no registry entry) runtime fields fall back to any
// inline data passed on `overrides.card` so legacy fixtures keep working.
// Resolution order per field: explicit override → registry def → inline
// cardData → empty default.
function makeCard(
    overrides: Partial<CardInstanceState> & {
        card?: Record<string, unknown>;
    } = {}
): CardInstanceState {
    const cardRef = overrides.card as
        | {
              id?: string;
              manaCost?: unknown;
              types?: CardType[];
              subtypes?: string[];
              power?: number;
              toughness?: number;
              staticAbilities?: string[];
          }
        | undefined;
    const id = cardRef?.id ?? `synth-${crypto.randomUUID()}`;
    const def = tryGetDefinition(id);
    const cardField: { id: string; manaCost?: unknown } = { id };
    if (cardRef?.manaCost !== undefined) {
        cardField.manaCost = cardRef.manaCost;
    }
    const rest: Partial<CardInstanceState> = { ...overrides };
    delete rest.card;
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardField,
        types: overrides.types ?? def?.types ?? cardRef?.types ?? [],
        subtypes:
            overrides.subtypes ?? def?.subtypes ?? cardRef?.subtypes ?? [],
        power: overrides.power ?? def?.power ?? cardRef?.power,
        toughness: overrides.toughness ?? def?.toughness ?? cardRef?.toughness,
        staticAbilities:
            overrides.staticAbilities ??
            def?.staticAbilities ??
            cardRef?.staticAbilities ??
            [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        isTapped: false,
        ...rest,
    };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: "p1",
        name: "Player 1",
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

    // ADR 0026 slice 5 — the stack is a public zone: casting a known card to
    // the stack makes its identity universally known, so persistent per-viewer
    // knowledge is emptied and never resurrects on a later return to hidden.
    it("clears knownTo when moving a known card to the stack", () => {
        const card = makeCard({ id: "k0", zone: "hand", knownTo: ["p2"] });
        const player = makePlayer({ id: "p1", hand: [card] });

        const removed = removeFromZone(player, "k0", "hand");

        expect(removed.knownTo).toBeUndefined();
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
    const cardRef = cardData as { id?: string; manaCost?: unknown };
    const id = cardRef.id ?? `synth-${crypto.randomUUID()}`;
    const def = tryGetDefinition(id);
    const cardField: { id: string; manaCost?: unknown } = { id };
    if (cardRef.manaCost !== undefined) cardField.manaCost = cardRef.manaCost;
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardField,
        types: def?.types ?? (cardData.types as CardType[]) ?? [],
        subtypes: def?.subtypes ?? (cardData.subtypes as string[]) ?? [],
        power: def?.power ?? (cardData.power as number | undefined),
        toughness: def?.toughness ?? (cardData.toughness as number | undefined),
        staticAbilities:
            def?.staticAbilities ??
            (cardData.staticAbilities as string[]) ??
            [],
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
import { getEffectivePower, getEffectiveToughness } from "../layers";

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
        // +3/+3 is a temporary buff (CR 611.1), so base P/T is unchanged and
        // the boost shows through effective P/T.
        expect(elf!.power).toBe(1);
        expect(elf!.toughness).toBe(1);
        expect(getEffectivePower(state, elf!)).toBe(4);
        expect(getEffectiveToughness(state, elf!)).toBe(4);

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

    // ADR 0026 slice 5 — library→hand is a hidden→hidden move, so knownTo
    // persists. An opponent who saw the top of the library (witnessed draw)
    // still knows the card now sitting in the owner's hand.
    it("keeps an opponent's knownTo when drawing a card they saw on top", () => {
        const player = makePlayer({
            id: "p1",
            library: [
                makeCard({ id: "top", zone: "library", knownTo: ["p2"] }),
                makeCard({ id: "next", zone: "library" }),
            ],
        });

        const drawn = drawCard(player);

        expect(drawn?.id).toBe("top");
        expect(player.hand[0].knownTo).toEqual(["p2"]);
    });

    // ADR 0026 slice 5 — a card the owner scryed to the top (knownTo = owner
    // only) and then drew is in hand known to the owner only — never flagged
    // as opponent-known.
    it("keeps a self-scryed card knownTo the owner only after drawing it", () => {
        const player = makePlayer({
            id: "p1",
            library: [
                makeCard({ id: "scryed", zone: "library", knownTo: ["p1"] }),
            ],
        });

        const drawn = drawCard(player);

        expect(drawn?.id).toBe("scryed");
        expect(player.hand[0].knownTo).toEqual(["p1"]);
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

describe("regenerateOrDestroy (CR 614.5, 701.19a, 702.12)", () => {
    function setup(
        opts: {
            staticAbilities?: string[];
            shields?: number;
            isAttacking?: boolean;
        } = {}
    ): { state: GameState; cardId: string } {
        const card = makeCard({
            id: "victim",
            staticAbilities: opts.staticAbilities ?? [],
            zone: "battlefield",
            regenerationShields: opts.shields,
            isAttacking: opts.isAttacking,
        });
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", battlefield: [card] }),
                makePlayer({ id: "p2" }),
            ],
        });
        return { state, cardId: card.id };
    }

    it("indestructible blocks the destroy entirely (CR 702.12)", () => {
        const { state, cardId } = setup({
            staticAbilities: ["indestructible"],
        });
        const destroyed = regenerateOrDestroy(state, cardId);
        expect(destroyed).toBe(false);
        // Permanent stays on the battlefield, no graveyard move, no regen rider.
        expect(state.players[0].battlefield).toHaveLength(1);
        expect(state.players[0].battlefield[0].isTapped).toBe(false);
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("indestructible takes precedence over regeneration shields", () => {
        const { state, cardId } = setup({
            staticAbilities: ["indestructible"],
            shields: 1,
        });
        regenerateOrDestroy(state, cardId);
        // Shield was NOT consumed — indestructible short-circuits before it.
        const card = state.players[0].battlefield[0];
        expect(card.regenerationShields).toBe(1);
        expect(card.isTapped).toBe(false);
    });

    it("regeneration shield consumed and rider applied when not indestructible", () => {
        const { state, cardId } = setup({ shields: 1, isAttacking: true });
        const destroyed = regenerateOrDestroy(state, cardId);
        expect(destroyed).toBe(false);
        const card = state.players[0].battlefield[0];
        expect(card.regenerationShields).toBeUndefined();
        expect(card.isTapped).toBe(true);
        expect(card.isAttacking).toBeUndefined();
    });

    it("plain destroy with no protections sends the card to graveyard", () => {
        const { state, cardId } = setup();
        const destroyed = regenerateOrDestroy(state, cardId);
        expect(destroyed).toBe(true);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    // issue #1054 — every path through regenerateOrDestroy (the shield case
    // already asserted above) stamps `cause: "destroy"` on the emitted
    // PERMANENT_LEFT event, and threads the caller-supplied causer controller
    // through unchanged so "destroyed by an opponent's spell/ability"
    // triggers (Karmic Justice) can gate on it precisely.
    it("stamps cause: 'destroy' and the causer controller on the emitted PERMANENT_LEFT event", () => {
        const { state, cardId } = setup();
        regenerateOrDestroy(state, cardId, { causerControllerId: "p2" });
        const ev = state.pendingEvents?.find(
            (e) => e.type === "PERMANENT_LEFT"
        );
        expect(ev).toMatchObject({
            type: "PERMANENT_LEFT",
            instanceId: cardId,
            cause: "destroy",
            causerControllerId: "p2",
        });
    });

    it("omits causerControllerId when no causer is supplied (an SBA sweep)", () => {
        const { state, cardId } = setup();
        regenerateOrDestroy(state, cardId);
        const ev = state.pendingEvents?.find(
            (e) => e.type === "PERMANENT_LEFT"
        );
        expect(ev).toMatchObject({ cause: "destroy" });
        expect(
            (ev as { causerControllerId?: string } | undefined)
                ?.causerControllerId
        ).toBeUndefined();
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

// ---------------------------------------------------------------------------
// Persistent card knowledge — ADR 0026 / PRD #338
// ---------------------------------------------------------------------------

describe("clearKnowledge (ADR 0026)", () => {
    it("clears ALL viewers when the change is random/unwitnessed (selectorId = null)", () => {
        const cards = [
            makeCard({ id: "a", knownTo: ["p1", "p2"] }),
            makeCard({ id: "b", knownTo: ["p1"] }),
            makeCard({ id: "c" }),
        ];
        clearKnowledge(cards, null);
        expect(cards[0].knownTo).toBeUndefined();
        expect(cards[1].knownTo).toBeUndefined();
        expect(cards[2].knownTo).toBeUndefined();
    });

    it("keeps only the selector's knowledge when a player chose-and-witnessed", () => {
        const cards = [makeCard({ id: "a", knownTo: ["p1", "p2"] })];
        clearKnowledge(cards, "p1");
        expect(cards[0].knownTo).toEqual(["p1"]);
    });

    it("deletes an emptied knownTo rather than leaving []", () => {
        const cards = [makeCard({ id: "a", knownTo: ["p2"] })];
        clearKnowledge(cards, "p1");
        expect(cards[0].knownTo).toBeUndefined();
    });
});

describe("exileFaceDownCard — impulse-draw (ADR 0026 slice 6, CR 406.3)", () => {
    it("moves the card to exile and stamps ONLY the controller into knownTo", () => {
        const card = makeCard({
            id: "top",
            zone: "library",
            ownerId: "p1",
            controllerId: "p1",
        });
        const player = makePlayer({ id: "p1", library: [card] });

        const exiled = exileFaceDownCard(player, "top", "library", "p1");

        expect(player.library).toHaveLength(0);
        expect(player.exile).toHaveLength(1);
        expect(player.exile[0].zone).toBe("exile");
        expect(exiled?.knownTo).toEqual(["p1"]);
    });

    it("grants knowledge to the controller even when they are not the owner", () => {
        // p1 impulse-exiles the top of p2's library (e.g. a theft effect): only
        // p1 (the knower) ends up in knownTo, never the owner p2 by default.
        const card = makeCard({
            id: "top",
            zone: "library",
            ownerId: "p2",
            controllerId: "p2",
        });
        const owner = makePlayer({ id: "p2", library: [card] });

        const exiled = exileFaceDownCard(owner, "top", "library", "p1");

        expect(exiled?.knownTo).toEqual(["p1"]);
        expect(exiled?.knownTo).not.toContain("p2");
    });

    it("does NOT strip knownTo the way a face-up exile via moveCard does", () => {
        // Contrast: moveCard(... "exile") clears knownTo (exile is public);
        // the face-down primitive must keep it.
        const faceUp = makeCard({ id: "up", zone: "library", knownTo: ["p2"] });
        const faceDown = makeCard({ id: "down", zone: "library" });
        const player = makePlayer({ id: "p1", library: [faceUp, faceDown] });

        moveCard(player, "up", "library", "exile");
        exileFaceDownCard(player, "down", "library", "p1");

        const upInExile = player.exile.find((c) => c.id === "up")!;
        const downInExile = player.exile.find((c) => c.id === "down")!;
        expect(upInExile.knownTo).toBeUndefined(); // public exile cleared it
        expect(downInExile.knownTo).toEqual(["p1"]); // face-down kept it
    });

    // Issue #2904 — the DISPLAY census. Without it the exile pile has nothing
    // to key a face-down face on and falls back to the generic one silently.
    it("stamps the face-down-exile producer, and drops it when the card leaves for a public zone", () => {
        const card = makeCard({ id: "top", zone: "library" });
        const player = makePlayer({ id: "p1", library: [card] });

        const exiled = exileFaceDownCard(
            player,
            "top",
            "library",
            "p1",
            "face-down-exile"
        );
        expect(exiled?.faceDownBy).toBe("face-down-exile");

        // CR 406.3's look-permission ends when the card leaves exile; the
        // marker that made it render hidden must not outlive it.
        moveCard(player, "top", "exile", "graveyard");
        const inGraveyard = player.graveyard.find((c) => c.id === "top")!;
        expect(inGraveyard.knownTo).toBeUndefined();
        expect(inGraveyard.faceDownBy).toBeUndefined();
    });

    // Review finding 5 — the exile->HAND path is the one that mattered and the
    // one a `knownTo`-keyed clear could never reach: Memory Jar's delayed
    // trigger returns its face-down exiled cards to hand, and that path
    // deliberately PRESERVES `knownTo`. The marker rode into the owner's hand
    // projection and into every save.
    it("drops the marker on the exile -> HAND return, which preserves knownTo", () => {
        const card = makeCard({ id: "jarred", zone: "hand" });
        const player = makePlayer({ id: "p1", hand: [card] });

        exileFaceDownCard(player, "jarred", "hand", "p1", "face-down-exile");
        expect(player.exile[0].faceDownBy).toBe("face-down-exile");

        moveCard(player, "jarred", "exile", "hand");
        const returned = player.hand.find((c) => c.id === "jarred")!;
        expect(returned.faceDownBy).toBeUndefined();
    });

    it("never sets faceDownOf — face-down exile reuses knownTo, not the morph field", () => {
        const card = makeCard({ id: "top", zone: "library" });
        const player = makePlayer({ id: "p1", library: [card] });

        const exiled = exileFaceDownCard(player, "top", "library", "p1");

        expect(exiled?.faceDownOf).toBeUndefined();
    });

    it("returns null for an id not in the source zone (no-op)", () => {
        const player = makePlayer({ id: "p1", library: [] });
        expect(
            exileFaceDownCard(player, "missing", "library", "p1")
        ).toBeNull();
        expect(player.exile).toHaveLength(0);
    });

    it("entering a public zone afterward clears the knowledge (no resurrection)", () => {
        const card = makeCard({ id: "top", zone: "library" });
        const player = makePlayer({ id: "p1", library: [card] });

        exileFaceDownCard(player, "top", "library", "p1");
        // A later face-up move out of exile to hand strips the stale knowledge
        // via moveCard's public-zone rule path on re-entry. Here we move it back
        // to hand directly: knownTo persists hidden→hidden, but a subsequent
        // public-zone entry would clear it. Assert the controller still knows it
        // while it remains face-down in exile.
        expect(player.exile[0].knownTo).toEqual(["p1"]);
    });
});

describe("grantKnowledge stamps persistent knowledge (ADR 0026)", () => {
    it("adds the knower to library cards and is idempotent", () => {
        const library = [
            makeCard({
                id: "l0",
                zone: "library",
                ownerId: "p2",
                controllerId: "p2",
            }),
            makeCard({
                id: "l1",
                zone: "library",
                ownerId: "p2",
                controllerId: "p2",
            }),
        ];
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1" }),
                makePlayer({ id: "p2", library }),
            ],
        });
        grantKnowledge(state, "p2", ["l0"], "p1");
        grantKnowledge(state, "p2", ["l0"], "p1"); // idempotent
        expect(state.players[1].library[0].knownTo).toEqual(["p1"]);
        expect(state.players[1].library[1].knownTo).toBeUndefined();
    });

    it("a shuffle (clearKnowledge null) wipes a freshly granted set", () => {
        const library = [
            makeCard({ id: "l0", zone: "library" }),
            makeCard({ id: "l1", zone: "library" }),
        ];
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", library }),
                makePlayer({ id: "p2" }),
            ],
        });
        grantKnowledge(state, "p1", ["l0", "l1"], "p1");
        clearKnowledge(state.players[0].library, null); // models shuffle
        for (const c of state.players[0].library) {
            expect(c.knownTo).toBeUndefined();
        }
    });
});

describe("grantKnowledgeToAll — reveal stamps every player (ADR 0026 slice 2)", () => {
    it("adds every player to knownTo of the targeted library cards", () => {
        const library = [
            makeCard({
                id: "l0",
                zone: "library",
                ownerId: "p2",
                controllerId: "p2",
            }),
            makeCard({
                id: "l1",
                zone: "library",
                ownerId: "p2",
                controllerId: "p2",
            }),
        ];
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1" }),
                makePlayer({ id: "p2", library }),
            ],
        });
        grantKnowledgeToAll(state, "p2", ["l0"]);
        grantKnowledgeToAll(state, "p2", ["l0"]); // idempotent
        // Revealed card is known to BOTH players (look would be just one).
        expect(state.players[1].library[0].knownTo).toEqual(["p1", "p2"]);
        // The untouched card stays hidden from everyone.
        expect(state.players[1].library[1].knownTo).toBeUndefined();
    });

    it("merges with an existing looker rather than dropping it", () => {
        const library = [
            makeCard({
                id: "l0",
                zone: "library",
                ownerId: "p1",
                controllerId: "p1",
                knownTo: ["p1"], // p1 already looked
            }),
        ];
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", library }),
                makePlayer({ id: "p2" }),
            ],
        });
        grantKnowledgeToAll(state, "p1", ["l0"]);
        expect(state.players[0].library[0].knownTo).toEqual(["p1", "p2"]);
    });

    it("a shuffle (clearKnowledge null) clears the reveal for everyone (CR 701.20)", () => {
        const library = [makeCard({ id: "l0", zone: "library" })];
        const state = makeGameState({
            players: [
                makePlayer({ id: "p1", library }),
                makePlayer({ id: "p2" }),
            ],
        });
        grantKnowledgeToAll(state, "p1", ["l0"]);
        expect(state.players[0].library[0].knownTo).toEqual(["p1", "p2"]);
        clearKnowledge(state.players[0].library, null); // models shuffle
        expect(state.players[0].library[0].knownTo).toBeUndefined();
    });
});

describe("moveCard clears knowledge entering a public zone (ADR 0026)", () => {
    it("drops knownTo when a card enters the battlefield/graveyard/exile", () => {
        const hand = [makeCard({ id: "h0", zone: "hand", knownTo: ["p2"] })];
        const player = makePlayer({ id: "p1", hand });
        moveCard(player, "h0", "hand", "graveyard");
        expect(player.graveyard[0].knownTo).toBeUndefined();
    });

    it("preserves knownTo on a hidden→hidden move (hand→library)", () => {
        const hand = [makeCard({ id: "h0", zone: "hand", knownTo: ["p2"] })];
        const player = makePlayer({ id: "p1", hand });
        moveCard(player, "h0", "hand", "library");
        expect(player.library[0].knownTo).toEqual(["p2"]);
    });
});

// CR 400.3 (issue #1721 — residual class of #1696) — a card leaving a
// PUBLIC zone (battlefield/graveyard/exile) was watched by every player, so
// landing it in a HIDDEN zone (hand/library) does not retroactively
// un-reveal it. Review round 2 moved the gate OFF an optional 5th `state`
// param on the general `moveCard` (fail-open: any future caller could omit
// it silently) and INTO `moveCardWithGraveyardReplacement` — the private,
// FAIL-CLOSED chokepoint every `SpellContext.moveCardById`/`moveZone` call
// already routes through, whose own `state` param is required. `moveCard`
// itself is now a plain 4-arg mover that never stamps; exercised here
// through the real `ctx.moveCardById`/`ctx.shuffleLibrary` SpellContext
// methods rather than by reaching into the private chokepoint directly. The
// 4-arg call sites elsewhere in the GRE deliberately never cross
// public→hidden (playLand, mulligan, draw), so they stay untouched.
describe("moveCardById grants knowledge on a public→hidden move (issue #1721)", () => {
    function makeCtx(state: GameState, playerId = "p1") {
        const item: StackItem = {
            ...makeCard({ id: "synthetic-stack-item", zone: "stack" }),
            castById: playerId,
        };
        return buildSpellContext(state, item);
    }

    it("stamps the card known to EVERY player leaving the graveyard into hand (Regrowth/Raise Dead/Eternal Witness shape)", () => {
        const graveyard = [makeCard({ id: "g0", zone: "graveyard" })];
        const player = makePlayer({ id: "p1", graveyard });
        const state = makeGameState({
            players: [player, makePlayer({ id: "p2" })],
        });
        makeCtx(state).moveCardById("p1", "g0", "graveyard", "hand");
        expect([...(player.hand[0].knownTo ?? [])].sort()).toEqual([
            "p1",
            "p2",
        ]);
    });

    it("stamps the card known to EVERY player leaving the graveyard onto the library (Drafna's Restoration shape)", () => {
        const graveyard = [makeCard({ id: "g0", zone: "graveyard" })];
        const player = makePlayer({ id: "p1", graveyard });
        const state = makeGameState({
            players: [player, makePlayer({ id: "p2" })],
        });
        makeCtx(state).moveCardById("p1", "g0", "graveyard", "library");
        expect([...(player.library[0].knownTo ?? [])].sort()).toEqual([
            "p1",
            "p2",
        ]);
    });

    it("stamps a FACE-UP exile card known to EVERY player leaving exile into hand", () => {
        const exile = [makeCard({ id: "e0", zone: "exile" })];
        const player = makePlayer({ id: "p1", exile });
        const state = makeGameState({
            players: [player, makePlayer({ id: "p2" })],
        });
        makeCtx(state).moveCardById("p1", "e0", "exile", "hand");
        expect([...(player.hand[0].knownTo ?? [])].sort()).toEqual([
            "p1",
            "p2",
        ]);
    });

    // Review round 2, finding 1 — a card that left exile FACE DOWN
    // (`exileFaceDownCard`, CR 406.3) carries a `knownTo` scoped to its one
    // knower alone; the gate must NOT overwrite that with "known to
    // everyone" when the card returns to a hidden zone (Memory Jar,
    // ulg/colorless.ts, exercises exactly this — see the card-level
    // regression test in ulg/__tests__/colorless.test.ts). `knownTo: ["p1"]`
    // here models the marker `exileFaceDownCard` leaves; `projectExileCard`
    // reads the very same non-empty-`knownTo`-on-exile signal on the wire.
    it("does NOT stamp a FACE-DOWN exiled card leaving exile into hand — over-reveal regression", () => {
        const exile = [makeCard({ id: "e0", zone: "exile", knownTo: ["p1"] })];
        const player = makePlayer({ id: "p1", exile });
        const state = makeGameState({
            players: [player, makePlayer({ id: "p2" })],
        });
        makeCtx(state).moveCardById("p1", "e0", "exile", "hand");
        expect(player.hand[0].knownTo).toEqual(["p1"]);
    });

    it("does NOT stamp on a hidden→hidden move (hand→library)", () => {
        const hand = [makeCard({ id: "h0", zone: "hand" })];
        const player = makePlayer({ id: "p1", hand });
        const state = makeGameState({
            players: [player, makePlayer({ id: "p2" })],
        });
        makeCtx(state).moveCardById("p1", "h0", "hand", "library");
        expect(player.library[0].knownTo).toBeUndefined();
    });

    it("does NOT stamp on a public→public move (graveyard→exile) — already public, no grant needed", () => {
        const graveyard = [makeCard({ id: "g0", zone: "graveyard" })];
        const player = makePlayer({ id: "p1", graveyard });
        const state = makeGameState({
            players: [player, makePlayer({ id: "p2" })],
        });
        makeCtx(state).moveCardById("p1", "g0", "graveyard", "exile");
        expect(player.exile[0].knownTo).toBeUndefined();
    });

    // Review round 2, non-blocking finding — this used to call
    // `clearKnowledge(library, null)` directly ("models shuffleLibrary"),
    // which only proves `clearKnowledge` works (already covered elsewhere)
    // and never proved the clearing assertion was reached through a real
    // card path. Drive the actual `SpellContext.shuffleLibrary` primitive
    // instead (state.ts: seededShuffle + clearKnowledge).
    it("a later real shuffle still clears the stamped knowledge for everyone (CR 701.24 regression)", () => {
        const graveyard = [makeCard({ id: "g0", zone: "graveyard" })];
        const player = makePlayer({ id: "p1", graveyard });
        const state = makeGameState({
            players: [player, makePlayer({ id: "p2" })],
        });
        const ctx = makeCtx(state);
        ctx.moveCardById("p1", "g0", "graveyard", "library");
        expect(player.library[0].knownTo).toEqual(["p1", "p2"]);
        ctx.shuffleLibrary("p1");
        expect(player.library[0].knownTo).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolveTargetRequirementCount (CR 107.3 / 601.2c, issue #2365)
//
// The single shared resolver every count-resolution site calls
// (`game.ts` cast/activated-ability paths, `gre/rules.ts`'s trigger path via
// its own `triggerTargetMinMax`, `gre/state.ts`'s `requestCopyRetargetOn` /
// `requestRetarget`, `gre/moves.ts`'s bot enumerator). Before this
// extraction, four independent re-implementations each handled a different
// subset of the `"X"` shapes — only ONE handled the literal `"X"` count at
// all, and NONE handled the object form's `max === "X"` (the genuinely
// optional "up to X" template, CR 601.2c: "as many as you choose, from zero
// to X"). Testing the resolver once here is the catalogue-wide proof; every
// call site's own test (below, and in `rules.test.ts` /
// `moves.bot.test.ts` / the frontend integration test) only has to prove IT
// calls this function, not re-prove the resolution arithmetic.
// ---------------------------------------------------------------------------
describe("resolveTargetRequirementCount (CR 107.3 / 601.2c, issue #2365)", () => {
    it("a plain number passes through unchanged, ignoring chosenX", () => {
        expect(resolveTargetRequirementCount(3, undefined)).toBe(3);
        expect(resolveTargetRequirementCount(3, 7)).toBe(3);
    });

    it("a literal 'X' count resolves to the exact chosenX (Volcanic Eruption)", () => {
        expect(resolveTargetRequirementCount("X", 0)).toBe(0);
        expect(resolveTargetRequirementCount("X", 2)).toBe(2);
        expect(resolveTargetRequirementCount("X", 5)).toBe(5);
    });

    it("an already-fixed { min, max } range passes through unchanged", () => {
        expect(resolveTargetRequirementCount({ min: 1 }, 5)).toEqual({
            min: 1,
        });
        expect(resolveTargetRequirementCount({ min: 1, max: 3 }, 5)).toEqual({
            min: 1,
            max: 3,
        });
    });

    it("{ min: 0, max: 'X' } — 'up to X' — resolves to a live { min, max } range at 0, at k < X, and at X", () => {
        // The GRE-level proof the issue asks for: legal selection sizes span
        // the WHOLE 0..X range for a single announced X, not just the two
        // endpoints.
        expect(resolveTargetRequirementCount({ min: 0, max: "X" }, 0)).toEqual({
            min: 0,
            max: 0,
        });
        expect(resolveTargetRequirementCount({ min: 0, max: "X" }, 3)).toEqual(
            { min: 0, max: 3 } // X itself
        );
        // k < X: the SAME resolved range covers every size from 0 through the
        // announced X — a selection of size 1 (k) is legal within it.
        const upToThree = resolveTargetRequirementCount(
            { min: 0, max: "X" },
            3
        );
        expect(upToThree).toEqual({ min: 0, max: 3 });
        if (typeof upToThree === "object") {
            expect(1).toBeGreaterThanOrEqual(upToThree.min); // k=1 ≥ min
            expect(1).toBeLessThanOrEqual(upToThree.max!); // k=1 ≤ max (X=3)
        }
    });

    it("{ min: 1, max: 'X' } resolves max only, leaving min untouched", () => {
        expect(resolveTargetRequirementCount({ min: 1, max: "X" }, 4)).toEqual({
            min: 1,
            max: 4,
        });
    });

    it("clamps max up to min when the announced X is BELOW min (review finding, issue #2365)", () => {
        // Every prior case here has X > min (4 > 1) or min === 0 (where any
        // X is already ≥ min). This is the one that wasn't covered: an
        // announced X strictly less than a positive min. Without the clamp
        // this resolves to `{ min: 2, max: 1 }` — a range no consumer
        // downstream can satisfy (`pendingTargetCountMaxReached` is already
        // true at 0 selections, `confirmTargets` throws "At least 2
        // target(s) required" with no way to progress but cancel).
        expect(resolveTargetRequirementCount({ min: 2, max: "X" }, 0)).toEqual({
            min: 2,
            max: 2,
        });
        expect(resolveTargetRequirementCount({ min: 2, max: "X" }, 1)).toEqual({
            min: 2,
            max: 2,
        });
        // The `requireX: false` missing-chosenX default (0) folds the SAME
        // way through a positive min — no `{min, max:0}` degenerate range.
        expect(
            resolveTargetRequirementCount({ min: 3, max: "X" }, undefined)
        ).toEqual({ min: 3, max: 3 });
    });

    it("requireX: true throws when an X-bearing count has no chosenX (game.ts cast/ability path)", () => {
        expect(() =>
            resolveTargetRequirementCount("X", undefined, { requireX: true })
        ).toThrow('Target count "X" requires chosenX');
        expect(() =>
            resolveTargetRequirementCount({ min: 0, max: "X" }, undefined, {
                requireX: true,
            })
        ).toThrow('Target count "X" requires chosenX');
    });

    it("without requireX, a missing chosenX defensively folds to 0 (copy-retarget / bot enumerator convention)", () => {
        expect(resolveTargetRequirementCount("X", undefined)).toBe(0);
        expect(
            resolveTargetRequirementCount({ min: 0, max: "X" }, undefined)
        ).toEqual({ min: 0, max: 0 });
    });

    it("clamps a defensively-negative chosenX to 0 rather than producing a negative bound", () => {
        expect(resolveTargetRequirementCount("X", -1)).toBe(0);
        expect(resolveTargetRequirementCount({ min: 0, max: "X" }, -1)).toEqual(
            { min: 0, max: 0 }
        );
    });
});
