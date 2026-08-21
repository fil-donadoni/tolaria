// "Join by code" end-to-end (issue #2649).
//
// The project has no convex-test harness (see `limitedChallenge.test.ts`), so
// this drives the REAL registered mutation handlers — `createGame`,
// `joinGame`, `joinGameByCode`, `listOpenGames` — against the shared in-memory
// ctx (`fixtures/inMemoryDb.ts`). Real control flow, real guard order, fake
// storage: the full createGame → mint → resolve → seat path, which is exactly
// the seam a per-function test cannot see.
//
// Two claims carry this file:
//
//   1. FAIL-CLOSED. Every way a code can fail to name an open table — unknown,
//      malformed, stale, started, full, or naming a class of game codes are
//      not issued for — produces the SAME message and NO write. A code that
//      resolved to a finished or private game would be a silent data leak and
//      a broken join; nothing about it would throw on its own.
//   2. ONE guard body. `joinGameByCode` and `joinGame` are the same twelve
//      guards in the same order, differing only in how the target is
//      addressed. The paired-error tests below are the proof: if someone
//      re-implements the sequence in one entry point, the pair diverges.
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createGame, joinGame, joinGameByCode, listOpenGames } from "../game";
import { JOIN_CODE_REJECTED, mintJoinCode } from "../joinCodes";
import { makeInMemoryDb, type InMemoryRow } from "./fixtures/inMemoryDb";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: MutationCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: MutationCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

/** Freeform has `minMain: 0` and no set restriction (`convex/formats.ts`), so
 *  an empty list is a LEGAL deck — the deck gate is not what this file tests
 *  and a real decklist would drag the whole card registry in. */
const DECK = {
    id: "deck-1",
    name: "Test Deck",
    format: "freeform",
    cards: [] as { cardId: string; cardName: string }[],
};

const ALICE = "user-alice";
const BOB = "user-bob";

function users(): InMemoryRow[] {
    return [
        { _id: ALICE, nickname: "Alice", email: "a@example.com" },
        { _id: BOB, nickname: "Bob", email: "b@example.com" },
    ];
}

/** A `games` row shaped like whatever class the test is probing. */
function gameRow(over: Partial<InMemoryRow> = {}): InMemoryRow {
    return {
        _id: "game-x",
        name: "Alice's table",
        matchId: "match-x",
        gameNumber: 1,
        status: "waiting",
        players: [
            {
                id: ALICE,
                name: "Alice",
                bgColor: "#000",
                deck: { id: "d", name: "D", format: "freeform" },
            },
        ],
        joinCode: "K3M9XZ",
        createdAt: 1,
        updatedAt: 1,
        ...over,
    };
}

function seat(id: string, name: string) {
    return {
        id,
        name,
        bgColor: "#000",
        score: 0,
        ready: false,
        deck: { id: "d", name: "D", format: "freeform" },
    };
}

/** Alice's game as Bob sees it: Bob is authenticated, Alice's row carries the
 *  code, and the owning Match exists but is NOT Bob's. */
function bobFacing(over: Partial<InMemoryRow> = {}) {
    return makeInMemoryDb(
        {
            users: users(),
            games: [gameRow(over)],
            matches: [
                {
                    _id: "match-x",
                    bestOf: 1,
                    status: "waiting",
                    players: [seat(ALICE, "Alice")],
                    currentGameNumber: 1,
                    currentGameId: "game-x",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
            gameDecks: [
                { _id: "gd-1", gameId: "game-x", playerId: ALICE, cards: [] },
            ],
        },
        { identitySubject: BOB }
    );
}

async function rejection(fn: () => Promise<unknown>): Promise<string> {
    try {
        await fn();
    } catch (e) {
        return (e as Error).message;
    }
    throw new Error("expected the call to throw, but it resolved");
}

describe("join by code — the full createGame → join path", () => {
    it("mints a code on an open table and seats the joiner with it", async () => {
        const host = makeInMemoryDb(
            { users: users() },
            { identitySubject: ALICE }
        );
        const gameId = (await run(createGame, host.ctx, {
            name: "Alice's table",
            deck: DECK,
        })) as Id<"games">;

        const created = host.tables.games!.find((g) => g._id === gameId)!;
        const code = created.joinCode as string;
        expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);

        // Same storage, now authenticated as Bob — the join is a second
        // mutation against the state the first one wrote.
        const joiner = makeInMemoryDb(host.tables, { identitySubject: BOB });
        const result = await run(joinGameByCode, joiner.ctx, {
            code,
            deck: { ...DECK, id: "deck-2", name: "Bob's Deck" },
        });

        expect(result).toEqual({ gameId });
        const joined = joiner.tables.games!.find((g) => g._id === gameId)!;
        expect(joined.status).toBe("pregame");
        expect((joined.players as { id: string }[]).map((p) => p.id)).toEqual([
            ALICE,
            BOB,
        ]);
        // Lifecycle: the code's life IS the `waiting` window. Once seated the
        // table has no code at all, so nothing is left for it to name.
        expect(joined.joinCode).toBeUndefined();
    });

    it("accepts the code as a human would retype it — case, dashes, folded glyphs", async () => {
        for (const shape of [
            (c: string) => c.toLowerCase(),
            (c: string) => `${c.slice(0, 3)}-${c.slice(3)}`,
            (c: string) => `  ${c}  `,
        ]) {
            const host = makeInMemoryDb(
                { users: users() },
                { identitySubject: ALICE }
            );
            const gameId = await run(createGame, host.ctx, {
                name: "T",
                deck: DECK,
            });
            const code = host.tables.games![0]!.joinCode as string;
            const joiner = makeInMemoryDb(host.tables, {
                identitySubject: BOB,
            });
            await expect(
                run(joinGameByCode, joiner.ctx, {
                    code: shape(code),
                    deck: DECK,
                })
            ).resolves.toEqual({ gameId });
        }
    });

    it("re-rolls until the code is free rather than issuing a duplicate", async () => {
        const db = makeInMemoryDb({
            games: [gameRow({ _id: "taken", joinCode: "AAAAAA" })],
        });
        // An RNG that yields the taken code first, then a free one.
        const rolls = [
            ...Array<number>(6).fill(0), // → "AAAAAA" (index 10 is 'A')
            ...Array<number>(6).fill(0.99), // → "ZZZZZZ"
        ].map((v) => (v === 0 ? 10 / 32 : v));
        let i = 0;
        const code = await mintJoinCode(db.ctx, () => rolls[i++]!);
        expect(code).toBe("ZZZZZZ");
    });
});

// One row per way a code can point at something it must not open. Derived from
// the producer census in the PR body, NOT from the implementation: each row is
// a class of `games` row that exists in this schema today.
const NOT_JOINABLE: [label: string, over: Partial<InMemoryRow>][] = [
    ["a table already in pregame", { status: "pregame" }],
    ["a table already playing", { status: "playing" }],
    ["a finished game", { status: "finished" }],
    [
        "a full table",
        {
            players: [
                {
                    id: ALICE,
                    name: "Alice",
                    bgColor: "#000",
                    deck: { id: "d", name: "D", format: "freeform" },
                },
                {
                    id: "user-carol",
                    name: "Carol",
                    bgColor: "#111",
                    deck: { id: "d", name: "D", format: "freeform" },
                },
            ],
        },
    ],
    ["a Tabletop (manual-mode) table", { mode: "manual" }],
    ["a solo game", { solo: true }],
    ["a vs-AI game", { vsAi: true }],
    [
        "a Limited challenge addressed to one seat",
        {
            limitedChallenge: {
                challengerSeatIndex: 0,
                challengedUserId: "user-carol",
                challengedSeatIndex: 1,
            },
        },
    ],
    [
        "a Limited round pairing",
        { limitedPairing: { round: 1, seatA: 0, seatB: 1 } },
    ],
    ["a game bound to a Limited event", { limitedEventId: "event-1" }],
];

describe("join by code — fail-closed", () => {
    for (const [label, over] of NOT_JOINABLE) {
        it(`refuses a code sitting on ${label}, with the uniform message`, async () => {
            const db = bobFacing(over);
            const before = structuredClone(db.tables.games);
            expect(
                await rejection(() =>
                    run(joinGameByCode, db.ctx, { code: "K3M9XZ", deck: DECK })
                )
            ).toBe(JOIN_CODE_REJECTED);
            // No partial join: the row is byte-identical to before.
            expect(db.tables.games).toEqual(before);
        });
    }

    it("refuses an unknown code — no row holds it", async () => {
        const db = bobFacing();
        expect(
            await rejection(() =>
                run(joinGameByCode, db.ctx, { code: "ZZZZZZ", deck: DECK })
            )
        ).toBe(JOIN_CODE_REJECTED);
    });

    it("refuses a code whose game was deleted (abandoned via leaveGame)", async () => {
        const db = bobFacing();
        db.tables.games = [];
        expect(
            await rejection(() =>
                run(joinGameByCode, db.ctx, { code: "K3M9XZ", deck: DECK })
            )
        ).toBe(JOIN_CODE_REJECTED);
    });

    it("refuses a malformed code without revealing that it was malformed", async () => {
        const db = bobFacing();
        for (const bad of ["", "K3M9X", "K3M9XZ7", "K3M9XU", "!!!!!!"]) {
            expect(
                await rejection(() =>
                    run(joinGameByCode, db.ctx, { code: bad, deck: DECK })
                )
            ).toBe(JOIN_CODE_REJECTED);
        }
    });

    it("still rejects a Tabletop deck before it ever looks at the code", async () => {
        // Guard ORDER, not just guard presence: the deck-mode gate (ADR 0080)
        // runs first in the shared body, so a manual deck is refused with its
        // own message even when the code is perfectly good.
        const db = bobFacing();
        expect(
            await rejection(() =>
                run(joinGameByCode, db.ctx, {
                    code: "K3M9XZ",
                    deck: { ...DECK, format: "manual" },
                })
            )
        ).toContain("Tabletop decks cannot start a real game");
    });
});

describe("join by code — one guard body, two entry points", () => {
    // If either entry point grows its own copy of the guard sequence, these
    // pairs diverge. That is the whole reason the body was extracted.
    const SHARED: [label: string, over: Partial<InMemoryRow>][] = [
        ["a table that is full", NOT_JOINABLE[3]![1]],
        ["a table already playing", { status: "playing" }],
    ];

    for (const [label, over] of SHARED) {
        it(`reports ${label} to joinGame and joinGameByCode consistently`, async () => {
            const byId = bobFacing(over);
            const byIdError = await rejection(() =>
                run(joinGame, byId.ctx, { gameId: "game-x", deck: DECK })
            );
            const byCode = bobFacing(over);
            const byCodeError = await rejection(() =>
                run(joinGameByCode, byCode.ctx, {
                    code: "K3M9XZ",
                    deck: DECK,
                })
            );
            // The by-id path names the specific reason; the by-code path
            // deliberately collapses it — but BOTH must refuse, and neither
            // may write.
            expect(byIdError).not.toBe("");
            expect(byCodeError).toBe(JOIN_CODE_REJECTED);
            expect(byCode.tables.games).toEqual(byId.tables.games);
        });
    }

    it("refuses the host their own table's code with the same 'already in' guard as by-id", async () => {
        // Alice is seated in game-x. Her own waiting Match would normally trip
        // the single-active-match guard first, so this fixture has no Match —
        // isolating the seat guard the shared body owns.
        const seated = (subject: string) =>
            makeInMemoryDb(
                {
                    users: users(),
                    games: [gameRow({ matchId: undefined })],
                    gameDecks: [
                        {
                            _id: "gd-1",
                            gameId: "game-x",
                            playerId: ALICE,
                            cards: [],
                        },
                    ],
                },
                { identitySubject: subject }
            );
        const byId = seated(ALICE);
        const byCode = seated(ALICE);
        const expected = "Cannot join a game you are already in";
        expect(
            await rejection(() =>
                run(joinGame, byId.ctx, { gameId: "game-x", deck: DECK })
            )
        ).toBe(expected);
        expect(
            await rejection(() =>
                run(joinGameByCode, byCode.ctx, {
                    code: "K3M9XZ",
                    deck: DECK,
                })
            )
        ).toBe(expected);
    });

    it("refuses a joiner who already has an active match, code or no code", async () => {
        const withBobsMatch = () => {
            const db = bobFacing();
            db.tables.matches!.push({
                _id: "match-bob",
                bestOf: 1,
                status: "playing",
                players: [seat(BOB, "Bob")],
                currentGameNumber: 1,
                createdAt: 1,
                updatedAt: 1,
            });
            return db;
        };
        const byId = withBobsMatch();
        const byCode = withBobsMatch();
        const a = await rejection(() =>
            run(joinGame, byId.ctx, { gameId: "game-x", deck: DECK })
        );
        const b = await rejection(() =>
            run(joinGameByCode, byCode.ctx, { code: "K3M9XZ", deck: DECK })
        );
        // Same guard, same message — and it fires BEFORE the code is
        // resolved, so a busy player learns nothing about the code either.
        expect(b).toBe(a);
    });
});

describe("listOpenGames — a code is the host's to share", () => {
    it("never carries another player's join code on the lobby subscription", async () => {
        const db = bobFacing();
        const rows = await run(listOpenGames, db.ctx, {});
        expect(rows).toHaveLength(1);
        expect(rows[0]!._id).toBe("game-x");
        expect("joinCode" in rows[0]!).toBe(false);
    });
});
