import { describe, it, expect } from "vitest";
import { getLegalActions, assertLegalAction } from "../rules";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import type { CardType } from "../../cards/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCard(
    cardData: Record<string, unknown>,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        card: cardData,
        types: (cardData.types as CardType[]) ?? [],
        subtypes: (cardData.subtypes as string[]) ?? [],
        power: cardData.power as number | undefined,
        toughness: cardData.toughness as number | undefined,
        staticAbilities: (cardData.staticAbilities as string[]) ?? [],
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

// Card fixtures
const PLAINS = { name: "Plains", types: ["Land"], subtypes: ["Plains"] };
const SAVANNAH_LIONS = {
    name: "Savannah Lions",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Cat"],
};
const LIGHTNING_BOLT = {
    name: "Lightning Bolt",
    manaCost: { R: 1 },
    types: ["Instant"],
};
const ARMAGEDDON = {
    name: "Armageddon",
    manaCost: { X: 3, W: 1 },
    types: ["Sorcery"],
};
const GIANT_GROWTH = {
    name: "Giant Growth",
    manaCost: { G: 1 },
    types: ["Instant"],
};
const ANIMATE_WALL = {
    name: "Animate Wall",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
};

// ---------------------------------------------------------------------------
// getLegalActions — CR 601.2 (casting), CR 305.2 (playing lands)
// ---------------------------------------------------------------------------

describe("getLegalActions", () => {
    describe("lands (CR 305.2)", () => {
        it('land cards have "play" action', () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(PLAINS);

            const actions = getLegalActions(state, player, card);
            expect(actions).toContain("play");
        });

        it('land cards do NOT have "cast" action (CR 305.1 — lands are not spells)', () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(PLAINS);

            const actions = getLegalActions(state, player, card);
            expect(actions).not.toContain("cast");
        });
    });

    describe("creatures (sorcery speed — CR 307.1 by analogy)", () => {
        it("creature can be cast when stack is empty", () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(SAVANNAH_LIONS);

            const actions = getLegalActions(state, player, card);
            expect(actions).toContain("cast");
        });

        it("creature cannot be cast when stack is non-empty (sorcery timing)", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...makeCard(LIGHTNING_BOLT, { zone: "stack" }),
                        castById: "p2",
                    },
                ],
            });
            const player = makePlayer();
            const card = makeCard(SAVANNAH_LIONS);

            const actions = getLegalActions(state, player, card);
            expect(actions).not.toContain("cast");
        });

        it('creature does NOT have "play" action', () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(SAVANNAH_LIONS);

            const actions = getLegalActions(state, player, card);
            expect(actions).not.toContain("play");
        });
    });

    describe("instants (CR 304.1 — can be cast any time priority is held)", () => {
        it("instant can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(LIGHTNING_BOLT);

            const actions = getLegalActions(state, player, card);
            expect(actions).toContain("cast");
        });

        it("instant can be cast with non-empty stack (responding)", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...makeCard(SAVANNAH_LIONS, { zone: "stack" }),
                        castById: "p1",
                    },
                ],
            });
            const player = makePlayer();
            const card = makeCard(LIGHTNING_BOLT);

            const actions = getLegalActions(state, player, card);
            expect(actions).toContain("cast");
        });

        it("instant does NOT have play action", () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(LIGHTNING_BOLT);

            const actions = getLegalActions(state, player, card);
            expect(actions).not.toContain("play");
        });
    });

    describe("sorceries (CR 307.1 — sorcery timing only)", () => {
        it("sorcery can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(ARMAGEDDON);

            const actions = getLegalActions(state, player, card);
            expect(actions).toContain("cast");
        });

        it("sorcery cannot be cast with non-empty stack", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...makeCard(LIGHTNING_BOLT, { zone: "stack" }),
                        castById: "p2",
                    },
                ],
            });
            const player = makePlayer();
            const card = makeCard(ARMAGEDDON);

            const actions = getLegalActions(state, player, card);
            expect(actions).not.toContain("cast");
        });
    });

    describe("enchantments (sorcery timing — CR 303.1 by analogy)", () => {
        it("enchantment can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(ANIMATE_WALL);

            const actions = getLegalActions(state, player, card);
            expect(actions).toContain("cast");
        });

        it("enchantment cannot be cast with non-empty stack", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...makeCard(GIANT_GROWTH, { zone: "stack" }),
                        castById: "p1",
                    },
                ],
            });
            const player = makePlayer();
            const card = makeCard(ANIMATE_WALL);

            const actions = getLegalActions(state, player, card);
            expect(actions).not.toContain("cast");
        });
    });

    describe("priority (CR 117.1)", () => {
        it("returns no actions when player does not have priority", () => {
            const state = makeGameState({ priorityPlayerId: "p2" });
            const player = makePlayer({ id: "p1" });
            const land = makeCard(PLAINS);
            const instant = makeCard(LIGHTNING_BOLT);
            const creature = makeCard(SAVANNAH_LIONS);

            expect(getLegalActions(state, player, land)).toEqual([]);
            expect(getLegalActions(state, player, instant)).toEqual([]);
            expect(getLegalActions(state, player, creature)).toEqual([]);
        });

        it("returns actions when player has priority", () => {
            const state = makeGameState({ priorityPlayerId: "p1" });
            const player = makePlayer({ id: "p1" });
            const card = makeCard(LIGHTNING_BOLT);

            expect(getLegalActions(state, player, card)).toContain("cast");
        });
    });

    describe("debugAllActions mode", () => {
        it("returns all actions regardless of card type", () => {
            const state = makeGameState();
            const player = makePlayer();
            const card = makeCard(PLAINS);

            const actions = getLegalActions(state, player, card, true);
            expect(actions).toContain("play");
            expect(actions).toContain("cast");
            expect(actions).toContain("discard");
            expect(actions).toContain("putToGraveyard");
            expect(actions).toContain("putToExile");
            expect(actions).toContain("putToLibrary");
        });
    });
});

// ---------------------------------------------------------------------------
// assertLegalAction
// ---------------------------------------------------------------------------

describe("assertLegalAction", () => {
    it("does not throw for a legal action", () => {
        const state = makeGameState();
        const player = makePlayer();
        const card = makeCard(PLAINS);

        expect(() =>
            assertLegalAction(state, player, card, "play")
        ).not.toThrow();
    });

    it("throws for an illegal action with descriptive message", () => {
        const state = makeGameState();
        const player = makePlayer();
        const card = makeCard(PLAINS);

        expect(() => assertLegalAction(state, player, card, "cast")).toThrow(
            'Illegal action "cast" on "Plains"'
        );
    });

    it("throws when casting creature with non-empty stack", () => {
        const state = makeGameState({
            stack: [
                {
                    ...makeCard(LIGHTNING_BOLT, { zone: "stack" }),
                    castById: "p2",
                },
            ],
        });
        const player = makePlayer();
        const card = makeCard(SAVANNAH_LIONS);

        expect(() => assertLegalAction(state, player, card, "cast")).toThrow(
            'Illegal action "cast" on "Savannah Lions"'
        );
    });

    it("does NOT throw when casting instant with non-empty stack", () => {
        const state = makeGameState({
            stack: [
                {
                    ...makeCard(SAVANNAH_LIONS, { zone: "stack" }),
                    castById: "p1",
                },
            ],
        });
        const player = makePlayer();
        const card = makeCard(GIANT_GROWTH);

        expect(() =>
            assertLegalAction(state, player, card, "cast")
        ).not.toThrow();
    });
});
