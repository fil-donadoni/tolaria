// The `gameDecks` / `matchDecks` split (`convex/schema.ts`,
// `convex/deckStore.ts`, issue #2506): the decklists live in their own tables
// so the two full-table scans that read `players[].id` off every active row
// stop paying for ~7 KB of cards per row.
//
// The store is the only module that knows this, which makes it the only place
// the split can go wrong — and every way it can go wrong is SILENT: a deck that
// reads back empty, a slim write that erases an un-migrated row's cards, a
// sideboard swap landing on the wrong seat, an art manifest that drifts from
// the decklists it summarises. None of them throws.
//
// Several assertions here are about the READ SET rather than the result. In
// Convex a query's read set is what its subscription re-executes on and what it
// is billed for, so "the scan never touched the decklists" and "the opponent's
// row was never fetched" are correctness properties with no observable effect
// on any returned value — exactly the regressions a result-shaped test cannot
// see. The project has no convex-test harness, so this drives the real store
// against the shared in-memory `db` (`fixtures/inMemoryDb.ts`).
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { Doc, Id } from "../_generated/dataModel";
import { makeInMemoryDb, type InMemoryRow } from "./fixtures/inMemoryDb";
import { findActiveGameForUser } from "../gameLifecycle";
import { findActiveMatchForUser, type MatchPlayer } from "../matches";
import {
    appendMatchSeat,
    deckCardIds,
    deleteGameDecks,
    hydrateGameSeats,
    hydrateMatchPlayers,
    insertGameWithDecks,
    insertMatchWithDecks,
    loadGameSeatCards,
    loadMatchSeatDecks,
    migrateOneGameRow,
    migrateOneMatchRow,
    patchGameSeats,
    saveMatchSeatDeck,
    type GameSeat,
} from "../deckStore";

const GAME_ID = "game-1" as Id<"games">;
const MATCH_ID = "match-1" as Id<"matches">;

const C = (id: string) => ({ cardId: id, cardName: id.toUpperCase() });

/** A seat whose deck repeats `dup` twice — so "distinct ids" is a real claim
 *  and not an accident of every fixture holding singletons. */
function seat(id: string, cardIds: string[]): GameSeat {
    return {
        id,
        name: id,
        bgColor: "#000",
        deck: {
            id: `deck-${id}`,
            name: `Deck ${id}`,
            format: "vintage",
            cards: cardIds.map(C),
        },
    };
}

function matchSeat(id: string, main: string[], side: string[]): MatchPlayer {
    return {
        id,
        name: id,
        bgColor: "#000",
        score: 0,
        ready: false,
        deck: {
            id: `deck-${id}`,
            name: `Deck ${id}`,
            format: "vintage",
            maindeck: main.map(C),
            sideboard: side.map(C),
        },
    };
}

const GAME_META = {
    name: "Game",
    status: "playing" as const,
    createdAt: 0,
    updatedAt: 0,
};

const MATCH_META = {
    bestOf: 1 as const,
    status: "playing" as const,
    currentGameNumber: 1,
    createdAt: 0,
    updatedAt: 0,
};

/** A legacy `games` row: cards still inline, no child rows, no `cardIds`. */
function legacyGameRow(seats: GameSeat[]): InMemoryRow {
    return {
        _id: GAME_ID,
        ...GAME_META,
        players: seats.map((s) => ({
            id: s.id,
            name: s.name,
            bgColor: s.bgColor,
            deck: { ...s.deck },
        })),
    };
}

/** A legacy `matches` row: deck copies still inline, no child rows. */
function legacyMatchRow(players: MatchPlayer[]): InMemoryRow {
    return {
        _id: MATCH_ID,
        ...MATCH_META,
        players: players.map((p) => ({ ...p, deck: { ...p.deck } })),
    };
}

const gameRow = (db: { tables: Record<string, InMemoryRow[]> }) =>
    db.tables.games[0] as unknown as Doc<"games">;
const matchRow = (db: { tables: Record<string, InMemoryRow[]> }) =>
    db.tables.matches[0] as unknown as Doc<"matches">;

// --- games / gameDecks -------------------------------------------------------

describe("deckStore — the games row goes slim (issue #2506)", () => {
    it("insert leaves no card entry on the row and one gameDecks row per seat", async () => {
        const db = makeInMemoryDb({ games: [], gameDecks: [] });
        const seats = [seat("p1", ["a", "a", "b"]), seat("p2", ["c"])];
        await insertGameWithDecks(db.ctx, { ...GAME_META, players: seats });

        const row = gameRow(db);
        // The identity a reader needs stays; the cards do not.
        expect(row.players.map((p) => p.id)).toEqual(["p1", "p2"]);
        expect(row.players[0].deck.format).toBe("vintage");
        expect(row.players.every((p) => p.deck.cards === undefined)).toBe(true);

        const decks = db.tables.gameDecks;
        expect(decks.map((d) => d.playerId)).toEqual(["p1", "p2"]);
        expect(decks[0].cards).toEqual([C("a"), C("a"), C("b")]);
    });

    it("cardIds is the DEDUPED union across both seats", async () => {
        const db = makeInMemoryDb({ games: [], gameDecks: [] });
        await insertGameWithDecks(db.ctx, {
            ...GAME_META,
            players: [seat("p1", ["a", "a", "b"]), seat("p2", ["b", "c"])],
        });
        // Duplicates collapse and the two seats' lists merge: this is the art
        // manifest `<Board>` preloads, and every id in either decklist must be
        // in it or that card renders a placeholder.
        expect(gameRow(db).cardIds).toEqual(["a", "b", "c"]);
    });

    it("hydration reassembles the seats a split row was built from", async () => {
        const db = makeInMemoryDb({ games: [], gameDecks: [] });
        const seats = [seat("p1", ["a", "b"]), seat("p2", ["c"])];
        await insertGameWithDecks(db.ctx, { ...GAME_META, players: seats });
        expect(await hydrateGameSeats(db.ctx, gameRow(db))).toEqual(seats);
    });

    it("hydration folds in a LEGACY row's inline copy", async () => {
        const seats = [seat("p1", ["a", "b"]), seat("p2", ["c"])];
        const db = makeInMemoryDb({
            games: [legacyGameRow(seats)],
            gameDecks: [],
        });
        expect(await hydrateGameSeats(db.ctx, gameRow(db))).toEqual(seats);
    });

    it("the join path adds the second seat's row and widens cardIds", async () => {
        const db = makeInMemoryDb({ games: [], gameDecks: [] });
        const host = seat("p1", ["a", "b"]);
        const gameId = await insertGameWithDecks(db.ctx, {
            ...GAME_META,
            status: "waiting",
            players: [host],
        });
        const joiner = seat("p2", ["b", "c"]);
        await patchGameSeats(db.ctx, gameId, [host, joiner], {
            status: "playing",
        });

        const row = gameRow(db);
        expect(row.status).toBe("playing");
        expect(row.cardIds).toEqual(["a", "b", "c"]);
        expect(db.tables.gameDecks.map((d) => d.playerId)).toEqual([
            "p1",
            "p2",
        ]);
        // The host's own decklist survived the rewrite unchanged.
        expect(await hydrateGameSeats(db.ctx, row)).toEqual([host, joiner]);
    });

    it("deleting a game takes its decklists with it", async () => {
        const db = makeInMemoryDb({ games: [], gameDecks: [] });
        const gameId = await insertGameWithDecks(db.ctx, {
            ...GAME_META,
            players: [seat("p1", ["a"]), seat("p2", ["b"])],
        });
        await deleteGameDecks(db.ctx, gameId);
        expect(db.tables.gameDecks).toEqual([]);
    });
});

// --- matches / matchDecks ----------------------------------------------------

describe("deckStore — the matches row goes slim (issue #2506)", () => {
    it("insert leaves no card entry on the row and one matchDecks row per seat", async () => {
        const db = makeInMemoryDb({ matches: [], matchDecks: [] });
        await insertMatchWithDecks(db.ctx, {
            ...MATCH_META,
            players: [
                matchSeat("p1", ["a", "b"], ["x"]),
                matchSeat("p2", ["c"], []),
            ],
        });
        const row = matchRow(db);
        expect(
            row.players.every(
                (p) =>
                    p.deck.maindeck === undefined &&
                    p.deck.sideboard === undefined
            )
        ).toBe(true);
        expect(row.players.map((p) => p.score)).toEqual([0, 0]);
        expect(db.tables.matchDecks[0].maindeck).toEqual([C("a"), C("b")]);
        expect(db.tables.matchDecks[0].sideboard).toEqual([C("x")]);
    });

    it("hydration round-trips a split row and folds in a legacy one", async () => {
        const players = [
            matchSeat("p1", ["a", "b"], ["x"]),
            matchSeat("p2", ["c"], []),
        ];
        const split = makeInMemoryDb({ matches: [], matchDecks: [] });
        await insertMatchWithDecks(split.ctx, {
            ...MATCH_META,
            players,
        });
        expect(await hydrateMatchPlayers(split.ctx, matchRow(split))).toEqual(
            players
        );

        const legacy = makeInMemoryDb({
            matches: [legacyMatchRow(players)],
            matchDecks: [],
        });
        expect(await hydrateMatchPlayers(legacy.ctx, matchRow(legacy))).toEqual(
            players
        );
    });

    it("the join path appends a seat with its own deck row", async () => {
        const db = makeInMemoryDb({ matches: [], matchDecks: [] });
        await insertMatchWithDecks(db.ctx, {
            ...MATCH_META,
            status: "waiting",
            players: [matchSeat("p1", ["a"], [])],
        });
        const joiner = matchSeat("p2", ["b", "c"], ["y"]);
        await appendMatchSeat(db.ctx, matchRow(db), joiner, {
            status: "pregame",
        });
        expect(matchRow(db).status).toBe("pregame");
        expect(await hydrateMatchPlayers(db.ctx, matchRow(db))).toEqual([
            matchSeat("p1", ["a"], []),
            joiner,
        ]);
    });

    it("a sideboard swap rewrites ONE seat's row and leaves the other alone", async () => {
        const db = makeInMemoryDb({ matches: [], matchDecks: [] });
        await insertMatchWithDecks(db.ctx, {
            ...MATCH_META,
            status: "sideboarding",
            players: [
                matchSeat("p1", ["a", "b"], ["x"]),
                matchSeat("p2", ["c"], ["y"]),
            ],
        });
        const before = db.writes.length;
        await saveMatchSeatDeck(db.ctx, matchRow(db), "p1", {
            id: "deck-p1",
            name: "Deck p1",
            format: "vintage",
            maindeck: [C("a"), C("x")],
            sideboard: [C("b")],
        });
        const written = db.writes
            .slice(before)
            .filter((w) => w.table === "matchDecks");
        expect(written).toHaveLength(1);

        const players = await hydrateMatchPlayers(db.ctx, matchRow(db));
        expect(players[0].deck.maindeck).toEqual([C("a"), C("x")]);
        expect(players[0].deck.sideboard).toEqual([C("b")]);
        // The opponent's copy is untouched — the bug this guards is a swap
        // landing on, or clearing, the wrong seat.
        expect(players[1].deck.maindeck).toEqual([C("c")]);
        expect(players[1].deck.sideboard).toEqual([C("y")]);
    });

    it("a sideboard swap on a LEGACY row migrates that seat without losing the other's cards", async () => {
        const db = makeInMemoryDb({
            matches: [
                legacyMatchRow([
                    matchSeat("p1", ["a", "b"], ["x"]),
                    matchSeat("p2", ["c"], ["y"]),
                ]),
            ],
            matchDecks: [],
        });
        await saveMatchSeatDeck(db.ctx, matchRow(db), "p1", {
            id: "deck-p1",
            name: "Deck p1",
            format: "vintage",
            maindeck: [C("a"), C("x")],
            sideboard: [C("b")],
        });
        const row = matchRow(db);
        // p1 migrated: slim on the row, cards in the child table.
        expect(row.players[0].deck.maindeck).toBeUndefined();
        // p2 still legacy — never stripped, because nothing wrote its row.
        expect(row.players[1].deck.maindeck).toEqual([C("c")]);
        const players = await hydrateMatchPlayers(db.ctx, row);
        expect(players[0].deck.maindeck).toEqual([C("a"), C("x")]);
        expect(players[1].deck.sideboard).toEqual([C("y")]);
    });
});

// --- Read sets ---------------------------------------------------------------

describe("deckStore — the reads the split was FOR (issue #2506)", () => {
    it("findActiveGameForUser resolves from the slim row and never reads a decklist", async () => {
        const db = makeInMemoryDb({ games: [], gameDecks: [] });
        await insertGameWithDecks(db.ctx, {
            ...GAME_META,
            players: [seat("alice", ["a"]), seat("bob", ["b"])],
        });
        db.reads.length = 0;

        const found = await findActiveGameForUser(db.ctx, "alice");
        expect(found?.players.map((p) => p.id)).toEqual(["alice", "bob"]);
        // The whole point: the scan collects every active row, so a decklist
        // read here is paid once per open game per execution.
        expect(db.reads.some((r) => r.table === "gameDecks")).toBe(false);
    });

    it("findActiveMatchForUser resolves from the slim row and never reads a deck copy", async () => {
        const db = makeInMemoryDb({ matches: [], matchDecks: [] });
        await insertMatchWithDecks(db.ctx, {
            ...MATCH_META,
            players: [
                matchSeat("alice", ["a"], []),
                matchSeat("bob", ["b"], []),
            ],
        });
        db.reads.length = 0;

        const found = await findActiveMatchForUser(db.ctx, "alice");
        expect(found?.players.map((p) => p.id)).toEqual(["alice", "bob"]);
        expect(db.reads.some((r) => r.table === "matchDecks")).toBe(false);
    });

    it("loadMatchSeatDecks fetches ONLY the seats it was asked for", async () => {
        const db = makeInMemoryDb({ matches: [], matchDecks: [] });
        await insertMatchWithDecks(db.ctx, {
            ...MATCH_META,
            players: [
                matchSeat("p1", ["a"], ["x"]),
                matchSeat("p2", ["secret"], ["hidden"]),
            ],
        });
        db.reads.length = 0;

        const decks = await loadMatchSeatDecks(db.ctx, matchRow(db), ["p1"]);
        expect([...decks.keys()]).toEqual(["p1"]);
        expect(
            db.reads
                .filter((r) => r.table === "matchDecks")
                .map((r) => r.key[1])
        ).toEqual(["p1"]);
    });

    it("loadGameSeatCards does NOT read the games row once the row is split", async () => {
        const db = makeInMemoryDb({ games: [], gameDecks: [] });
        const gameId = await insertGameWithDecks(db.ctx, {
            ...GAME_META,
            players: [seat("p1", ["a", "b"]), seat("p2", ["c"])],
        });
        db.gets.length = 0;

        expect(await loadGameSeatCards(db.ctx, gameId, "p1")).toEqual([
            C("a"),
            C("b"),
        ]);
        // A query built on this therefore does not re-execute on the `games`
        // patches that fire several times a turn — the whole reason the bot's
        // own-deck read is safe to give its own subscription.
        expect(db.gets).not.toContain(gameId as string);
    });

    it("…and DOES fall back to the games row for a legacy one", async () => {
        const db = makeInMemoryDb({
            games: [legacyGameRow([seat("p1", ["a", "b"])])],
            gameDecks: [],
        });
        db.gets.length = 0;
        expect(await loadGameSeatCards(db.ctx, GAME_ID, "p1")).toEqual([
            C("a"),
            C("b"),
        ]);
        // This is the case that keeps paying, which is what makes running the
        // backfill part of the deploy rather than optional tidying.
        expect(db.gets).toContain(GAME_ID as string);
    });
});

// --- Backfill ----------------------------------------------------------------

describe("deckStore — the backfill is idempotent (issue #2506)", () => {
    it("a games row migrates once, and a second pass writes nothing", async () => {
        const seats = [seat("p1", ["a", "a", "b"]), seat("p2", ["b", "c"])];
        const db = makeInMemoryDb({
            games: [legacyGameRow(seats)],
            gameDecks: [],
        });

        expect(await migrateOneGameRow(db.ctx, gameRow(db))).toBe(true);
        const row = gameRow(db);
        expect(row.players.every((p) => p.deck.cards === undefined)).toBe(true);
        expect(row.cardIds).toEqual(["a", "b", "c"]);
        expect(await hydrateGameSeats(db.ctx, row)).toEqual(seats);

        const afterFirst = db.writes.length;
        expect(await migrateOneGameRow(db.ctx, gameRow(db))).toBe(false);
        expect(db.writes.length).toBe(afterFirst);
    });

    it("a matches row migrates once, and a second pass writes nothing", async () => {
        const players = [
            matchSeat("p1", ["a", "b"], ["x"]),
            matchSeat("p2", ["c"], []),
        ];
        const db = makeInMemoryDb({
            matches: [legacyMatchRow(players)],
            matchDecks: [],
        });

        expect(await migrateOneMatchRow(db.ctx, matchRow(db))).toBe(true);
        expect(await hydrateMatchPlayers(db.ctx, matchRow(db))).toEqual(
            players
        );

        const afterFirst = db.writes.length;
        expect(await migrateOneMatchRow(db.ctx, matchRow(db))).toBe(false);
        expect(db.writes.length).toBe(afterFirst);
    });

    it("a child row WINS over a stale inline copy during migration", async () => {
        // The half-migrated shape: a seat that sideboarded after the split has
        // a fresh `matchDecks` row AND the pre-split inline copy. Preferring
        // the inline one would silently undo the swap.
        const db = makeInMemoryDb({
            matches: [legacyMatchRow([matchSeat("p1", ["stale"], [])])],
            matchDecks: [
                {
                    _id: "matchDecks-0",
                    matchId: MATCH_ID,
                    playerId: "p1",
                    maindeck: [C("fresh")],
                    sideboard: [],
                },
            ],
        });
        await migrateOneMatchRow(db.ctx, matchRow(db));
        const players = await hydrateMatchPlayers(db.ctx, matchRow(db));
        expect(players[0].deck.maindeck).toEqual([C("fresh")]);
    });
});

describe("deckCardIds", () => {
    it("is order-preserving and first-seen deduped", () => {
        expect(
            deckCardIds([seat("p1", ["b", "a", "b"]), seat("p2", ["a", "c"])])
        ).toEqual(["b", "a", "c"]);
    });
});

// A structural guard rather than a behavioural one. The store's whole contract
// is "every `games`/`matches` row is written through here", and the failure it
// defends against is not a wrong answer but a silent loss of the split: a new
// mutation calling `ctx.db.insert("games", …)` directly would compile, pass its
// own tests, and quietly put ~7 KB of cards back on the hot row — the schema
// keeps the inline field for legacy rows, so nothing rejects it. Same shape as
// `getPublicStateGameRead.test.ts`'s `insert("gameStates")` census.
describe("deckStore is the ONLY writer of the games/matches tables (#2506)", () => {
    it("no module outside deckStore.ts inserts a games or matches row", () => {
        const dir = path.join(import.meta.dirname, "..");
        const offenders: string[] = [];
        const walk = (d: string) => {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, entry.name);
                if (entry.isDirectory()) {
                    if (
                        entry.name === "_generated" ||
                        entry.name === "node_modules"
                    )
                        continue;
                    walk(p);
                    continue;
                }
                if (!entry.name.endsWith(".ts")) continue;
                if (p.endsWith(path.join("convex", "deckStore.ts"))) continue;
                if (p.includes(`${path.sep}__tests__${path.sep}`)) continue;
                // Comment lines are stripped first: two docstrings legitimately
                // NAME the old call to explain what a value's provenance is,
                // and a scanner that cannot tell prose from code would red the
                // gate on documentation.
                const src = fs
                    .readFileSync(p, "utf8")
                    .split("\n")
                    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
                    .join("\n");
                if (/\.insert\(\s*"(games|matches)"/.test(src))
                    offenders.push(path.relative(dir, p));
            }
        };
        walk(dir);
        expect(offenders).toEqual([]);
    });
});
