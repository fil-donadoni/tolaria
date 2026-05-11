import { describe, it, expect } from "vitest";
import { getLegalActions, assertLegalAction } from "../rules";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { makeInstance } from "../../cards/__tests__/setup";
import {
    ancestralRecall,
    armageddon,
    birdsOfParadise,
    crusade,
    fireball,
    giantGrowth,
    lightningBolt,
    mountain,
    plains,
    savannahLions,
} from "../../cards/sets/lea";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function card(
    cardId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(cardId, overrides);
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
        // Default to ample mana so timing-focused tests aren't gated by the
        // canCast mana check (CR 601.2f). Tests that exercise the mana check
        // explicitly override manaPool / battlefield.
        manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
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
// getLegalActions — CR 601.2 (casting), CR 305.2 (playing lands)
// ---------------------------------------------------------------------------

describe("getLegalActions", () => {
    describe("lands (CR 305.2)", () => {
        it('land cards have "play" action', () => {
            const state = makeGameState();
            const player = makePlayer();
            const land = card(plains.id);

            const actions = getLegalActions(state, player, land);
            expect(actions).toContain("play");
        });

        it('land cards do NOT have "cast" action (CR 305.1 — lands are not spells)', () => {
            const state = makeGameState();
            const player = makePlayer();
            const land = card(plains.id);

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("cast");
        });

        it('blocks "play" once the per-turn land drop is spent (CR 305.2)', () => {
            const state = makeGameState();
            const player = makePlayer({ landsPlayedThisTurn: 1 });
            const land = card(plains.id);

            const actions = getLegalActions(state, player, land);
            expect(actions).not.toContain("play");
        });

        it("treats undefined landsPlayedThisTurn as 0 (CR 305.2)", () => {
            const state = makeGameState();
            const player = makePlayer({ landsPlayedThisTurn: undefined });
            const land = card(plains.id);

            const actions = getLegalActions(state, player, land);
            expect(actions).toContain("play");
        });
    });

    describe("creatures (sorcery speed — CR 307.1 by analogy)", () => {
        it("creature can be cast when stack is empty", () => {
            const state = makeGameState();
            const player = makePlayer();
            const lion = card(savannahLions.id);

            const actions = getLegalActions(state, player, lion);
            expect(actions).toContain("cast");
        });

        it("creature cannot be cast when stack is non-empty (sorcery timing)", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...card(lightningBolt.id, { zone: "stack" }),
                        castById: "p2",
                    },
                ],
            });
            const player = makePlayer();
            const lion = card(savannahLions.id);

            const actions = getLegalActions(state, player, lion);
            expect(actions).not.toContain("cast");
        });

        it('creature does NOT have "play" action', () => {
            const state = makeGameState();
            const player = makePlayer();
            const lion = card(savannahLions.id);

            const actions = getLegalActions(state, player, lion);
            expect(actions).not.toContain("play");
        });
    });

    describe("instants (CR 304.1 — can be cast any time priority is held)", () => {
        it("instant can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const bolt = card(lightningBolt.id);

            const actions = getLegalActions(state, player, bolt);
            expect(actions).toContain("cast");
        });

        it("instant can be cast with non-empty stack (responding)", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...card(savannahLions.id, { zone: "stack" }),
                        castById: "p1",
                    },
                ],
            });
            const player = makePlayer();
            const bolt = card(lightningBolt.id);

            const actions = getLegalActions(state, player, bolt);
            expect(actions).toContain("cast");
        });

        it("instant does NOT have play action", () => {
            const state = makeGameState();
            const player = makePlayer();
            const bolt = card(lightningBolt.id);

            const actions = getLegalActions(state, player, bolt);
            expect(actions).not.toContain("play");
        });
    });

    describe("sorceries (CR 307.1 — sorcery timing only)", () => {
        it("sorcery can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const sorcery = card(armageddon.id);

            const actions = getLegalActions(state, player, sorcery);
            expect(actions).toContain("cast");
        });

        it("sorcery cannot be cast with non-empty stack", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...card(lightningBolt.id, { zone: "stack" }),
                        castById: "p2",
                    },
                ],
            });
            const player = makePlayer();
            const sorcery = card(armageddon.id);

            const actions = getLegalActions(state, player, sorcery);
            expect(actions).not.toContain("cast");
        });
    });

    describe("enchantments (sorcery timing — CR 303.1 by analogy)", () => {
        it("enchantment can be cast with empty stack", () => {
            const state = makeGameState();
            const player = makePlayer();
            const aura = card(crusade.id);

            const actions = getLegalActions(state, player, aura);
            expect(actions).toContain("cast");
        });

        it("enchantment cannot be cast with non-empty stack", () => {
            const state = makeGameState({
                stack: [
                    {
                        ...card(giantGrowth.id, { zone: "stack" }),
                        castById: "p1",
                    },
                ],
            });
            const player = makePlayer();
            const aura = card(crusade.id);

            const actions = getLegalActions(state, player, aura);
            expect(actions).not.toContain("cast");
        });
    });

    describe("priority (CR 117.1)", () => {
        it("returns no actions when player does not have priority", () => {
            const state = makeGameState({ priorityPlayerId: "p2" });
            const player = makePlayer({ id: "p1" });
            const land = card(plains.id);
            const instant = card(lightningBolt.id);
            const creature = card(savannahLions.id);

            expect(getLegalActions(state, player, land)).toEqual([]);
            expect(getLegalActions(state, player, instant)).toEqual([]);
            expect(getLegalActions(state, player, creature)).toEqual([]);
        });

        it("returns actions when player has priority", () => {
            const state = makeGameState({ priorityPlayerId: "p1" });
            const player = makePlayer({ id: "p1" });
            const bolt = card(lightningBolt.id);

            expect(getLegalActions(state, player, bolt)).toContain("cast");
        });
    });

    describe("mana availability (CR 601.2f — payment check)", () => {
        it('blocks "cast" when pool and battlefield cannot cover cost', () => {
            const state = makeGameState();
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).not.toContain("cast");
        });

        it('allows "cast" when pool exactly covers a colored cost', () => {
            const state = makeGameState();
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
                battlefield: [],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).toContain("cast");
        });

        it('allows "cast" when an untapped basic land covers the cost', () => {
            const land = card(mountain.id, {
                zone: "battlefield",
                isTapped: false,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [land],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).toContain("cast");
        });

        it('blocks "cast" when the only land is tapped', () => {
            const land = card(mountain.id, {
                zone: "battlefield",
                isTapped: true,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [land],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).not.toContain("cast");
        });

        it('blocks "cast" when only off-color sources are available', () => {
            const land = card(plains.id, {
                zone: "battlefield",
                isTapped: false,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [land],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const bolt = card(lightningBolt.id);
            expect(getLegalActions(state, player, bolt)).not.toContain("cast");
        });

        it("ignores a summoning-sick creature mana source (CR 302.1)", () => {
            // Birds of Paradise just ETB'd: mana ability requires {T} but
            // the creature can't tap on the turn it entered — so it cannot
            // satisfy a {G} cost on a Giant Growth in hand. The bird itself
            // is a legal target for the Growth (creature on the battlefield),
            // so the cast is gated purely on mana availability.
            const birds = card(birdsOfParadise.id, {
                zone: "battlefield",
                isSummoningSick: true,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [birds],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const growth = card(giantGrowth.id);
            expect(getLegalActions(state, player, growth)).not.toContain(
                "cast"
            );
        });

        it("counts a creature mana source once summoning sickness has worn off", () => {
            const birds = card(birdsOfParadise.id, {
                zone: "battlefield",
                isSummoningSick: false,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [birds],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            const growth = card(giantGrowth.id);
            expect(getLegalActions(state, player, growth)).toContain("cast");
        });

        it('allows "cast" for an X-cost spell when only the fixed portion is payable', () => {
            const land = card(mountain.id, {
                zone: "battlefield",
                isTapped: false,
            });
            const player = makePlayer({
                manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
                battlefield: [land],
            });
            const state = makeGameState({
                players: [player, makePlayer({ id: "p2" })],
            });
            // Fireball: { X: "X", R: 1 } — minimum announce cost is {R}.
            const spell = card(fireball.id);
            expect(getLegalActions(state, player, spell)).toContain("cast");
        });
    });

    describe("debugAllActions mode", () => {
        it("returns all actions regardless of card type", () => {
            const state = makeGameState();
            const player = makePlayer();
            const land = card(plains.id);

            const actions = getLegalActions(state, player, land, true);
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
        const land = card(plains.id);

        expect(() =>
            assertLegalAction(state, player, land, "play")
        ).not.toThrow();
    });

    it("throws for an illegal action with descriptive message", () => {
        const state = makeGameState();
        const player = makePlayer();
        const land = card(plains.id);

        expect(() => assertLegalAction(state, player, land, "cast")).toThrow(
            'Illegal action "cast" on "Plains"'
        );
    });

    it("throws when casting creature with non-empty stack", () => {
        const state = makeGameState({
            stack: [
                {
                    ...card(lightningBolt.id, { zone: "stack" }),
                    castById: "p2",
                },
            ],
        });
        const player = makePlayer();
        const lion = card(savannahLions.id);

        expect(() => assertLegalAction(state, player, lion, "cast")).toThrow(
            'Illegal action "cast" on "Savannah Lions"'
        );
    });

    it("does NOT throw when casting instant with non-empty stack", () => {
        const state = makeGameState({
            stack: [
                {
                    ...card(savannahLions.id, { zone: "stack" }),
                    castById: "p1",
                },
            ],
        });
        const player = makePlayer();
        // Ancestral Recall targets a player (always available) — keeps the
        // test focused on timing rather than target availability.
        const instant = card(ancestralRecall.id);

        expect(() =>
            assertLegalAction(state, player, instant, "cast")
        ).not.toThrow();
    });
});
