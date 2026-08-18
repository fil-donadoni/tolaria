// Full-path guard for the #2506 decklist split: game creation → the `games`
// row the board subscribes to → the art-preload manifest `<Board>` feeds to
// `preloadCardImages`.
//
// This is the crossing the split can break silently. `createGame`/`joinGame`
// now write the cards to `gameDecks` and a DERIVED `cardIds` to the row; the
// client no longer walks `players[].deck.cards` at all. Each half passes its
// own test while the pair fails: a store that writes the rows but forgets
// `cardIds`, or a join that widens the row without re-deriving it, leaves the
// board preloading a partial set — which shows up as missing card art, and
// nothing server-side sees it.
//
// So the assertion is end-to-end and about COMPLETENESS: every distinct print
// id in either seat's real decklist must come back out of the real client
// derivation, with no hand-built view in between. The project has no
// convex-test harness, so the registered mutations' own `_handler`s are driven
// against the shared in-memory `db` (`convex/__tests__/fixtures/inMemoryDb.ts`).
//
// It lives on the CLIENT side of the crossing because that is the side that
// breaks silently, and because `~`/`@convex` both resolve here — the convex
// project's own tsconfig has no path alias back into `src`.
import { describe, it, expect } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { MutationCtx } from "@convex/_generated/server";
import type { Doc } from "@convex/_generated/dataModel";
import {
    makeInMemoryDb,
    type InMemoryRow,
} from "@convex/__tests__/fixtures/inMemoryDb";
import { createGame, joinGame, getGame } from "@convex/game";
import { hydrateGameSeats } from "@convex/deckStore";
import { gameArtCardIds } from "../game-card-ids";

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };

function run<A, R>(fn: unknown, ctx: MutationCtx, args: A): Promise<R> {
    return (fn as Handler<A, R>)._handler(ctx, args);
}

const user = (id: string, nickname: string): InMemoryRow => ({
    _id: id,
    nickname,
});

/** A freeform deck with a repeated print, so "distinct ids" is a real claim. */
function deck(id: string, prints: string[]) {
    return {
        id,
        name: `Deck ${id}`,
        format: "freeform",
        cards: prints.map((p) => ({ cardId: p, cardName: p })),
    };
}

const ALICE_PRINTS = ["print-a", "print-a", "print-b"];
const BOB_PRINTS = ["print-b", "print-c"];

/** A second identity over the SAME live storage as `db` — `makeInMemoryDb`
 *  deep-clones its seed, so the joiner's ctx has to reuse the live `db` handle
 *  rather than be built from the original fixture. */
function asUser(
    db: ReturnType<typeof makeInMemoryDb>,
    who: string
): MutationCtx {
    const shared = db.ctx as unknown as { db: unknown };
    return {
        db: shared.db,
        auth: {
            getUserIdentity: async () => ({
                subject: `${who}|session1`,
                issuer: "test",
                tokenIdentifier: `test|${who}`,
            }),
        },
    } as unknown as MutationCtx;
}

describe("art manifest survives creation → the board's own derivation (#2506)", () => {
    it("cardIds covers every distinct print in BOTH seats' decklists", async () => {
        // One shared store, two identities: `makeInMemoryDb` deep-clones its
        // seed, so the tables object is built once and handed to both ctxs.
        const seed = {
            users: [user("alice", "Alice"), user("bob", "Bob")],
            games: [],
            gameDecks: [],
            matches: [],
            matchDecks: [],
        };
        const alice = makeInMemoryDb(seed, {
            identitySubject: "alice|session1",
        });

        const gameId = await run<
            { name: string; deck: ReturnType<typeof deck> },
            Id<"games">
        >(createGame, alice.ctx, {
            name: "Table",
            deck: deck("alice-deck", ALICE_PRINTS),
        });

        // Host-only state: the manifest already covers the one decklist there is.
        const afterCreate = (await run(getGame, alice.ctx, {
            gameId,
        })) as Doc<"games">;
        expect(afterCreate.cardIds).toEqual(["print-a", "print-b"]);
        // …and the cards themselves are NOT on the row the board subscribes to.
        expect(
            afterCreate.players.every((p) => p.deck.cards === undefined)
        ).toBe(true);

        // The joiner sits down: the row must widen to cover their deck too.
        const bobCtx = asUser(alice, "bob");
        await run(joinGame, bobCtx, {
            gameId,
            deck: deck("bob-deck", BOB_PRINTS),
        });

        const row = (await run(getGame, alice.ctx, {
            gameId,
        })) as Doc<"games">;

        // Both seats are seated, so the manifest must now span both decks —
        // stated absolutely, because the completeness check below compares the
        // manifest against what was STORED and would pass just as happily on a
        // join that never widened either.
        expect(row.players).toHaveLength(2);

        // The real client derivation — the exact function `<Board>` calls.
        const manifest = gameArtCardIds(row);
        expect(manifest).toEqual(["print-a", "print-b", "print-c"]);

        // Completeness, checked against the decklists as actually STORED
        // (hydrated out of `gameDecks`), never against the fixture constants:
        // a store that silently dropped a seat's cards would otherwise agree
        // with a hand-written expectation of what it should have written.
        const seats = await hydrateGameSeats(alice.ctx, row);
        const stored = new Set(
            seats.flatMap((s) => s.deck.cards.map((c) => c.cardId))
        );
        expect(stored.size).toBeGreaterThan(0);
        for (const id of stored) expect(manifest).toContain(id);
        // …and nothing extra: the manifest IS the distinct set.
        expect([...manifest!].sort()).toEqual([...stored].sort());
    });
});
