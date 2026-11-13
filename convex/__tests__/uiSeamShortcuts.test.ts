// The `check:ui` seam's lane shortcuts (issue #9272): `loadPosition` (a
// declared position into the lane's own solo game) and
// `saveLimitedFixtureDeck` (a Limited fixture seat saved as a deck). The
// double gate both open on is `uiSeam.test.ts`'s; here the caller is always a
// lane account on a local deployment, and what is asserted is WHICH game,
// event and seat each shortcut writes, and when it writes nothing at all.
//
// The two heavy writes are stubbed at their seam — `loadScenarioIntoGame`
// (the Debug sheet's own build, tested through `buildStateFromScenario`) and
// `insertUserDeck` (`userDecks.create`'s own body) — so each test pins the
// arguments a shortcut hands them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { lightningBolt } from "../cards/sets/lea/red.cards";
import { laneAccountEmail } from "../lib/uiGateLaneAccount";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

const loadScenarioIntoGame = vi.fn();
const getLatestGameState = vi.fn();
const insertUserDeck = vi.fn();
const hydrateSeat = vi.fn();

vi.mock("../lib/scenarioLoad", () => ({
    loadScenarioIntoGame: (...args: unknown[]) => loadScenarioIntoGame(...args),
}));
vi.mock("../gameStateStore", async (orig) => ({
    ...(await orig<typeof import("../gameStateStore")>()),
    getLatestGameState: (...args: unknown[]) => getLatestGameState(...args),
}));
vi.mock("../userDecks", async (orig) => ({
    ...(await orig<typeof import("../userDecks")>()),
    insertUserDeck: (...args: unknown[]) => insertUserDeck(...args),
}));
vi.mock("../limitedSeatStore", async (orig) => ({
    ...(await orig<typeof import("../limitedSeatStore")>()),
    hydrateSeat: (...args: unknown[]) => hydrateSeat(...args),
}));

import * as uiSeam from "../uiSeam";

type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;
const handlerOf = (fn: unknown): Handler =>
    (fn as { _handler: Handler })._handler;
const loadPosition = handlerOf(uiSeam.loadPosition);
const saveLimitedFixtureDeck = handlerOf(uiSeam.saveLimitedFixtureDeck);

const LANE = "userlane";
const OTHER = "userother";
const LABEL = "ui-gate board";
const SPEC = { cards: [{ name: "Forest", owner: "me" }] };

function laneCtx(tables: Record<string, Record<string, unknown>[]>) {
    const db = makeInMemoryDb(
        {
            users: [
                { _id: LANE, email: laneAccountEmail("a1b2c3d4e5f6") },
                { _id: OTHER, email: "someone@example.com" },
            ],
            ...tables,
        },
        { identitySubject: `${LANE}|s1` }
    );
    return db.ctx as unknown;
}

function soloGame(id: string, over: Record<string, unknown> = {}) {
    return {
        _id: id,
        status: "playing",
        solo: true,
        players: [{ id: `${LANE}-p1` }, { id: `${LANE}-p2` }],
        ...over,
    };
}

beforeEach(() => {
    vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    loadScenarioIntoGame.mockReset();
    getLatestGameState.mockReset();
    insertUserDeck.mockReset();
    hydrateSeat.mockReset();
});
afterEach(() => {
    vi.unstubAllEnvs();
});

describe("uiSeam.loadPosition (issue #9272)", () => {
    it("loads the labelled position into the lane's own solo game and returns the new seq", async () => {
        const ctx = laneCtx({
            games: [soloGame("game1")],
            debugScenarios: [{ _id: "s1", label: LABEL, spec: SPEC }],
        });
        getLatestGameState.mockResolvedValue({ seq: 7 });
        loadScenarioIntoGame.mockResolvedValue(8);
        await expect(loadPosition(ctx, { label: LABEL })).resolves.toEqual({
            gameId: "game1",
            seq: 8,
            loaded: true,
        });
        expect(loadScenarioIntoGame).toHaveBeenCalledTimes(1);
        const [, gameId, spec] = loadScenarioIntoGame.mock.calls[0];
        expect(gameId).toBe("game1");
        // The stored spec goes through the same tolerant normalisation the
        // Debug sheet applies (ADR 0044) — the card survives it.
        expect((spec as { cards: { name: string }[] }).cards[0].name).toBe(
            "Forest"
        );
    });

    it("rebuilds nothing when the same game still stands at the guarded seq", async () => {
        const ctx = laneCtx({
            games: [soloGame("game1")],
            debugScenarios: [{ _id: "s1", label: LABEL, spec: SPEC }],
        });
        getLatestGameState.mockResolvedValue({ seq: 8 });
        await expect(
            loadPosition(ctx, {
                label: LABEL,
                unlessAt: { gameId: "game1", seq: 8 },
            })
        ).resolves.toEqual({ gameId: "game1", seq: 8, loaded: false });
        expect(loadScenarioIntoGame).not.toHaveBeenCalled();
    });

    it.each([
        ["a save since the guarded load", { gameId: "game1", seq: 8 }, 9],
        [
            "a game dealt afresh at the same seq",
            { gameId: "gameOld", seq: 8 },
            8,
        ],
    ])("loads again after %s", async (_label, unlessAt, seq) => {
        const ctx = laneCtx({
            games: [soloGame("game1")],
            debugScenarios: [{ _id: "s1", label: LABEL, spec: SPEC }],
        });
        getLatestGameState.mockResolvedValue({ seq });
        loadScenarioIntoGame.mockResolvedValue(seq + 1);
        await expect(
            loadPosition(ctx, { label: LABEL, unlessAt })
        ).resolves.toMatchObject({ loaded: true, seq: seq + 1 });
        expect(loadScenarioIntoGame).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["no game at all", []],
        [
            "a two-seat game (the run's join table)",
            [
                soloGame("g", {
                    solo: undefined,
                    players: [{ id: OTHER }, { id: LANE }],
                }),
            ],
        ],
        [
            "a solo game still in its pregame",
            [soloGame("g", { status: "waiting" })],
        ],
    ])(
        "refuses %s, naming the missing solo game in play",
        async (_label, games) => {
            const ctx = laneCtx({
                games,
                debugScenarios: [{ _id: "s1", label: LABEL, spec: SPEC }],
            });
            await expect(loadPosition(ctx, { label: LABEL })).rejects.toThrow(
                "no solo game in play"
            );
            expect(loadScenarioIntoGame).not.toHaveBeenCalled();
        }
    );

    it("refuses an absent label without touching the game", async () => {
        const ctx = laneCtx({ games: [soloGame("game1")], debugScenarios: [] });
        getLatestGameState.mockResolvedValue({ seq: 3 });
        await expect(loadPosition(ctx, { label: LABEL })).rejects.toThrow(
            `debug scenario "${LABEL}" is absent`
        );
        expect(loadScenarioIntoGame).not.toHaveBeenCalled();
    });
});

describe("uiSeam.saveLimitedFixtureDeck (issue #9272)", () => {
    const FIXTURE = "ui-gate-draft-a1b2c3d4e5f6";
    const event = {
        _id: "event1",
        label: FIXTURE,
        seats: [
            { seatIndex: 0, userId: LANE },
            { seatIndex: 1, userId: OTHER },
        ],
    };
    // Grizzly Bears (G) and Lightning Bolt (R): the deck's colours come out
    // in WUBRG order whatever the Pool's order.
    const pool = [
        {
            scryfallId: lightningBolt().id,
            cardId: "bolt",
            cardName: "Lightning Bolt",
        },
        {
            scryfallId: grizzlyBears().id,
            cardId: "bears",
            cardName: "Grizzly Bears",
        },
    ];

    it("saves the lane's seat as a Limited deck with the whole Pool in the Maindeck", async () => {
        const ctx = laneCtx({ limitedEvents: [event], userDecks: [] });
        hydrateSeat.mockResolvedValue([{ seatIndex: 0, userId: LANE, pool }]);
        insertUserDeck.mockResolvedValue("deck1");
        await expect(
            saveLimitedFixtureDeck(ctx, { label: FIXTURE, name: "archive" })
        ).resolves.toEqual({ deckId: "deck1", created: true });
        expect(insertUserDeck).toHaveBeenCalledTimes(1);
        const [, userId, args] = insertUserDeck.mock.calls[0];
        expect(userId).toBe(LANE);
        expect(args).toEqual({
            name: "archive",
            format: "limited",
            colors: ["R", "G"],
            cards: [
                { cardId: "bolt", cardName: "Lightning Bolt" },
                { cardId: "bears", cardName: "Grizzly Bears" },
            ],
            sideboard: [],
            limitedEventId: "event1",
            limitedSeatId: "0",
        });
    });

    it("keeps a seat's existing deck instead of saving a second", async () => {
        const ctx = laneCtx({
            limitedEvents: [event],
            userDecks: [
                {
                    _id: "deckOther",
                    userId: OTHER,
                    limitedEventId: "event1",
                    limitedSeatId: "1",
                },
                {
                    _id: "deckMine",
                    userId: LANE,
                    limitedEventId: "event1",
                    limitedSeatId: "0",
                },
            ],
        });
        await expect(
            saveLimitedFixtureDeck(ctx, { label: FIXTURE, name: "archive" })
        ).resolves.toEqual({ deckId: "deckMine", created: false });
        expect(insertUserDeck).not.toHaveBeenCalled();
    });

    it("refuses an absent fixture", async () => {
        const ctx = laneCtx({ limitedEvents: [], userDecks: [] });
        await expect(
            saveLimitedFixtureDeck(ctx, { label: FIXTURE, name: "x" })
        ).rejects.toThrow(`Limited fixture "${FIXTURE}" is absent`);
    });

    it("refuses a fixture the lane holds no seat at", async () => {
        const ctx = laneCtx({
            limitedEvents: [
                { ...event, seats: [{ seatIndex: 0, userId: OTHER }] },
            ],
            userDecks: [],
        });
        await expect(
            saveLimitedFixtureDeck(ctx, { label: FIXTURE, name: "x" })
        ).rejects.toThrow("holds no seat");
        expect(insertUserDeck).not.toHaveBeenCalled();
    });
});
