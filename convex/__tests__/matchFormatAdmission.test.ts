// Match Format admission on every create and join (ADR 0153, issue #5339).
//
// A Match carries the Match Format it was created with; every seated Deck —
// the host's, `createSoloGame`'s `deck2`, the joiner's — is admitted against
// THAT, never against another Deck. A waiting Match from before the field
// existed derives it from its host's Deck Format (`resolveMatchFormat`).
//
// Freeform decks with no cards are LEGAL (`minMain: 0`, no set list), so each
// refusal here is the admission gate's, not deck legality's. A Premodern deck
// with no cards is illegal, so it only ever sits where admission is checked
// first (`createSoloGame`) or as a fixture host seat no gate re-validates.

import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import { createGame, createSoloGame, joinGame, joinGameByCode } from "../game";
import { getJoinInfo, listOpenGames } from "../gameReads";
import {
    makeInMemoryDb,
    type InMemoryRow,
} from "./fixtures/inMemoryDb.fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: MutationCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: MutationCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

const FREEFORM = {
    id: "deck-1",
    name: "Freeform Deck",
    format: "freeform",
    cards: [] as { cardId: string; cardName: string }[],
};
const PREMODERN = { ...FREEFORM, id: "deck-2", format: "premodern" };

const ALICE = "user-alice";
const BOB = "user-bob";

const REFUSAL = /Match's Format is .*decks cannot sit at it/;

function users(): InMemoryRow[] {
    return [
        { _id: ALICE, nickname: "Alice", email: "a@example.com" },
        { _id: BOB, nickname: "Bob", email: "b@example.com" },
    ];
}

async function rejection(fn: () => Promise<unknown>): Promise<string> {
    try {
        await fn();
    } catch (e) {
        return (e as Error).message;
    }
    throw new Error("expected the call to throw, but it resolved");
}

/** Alice's waiting table as Bob sees it. `hostFormat` is the host seat's Deck
 *  Format; `matchFormat` the Match's stored one — omitted for a Match created
 *  before ADR 0153. */
function bobFacing(hostFormat: string, matchFormat?: string) {
    const hostDeck = { id: "d", name: "D", format: hostFormat };
    return makeInMemoryDb(
        {
            users: users(),
            games: [
                {
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
                            deck: hostDeck,
                        },
                    ],
                    joinCode: "K3M9XZ",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
            matches: [
                {
                    _id: "match-x",
                    bestOf: 3,
                    ...(matchFormat === undefined ? {} : { matchFormat }),
                    status: "waiting",
                    players: [
                        {
                            id: ALICE,
                            name: "Alice",
                            bgColor: "#000",
                            score: 0,
                            ready: false,
                            deck: hostDeck,
                        },
                    ],
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

describe("create — the Match stores its Match Format and admits every seat", () => {
    it("stores the Match Format a create is given", async () => {
        const db = makeInMemoryDb(
            { users: users() },
            { identitySubject: ALICE }
        );
        await run(createGame, db.ctx, {
            name: "t",
            deck: FREEFORM,
            matchFormat: "freeform",
        });
        expect(db.tables.matches![0].matchFormat).toBe("freeform");
    });

    it("defaults the Match Format to the host Deck's Format", async () => {
        const db = makeInMemoryDb(
            { users: users() },
            { identitySubject: ALICE }
        );
        await run(createSoloGame, db.ctx, { name: "t", deck: FREEFORM });
        expect(db.tables.matches![0].matchFormat).toBe("freeform");
    });

    it("refuses a host Deck the given Match Format does not admit", async () => {
        const db = makeInMemoryDb(
            { users: users() },
            { identitySubject: ALICE }
        );
        const message = await rejection(() =>
            run(createGame, db.ctx, {
                name: "t",
                deck: FREEFORM,
                matchFormat: "premodern",
            })
        );
        expect(message).toMatch(REFUSAL);
        expect(db.tables.matches ?? []).toHaveLength(0);
    });

    it("createSoloGame refuses an inadmissible deck2 — the Bot's Deck included", async () => {
        for (const vsAi of [false, true]) {
            const db = makeInMemoryDb(
                { users: users() },
                { identitySubject: ALICE }
            );
            const message = await rejection(() =>
                run(createSoloGame, db.ctx, {
                    name: "t",
                    deck: PREMODERN,
                    deck2: FREEFORM,
                    vsAi,
                })
            );
            // Admission runs before legality: the empty Premodern seat 1
            // would be illegal, so this words the admission refusal or nothing.
            expect(message).toBe(
                "This Match's Format is Premodern; Freeform decks cannot sit at it."
            );
            expect(db.tables.matches ?? []).toHaveLength(0);
        }
    });
});

describe("join — the joiner is admitted against the stored Match Format", () => {
    it("refuses an inadmissible Deck, by id and by code, with the same words", async () => {
        const byId = bobFacing("premodern", "premodern");
        const idMessage = await rejection(() =>
            run(joinGame, byId.ctx, { gameId: "game-x", deck: FREEFORM })
        );
        expect(idMessage).toBe(
            "This Match's Format is Premodern; Freeform decks cannot sit at it."
        );
        expect(byId.tables.games![0].status).toBe("waiting");

        const byCode = bobFacing("premodern", "premodern");
        const codeMessage = await rejection(() =>
            run(joinGameByCode, byCode.ctx, { code: "K3M9XZ", deck: FREEFORM })
        );
        expect(codeMessage).toBe(idMessage);
        expect(byCode.tables.games![0].status).toBe("waiting");
    });

    it("reads the Match Format off the Match, not the host's Deck", async () => {
        // A Premodern host at a Freeform Match: a Freeform joiner sits down.
        const db = bobFacing("premodern", "freeform");
        await run(joinGame, db.ctx, { gameId: "game-x", deck: FREEFORM });
        expect(db.tables.games![0].status).toBe("pregame");
    });

    it("derives a legacy Match's Match Format from its host's Deck", async () => {
        // No stored Match Format: the Premodern host's table is a Premodern
        // Match, so a Freeform joiner — whom #4611's table seated — is refused.
        const legacy = bobFacing("premodern");
        expect(
            await rejection(() =>
                run(joinGame, legacy.ctx, { gameId: "game-x", deck: FREEFORM })
            )
        ).toMatch(REFUSAL);

        const limited = bobFacing("limited");
        expect(
            await rejection(() =>
                run(joinGame, limited.ctx, { gameId: "game-x", deck: FREEFORM })
            )
        ).toMatch(REFUSAL);
    });
});

describe("reads — an open table advertises Match Format and Games Format", () => {
    it("listOpenGames and getJoinInfo carry the stored Match Format and Games Format", async () => {
        const db = bobFacing("premodern", "freeform");
        const [row] = (await run(listOpenGames, db.ctx, {})) as {
            matchFormat: string;
            gamesFormat: string;
        }[];
        expect(row.matchFormat).toBe("freeform");
        expect(row.gamesFormat).toBe("bo3");

        const info = await run(getJoinInfo, db.ctx, { gameId: "game-x" });
        expect(info.matchFormat).toBe("freeform");
        expect(info.gamesFormat).toBe("bo3");
    });

    it("derives a legacy table's Match Format from its host's Deck", async () => {
        const db = bobFacing("premodern");
        const [row] = (await run(listOpenGames, db.ctx, {})) as {
            matchFormat: string;
        }[];
        expect(row.matchFormat).toBe("premodern");
    });
});
