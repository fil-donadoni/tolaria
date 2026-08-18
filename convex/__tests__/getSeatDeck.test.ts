// `getSeatDeck` — the ONE read that still hands a client real card entries
// after the #2506 decklist split, and therefore the split's security boundary
// (review finding 1).
//
// It is load-bearing in two directions at once, which is why both are pinned
// here:
//
//   TOO WIDE — dropping the seat gate re-opens exactly the leak the split
//   closed: in a 2-player game either client could read the OPPONENT's
//   decklist, which `getGame` incidentally allowed before.
//
//   TOO TIGHT — an equality check (`args.playerId !== userId`) looks correct
//   and nulls every solo / vs-AI seat, because those handles are
//   `${uid}-p1` / `${uid}-p2` and never equal the user id (CLAUDE.md § Player
//   identity in games). That kills the vs-AI bot's `ownDeck` (issue #1509 —
//   silently, it just searches a placeholder library again) and both Debug
//   restarts. Nothing else in the suite notices either break.
//
// The project has no convex-test harness, so the REGISTERED query's own
// `_handler` — the function Convex deploys — is driven against the shared
// in-memory ctx (`convex/__tests__/fixtures/inMemoryDb.ts`), whose
// `identitySubject` is what `auth.getUserId` reads.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { makeInMemoryDb, type InMemoryRow } from "./fixtures/inMemoryDb";
import { getSeatDeck } from "../game";

type Handler<A, R> = { _handler: (ctx: QueryCtx, args: A) => Promise<R> };

function run<A, R>(fn: unknown, ctx: QueryCtx, args: A): Promise<R> {
    return (fn as Handler<A, R>)._handler(ctx, args);
}

const GAME = "game-1" as Id<"games">;
const ALICE_CARDS = [{ cardId: "print-a", cardName: "Mountain" }];
const BOB_CARDS = [{ cardId: "print-b", cardName: "Forest" }];
const SOLO_P2_CARDS = [{ cardId: "print-c", cardName: "Grizzly Bears" }];

function seat(id: string): InMemoryRow {
    return {
        _id: `seat-${id}`,
        id,
        name: id,
        bgColor: "#000",
        deck: { id: `deck-${id}`, name: `${id} deck`, format: "freeform" },
    } as unknown as InMemoryRow;
}

/** A game with a 2-player pair (`alice` / `bob`) AND a solo-shaped seat
 *  (`alice-p2`), so one fixture exercises both handle shapes. */
function seededDb(identitySubject?: string) {
    return makeInMemoryDb(
        {
            games: [
                {
                    _id: GAME,
                    name: "Table",
                    status: "playing",
                    players: [
                        seat("alice"),
                        seat("bob"),
                        seat("alice-p2"),
                    ] as unknown as InMemoryRow[],
                } as unknown as InMemoryRow,
            ],
            gameDecks: [
                {
                    _id: "gd-1",
                    gameId: GAME,
                    playerId: "alice",
                    cards: ALICE_CARDS,
                },
                {
                    _id: "gd-2",
                    gameId: GAME,
                    playerId: "bob",
                    cards: BOB_CARDS,
                },
                {
                    _id: "gd-3",
                    gameId: GAME,
                    playerId: "alice-p2",
                    cards: SOLO_P2_CARDS,
                },
            ],
        },
        identitySubject === undefined ? {} : { identitySubject }
    );
}

/** `@convex-dev/auth` reads the user id as the part before the `|`. */
const asUser = (id: string) => seededDb(`${id}|session1`);

function ask(db: ReturnType<typeof seededDb>, playerId: string) {
    return run<
        { gameId: Id<"games">; playerId: string },
        { playerId: string; cards: { cardId: string }[] } | null
    >(getSeatDeck, db.ctx as unknown as QueryCtx, { gameId: GAME, playerId });
}

describe("getSeatDeck seat gate (issue #2506)", () => {
    it("answers the owner of a raw Id<'users'> seat with its cards", async () => {
        expect(await ask(asUser("alice"), "alice")).toEqual({
            playerId: "alice",
            cards: ALICE_CARDS,
        });
    });

    it("answers the 2-player OPPONENT with null — the leak the split closed", async () => {
        expect(await ask(asUser("alice"), "bob")).toBeNull();
    });

    it("answers a solo / vs-AI `${uid}-p2` handle for its own user", async () => {
        // The case an equality gate silently kills: this handle is never equal
        // to the user id, and both the vs-AI bot's decklist and the Debug
        // panel's restarts read exactly this shape.
        expect(await ask(asUser("alice"), "alice-p2")).toEqual({
            playerId: "alice-p2",
            cards: SOLO_P2_CARDS,
        });
    });

    it("answers an unauthenticated caller with null", async () => {
        expect(await ask(seededDb(), "alice")).toBeNull();
    });

    it("does not read the `games` row for a split seat", async () => {
        // The other half of why this query exists: a Convex subscription
        // re-executes on every document it READ, and the `games` row is patched
        // several times a turn. Asserted on the read set, because a widened read
        // returns the identical value (issue #2506).
        const db = asUser("alice");
        await ask(db, "alice");
        expect(db.gets).toEqual([]);
    });
});
