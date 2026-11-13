// The `check:ui` seam's lane shortcuts (issue #9272): `loadPosition` (a
// declared position into the lane's own solo game) and
// `saveLimitedFixtureDeck` (a Limited fixture seat saved as a deck). The
// double gate both open on is `uiSeam.test.ts`'s; here the caller is always a
// lane account on a local deployment.
//
// Two halves, and no `vi.mock` (the `node-engine` project shares modules
// across files, `isolate: false`):
//   1. the pure decisions (`lib/uiSeamShortcuts.ts`) — which game a position
//      may go into, when a repeat load is free, which deck a seat saves;
//   2. the real handlers over the in-memory db, on every path that writes
//      nothing — each refusal, and the seat that already has its deck. The
//      writes themselves are the Debug sheet's build (`lib/scenarioLoad.ts`,
//      `debugSetupScenario.test.ts`) and `userDecks.create`'s insert.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grizzlyBears } from "../cards/sets/lea/green.cards";
import { lightningBolt } from "../cards/sets/lea/red.cards";
import { laneAccountEmail } from "../lib/uiGateLaneAccount";
import { UI_SEAM_NO_SOLO_GAME_IN_PLAY } from "../lib/uiSeamNamespace";
import {
    fixtureSeatDeck,
    isLanePositionGame,
    positionStillLoaded,
} from "../lib/uiSeamShortcuts";
import * as uiSeam from "../uiSeam";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

type Handler = (ctx: unknown, args: unknown) => Promise<unknown>;
const handlerOf = (fn: unknown): Handler =>
    (fn as { _handler: Handler })._handler;
const loadPosition = handlerOf(uiSeam.loadPosition);
const saveLimitedFixtureDeck = handlerOf(uiSeam.saveLimitedFixtureDeck);

const LANE = "userlane";
const OTHER = "userother";

describe("isLanePositionGame (issue #9272)", () => {
    it("accepts only a solo game in play", () => {
        expect(isLanePositionGame({ solo: true, status: "playing" })).toBe(
            true
        );
    });

    it.each([
        ["no game", null],
        ["a two-seat game (the run's join table)", { status: "playing" }],
        ["a solo game still waiting", { solo: true, status: "waiting" }],
        ["a solo game in its pregame", { solo: true, status: "pregame" }],
    ])("refuses %s", (_label, game) => {
        expect(isLanePositionGame(game)).toBe(false);
    });
});

describe("positionStillLoaded (issue #9272)", () => {
    const live = { gameId: "game1", seq: 8 };

    it("is true only for the same game at the same seq", () => {
        expect(positionStillLoaded({ gameId: "game1", seq: 8 }, live)).toBe(
            true
        );
    });

    it.each([
        ["no guard", undefined],
        ["a save since the guarded load", { gameId: "game1", seq: 7 }],
        ["a game dealt afresh at the same seq", { gameId: "gameOld", seq: 8 }],
    ])("is false after %s", (_label, unlessAt) => {
        expect(positionStillLoaded(unlessAt, live)).toBe(false);
    });
});

describe("fixtureSeatDeck (issue #9272)", () => {
    it("puts the whole Pool in the Maindeck, coloured in WUBRG order, bound to the seat", () => {
        // Bears (G) before Bolt (R) in the Pool, yet the colours come out R
        // then G: the order is WUBRG's, never the Pool's.
        const pool = [
            {
                scryfallId: grizzlyBears().id,
                cardId: "bears",
                cardName: "Grizzly Bears",
            },
            {
                scryfallId: lightningBolt().id,
                cardId: "bolt",
                cardName: "Lightning Bolt",
            },
        ];
        expect(
            fixtureSeatDeck(pool, { eventId: "event1", seatIndex: 0 }, "deck")
        ).toEqual({
            name: "deck",
            format: "limited",
            colors: ["R", "G"],
            cards: [
                { cardId: "bears", cardName: "Grizzly Bears" },
                { cardId: "bolt", cardName: "Lightning Bolt" },
            ],
            sideboard: [],
            limitedEventId: "event1",
            limitedSeatId: "0",
        });
    });

    it("saves an empty, colourless deck from an empty Pool", () => {
        expect(
            fixtureSeatDeck([], { eventId: "e", seatIndex: 3 }, "x")
        ).toMatchObject({ cards: [], colors: [], limitedSeatId: "3" });
    });
});

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

describe("uiSeam shortcut handlers — the paths that write nothing (issue #9272)", () => {
    beforeEach(() => {
        vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([
        ["no game at all", []],
        [
            "only the run's two-seat join table",
            [
                {
                    _id: "g",
                    status: "playing",
                    players: [{ id: OTHER }, { id: LANE }],
                },
            ],
        ],
        [
            "a solo game not yet in play",
            [
                {
                    _id: "g",
                    status: "waiting",
                    solo: true,
                    players: [{ id: `${LANE}-p1` }, { id: `${LANE}-p2` }],
                },
            ],
        ],
    ])(
        "loadPosition refuses %s with the phrase the lane reads",
        async (_label, games) => {
            const ctx = laneCtx({ games });
            await expect(
                loadPosition(ctx, { label: "ui-gate board" })
            ).rejects.toThrow(UI_SEAM_NO_SOLO_GAME_IN_PLAY);
        }
    );

    const FIXTURE = "ui-gate/a1b2c3d4e5f6/draft";
    const event = {
        _id: "event1",
        label: FIXTURE,
        seats: [
            { seatIndex: 0, userId: LANE },
            { seatIndex: 1, userId: OTHER },
        ],
    };

    it("saveLimitedFixtureDeck keeps the seat's existing deck instead of saving a second", async () => {
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
    });

    it("saveLimitedFixtureDeck refuses an absent fixture", async () => {
        const ctx = laneCtx({ limitedEvents: [], userDecks: [] });
        await expect(
            saveLimitedFixtureDeck(ctx, { label: FIXTURE, name: "x" })
        ).rejects.toThrow(`Limited fixture "${FIXTURE}" is absent`);
    });

    it("saveLimitedFixtureDeck refuses a fixture the lane holds no seat at", async () => {
        const ctx = laneCtx({
            limitedEvents: [
                { ...event, seats: [{ seatIndex: 0, userId: OTHER }] },
            ],
            userDecks: [],
        });
        await expect(
            saveLimitedFixtureDeck(ctx, { label: FIXTURE, name: "x" })
        ).rejects.toThrow("holds no seat");
    });
});
