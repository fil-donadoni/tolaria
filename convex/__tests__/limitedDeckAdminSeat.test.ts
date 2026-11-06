// An admin seats another player's archived Limited deck in a solo or vs-Bot
// Freeform game (PRD #8407, issue #8411, ADR 0106 §4 as amended): access is "you
// own this deck, or you are an admin", on `createSoloGame` only, and that path
// seats the ROW, never the inline payload. Registered handlers driven for real
// against the shared in-memory ctx (no convex-test harness).
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import { resolveDeckCardMeta } from "../cards";
import {
    chooseFirstPlayer,
    concede,
    createGame,
    createSoloGame,
    joinGame,
} from "../game";
import {
    create as userDecksCreate,
    listSeatableLimitedDecksAdmin,
} from "../userDecks";
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

const ALICE = "user-alice";
const BOB = "user-bob";
const ROOT = "user-root";

const BOLT_PRINT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const MOUNTAIN_PRINT = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const BOLT = { cardId: BOLT_PRINT, cardName: "Lightning Bolt" };
const MOUNTAIN = { cardId: MOUNTAIN_PRINT, cardName: "Mountain" };
const POOL_BOLT = {
    scryfallId: BOLT_PRINT,
    cardId: resolveDeckCardMeta(BOLT_PRINT)!.cardId,
    cardName: "Lightning Bolt",
};

const LIMITED_BODY = {
    name: "Alice's Sealed",
    format: "limited",
    colors: ["R"],
    cards: [BOLT, ...Array.from({ length: 39 }, () => MOUNTAIN)],
    sideboard: [BOLT],
    limitedEventId: "ev-1",
    limitedSeatId: "0",
};

/** Alice saves a Limited deck; the returned `ctx` acts as `caller`. */
async function world(caller: string) {
    const db = makeInMemoryDb(
        {
            users: [
                { _id: ALICE, nickname: "Alice" },
                { _id: BOB, nickname: "Bob" },
                { _id: ROOT, nickname: "Root", isAdmin: true },
            ],
            limitedEvents: [
                {
                    _id: "ev-1",
                    type: "sealed",
                    status: "started",
                    packSlots: ["lea"],
                    seats: [
                        { seatIndex: 0, userId: ALICE, displayName: "Alice" },
                    ],
                },
            ],
            limitedSeats: [
                {
                    _id: "seat-1",
                    eventId: "ev-1",
                    seatIndex: 0,
                    pool: [POOL_BOLT, POOL_BOLT],
                },
            ],
        },
        { identitySubject: ALICE }
    );
    const userDeckId: string = await run(userDecksCreate, db.ctx, LIMITED_BODY);
    const ctx = {
        ...db.ctx,
        auth: {
            getUserIdentity: async () => ({
                subject: caller,
                tokenIdentifier: `test|${caller}`,
            }),
        },
    } as unknown as MutationCtx;
    /** What the Match setup sends for Alice's deck. */
    const payload = {
        ...LIMITED_BODY,
        id: userDeckId,
        userDeckId,
    };
    return { db, ctx, userDeckId, payload };
}

const FREEFORM_OWN = {
    id: "own",
    name: "Own Freeform",
    format: "freeform",
    cards: [MOUNTAIN],
};

async function rejection(fn: () => Promise<unknown>): Promise<string> {
    try {
        await fn();
    } catch (e) {
        return (e as Error).message;
    }
    throw new Error("expected the call to throw, but it resolved");
}

/** The seat's Match copy, by seat handle suffix. */
function matchDeck(tables: Record<string, InMemoryRow[]>, seat: "p1" | "p2") {
    return tables.matchDecks.find((d: any) =>
        (d.playerId as string).endsWith(seat)
    ) as any;
}

describe("admin seat — createSoloGame seats another player's Limited deck", () => {
    for (const vsAi of [false, true]) {
        const mode = vsAi ? "vs-Bot" : "solo";

        it(`${mode}: in seat 1, with an own deck in seat 2`, async () => {
            const { db, ctx, payload } = await world(ROOT);
            await run(createSoloGame, ctx, {
                name: "t",
                deck: payload,
                deck2: FREEFORM_OWN,
                vsAi,
                matchFormat: "freeform",
            });
            expect(matchDeck(db.tables, "p1").maindeck).toHaveLength(40);
            expect(matchDeck(db.tables, "p2").maindeck).toHaveLength(1);
            const [match] = db.tables.matches as any[];
            expect(match.matchFormat).toBe("freeform");
            // The seats stay the admin's: only the DECK is another player's.
            expect(match.players.map((p: { id: string }) => p.id)).toEqual([
                `${ROOT}-p1`,
                `${ROOT}-p2`,
            ]);
        });

        it(`${mode}: in seat 2, with an own deck in seat 1`, async () => {
            const { db, ctx, payload } = await world(ROOT);
            await run(createSoloGame, ctx, {
                name: "t",
                deck: FREEFORM_OWN,
                deck2: payload,
                vsAi,
                matchFormat: "freeform",
            });
            expect(matchDeck(db.tables, "p1").maindeck).toHaveLength(1);
            expect(matchDeck(db.tables, "p2").maindeck).toHaveLength(40);
        });
    }

    it("Mirror seats the same deck twice", async () => {
        const { db, ctx, payload } = await world(ROOT);
        await run(createSoloGame, ctx, {
            name: "t",
            deck: payload,
            matchFormat: "freeform",
        });
        expect(matchDeck(db.tables, "p1").maindeck).toHaveLength(40);
        expect(matchDeck(db.tables, "p2").maindeck).toHaveLength(40);
    });

    it("the deck's Event being gone does not stop the seat", async () => {
        const { db, ctx, payload } = await world(ROOT);
        db.tables.limitedEvents = [];
        db.tables.limitedSeats = [];
        await run(createSoloGame, ctx, {
            name: "t",
            deck: payload,
            matchFormat: "freeform",
        });
        expect(db.tables.matches).toHaveLength(1);
    });
});

describe("admin seat — the row decides, the payload is ignored", () => {
    it("cards, sideboard, name and Format come from the row", async () => {
        const { db, ctx, userDeckId } = await world(ROOT);
        await run(createSoloGame, ctx, {
            name: "t",
            deck: {
                id: "forged",
                name: "Forged",
                format: "freeform",
                cards: [{ cardId: "black-lotus", cardName: "Black Lotus" }],
                sideboard: [],
                userDeckId,
            },
            matchFormat: "freeform",
        });
        const seat = matchDeck(db.tables, "p1");
        expect(seat.maindeck.map((c: any) => c.cardName)).not.toContain(
            "Black Lotus"
        );
        expect(seat.maindeck).toHaveLength(40);
        expect(seat.sideboard).toHaveLength(1);
        const [player] = (db.tables.matches[0] as any).players;
        expect(player.deck.name).toBe("Alice's Sealed");
        expect(player.deck.format).toBe("limited");
        expect(player.deck.id).toBe(userDeckId);
    });

    it("the row's Pool judges the deck: an illegal row is refused whatever the payload says", async () => {
        const { db, ctx, userDeckId, payload } = await world(ROOT);
        const row = db.tables.userDecks.find((d) => d._id === userDeckId)!;
        // A third Bolt is outside the two the Deck Pool holds.
        row.cards = [BOLT, BOLT, BOLT, ...Array(37).fill(MOUNTAIN)];
        const message = await rejection(() =>
            run(createSoloGame, ctx, {
                name: "t",
                deck: payload,
                matchFormat: "freeform",
            })
        );
        expect(message).toMatch(/Pool|pool/);
        expect(db.tables.matches ?? []).toHaveLength(0);
    });
});

describe("admin seat — the permission is narrow", () => {
    for (const [label, deckField] of [
        ["its Limited Format", {}],
        ["a claimed Freeform Format", { format: "freeform" }],
    ] as const) {
        it(`a non-admin naming another player's deck under ${label} is refused, no row written`, async () => {
            const { db, ctx, payload } = await world(BOB);
            const message = await rejection(() =>
                run(createSoloGame, ctx, {
                    name: "t",
                    deck: { ...payload, ...deckField },
                    matchFormat: "freeform",
                })
            );
            expect(message).toMatch(/do not own/);
            expect(db.tables.matches ?? []).toHaveLength(0);
            expect(db.tables.games ?? []).toHaveLength(0);
        });
    }

    it("a non-admin's foreign deck in seat 2 is refused too", async () => {
        const { db, ctx, payload } = await world(BOB);
        const message = await rejection(() =>
            run(createSoloGame, ctx, {
                name: "t",
                deck: FREEFORM_OWN,
                deck2: payload,
                vsAi: true,
                matchFormat: "freeform",
            })
        );
        expect(message).toMatch(/do not own/);
        expect(db.tables.matches ?? []).toHaveLength(0);
    });

    it("an admin cannot seat another player's non-Limited deck", async () => {
        const { db, ctx, userDeckId, payload } = await world(ROOT);
        db.tables.userDecks.find((d) => d._id === userDeckId)!.format =
            "freeform";
        const message = await rejection(() =>
            run(createSoloGame, ctx, {
                name: "t",
                deck: { ...payload, format: "freeform" },
                matchFormat: "freeform",
            })
        );
        expect(message).toMatch(/do not own/);
        expect(db.tables.matches ?? []).toHaveLength(0);
    });

    it("refuses any Match Format but Freeform, an absent one included", async () => {
        const { db, ctx, payload } = await world(ROOT);
        for (const matchFormat of ["limited", undefined]) {
            const message = await rejection(() =>
                run(createSoloGame, ctx, {
                    name: "t",
                    deck: payload,
                    matchFormat,
                })
            );
            expect(message).toMatch(/Freeform Match outside any Limited Event/);
        }
        expect(db.tables.matches ?? []).toHaveLength(0);
    });

    it("refuses binding the Match to a Limited Event", async () => {
        const { db, ctx, payload } = await world(ROOT);
        const message = await rejection(() =>
            run(createSoloGame, ctx, {
                name: "t",
                deck: payload,
                deck2: FREEFORM_OWN,
                vsAi: true,
                matchFormat: "freeform",
                limitedEventId: "ev-1",
            })
        );
        expect(message).toMatch(/Freeform Match outside any Limited Event/);
        expect(db.tables.matches ?? []).toHaveLength(0);
    });

    it("createGame refuses another player's deck, for an admin too", async () => {
        const { db, ctx, payload } = await world(ROOT);
        const message = await rejection(() =>
            run(createGame, ctx, {
                name: "t",
                deck: payload,
                matchFormat: "freeform",
            })
        );
        expect(message).toMatch(/do not own/);
        expect(db.tables.matches ?? []).toHaveLength(0);
    });

    it("createGame never seats the row: a Freeform claim stays its own inline list", async () => {
        const { db, ctx, userDeckId } = await world(ROOT);
        await run(createGame, ctx, {
            name: "t",
            deck: { ...FREEFORM_OWN, userDeckId },
            matchFormat: "freeform",
        });
        const [seat] = db.tables.matchDecks as any[];
        expect(seat.maindeck).toHaveLength(1);
    });

    it("joinGame refuses another player's deck, for an admin too", async () => {
        const { db, ctx, payload } = await world(ROOT);
        db.tables.games = [
            {
                _id: "game-x",
                name: "Bob's table",
                gameNumber: 1,
                status: "waiting",
                players: [
                    {
                        id: BOB,
                        name: "Bob",
                        bgColor: "#000",
                        deck: { id: "d", name: "D", format: "freeform" },
                    },
                ],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        const message = await rejection(() =>
            run(joinGame, ctx, { gameId: "game-x", deck: payload })
        );
        expect(message).toMatch(/do not own/);
        expect(db.tables.games[0].status).toBe("waiting");
    });

    it("the owner's own path is unchanged", async () => {
        const { db, ctx, payload } = await world(ALICE);
        await run(createSoloGame, ctx, {
            name: "t",
            deck: payload,
            matchFormat: "freeform",
        });
        expect(db.tables.matches).toHaveLength(1);
    });
});

describe("admin seat — the original is never touched", () => {
    it("after a whole Match the row and its Deck Pool are byte-identical, and nothing wrote them", async () => {
        const { db, ctx, payload } = await world(ROOT);
        const row = () => JSON.stringify(db.tables.userDecks);
        const pool = () => JSON.stringify(db.tables.limitedDeckPools);
        const rowBefore = row();
        const poolBefore = pool();
        db.writes.length = 0;

        const gameId = await run(createSoloGame, ctx, {
            name: "t",
            deck: payload,
            deck2: FREEFORM_OWN,
            matchFormat: "freeform",
        });
        await run(chooseFirstPlayer, ctx, {
            matchId: db.tables.matches[0]._id,
            choice: "play",
        });
        await run(concede, ctx, { gameId, playerId: `${ROOT}-p1` });

        expect(db.tables.matches[0].status).toBe("finished");
        expect(row()).toBe(rowBefore);
        expect(pool()).toBe(poolBefore);
        expect(
            db.writes.filter((w) =>
                ["userDecks", "limitedDeckPools"].includes(w.table)
            )
        ).toEqual([]);
    });
});

describe("listSeatableLimitedDecksAdmin — what the Match setup offers", () => {
    const PAGE = { paginationOpts: { numItems: 25, cursor: null } };

    it("refuses a non-admin", async () => {
        const { ctx } = await world(BOB);
        await expect(
            run(listSeatableLimitedDecksAdmin, ctx, PAGE)
        ).rejects.toThrow(/admin only/);
    });

    it("gives an admin other players' decks, whole, with owner and legality", async () => {
        const { ctx, userDeckId } = await world(ROOT);
        const { page } = await run(listSeatableLimitedDecksAdmin, ctx, PAGE);
        expect(page).toHaveLength(1);
        expect(page[0]).toMatchObject({
            _id: userDeckId,
            ownerNickname: "Alice",
            isLegal: true,
            format: "limited",
        });
        expect(page[0].cards).toHaveLength(40);
    });

    it("leaves out the admin's own decks: the grid already lists them", async () => {
        const { db, ctx } = await world(ROOT);
        for (const d of db.tables.userDecks) d.userId = ROOT;
        const { page } = await run(listSeatableLimitedDecksAdmin, ctx, PAGE);
        expect(page).toEqual([]);
    });
});
