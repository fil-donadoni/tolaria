// The `gameDecks` / `matchDecks` seam: the ONE module that reads or writes the
// decklists a Game and its owning Match hold (issue #2506). Both tables exist
// for the same reason `limitedSeats` was split out of `limitedEvents.seats[]`
// — Convex bills a read by the bytes of the WHOLE document, and the card
// arrays measured 88% of a `games` row and 90% of a `matches` row that two
// full-table scans read for `players[].id` alone. See `convex/schema.ts`'s
// `gameDecks` / `matchDecks` comments for the measurements.
//
// The contract every caller sees is unchanged: hydrate returns the SAME
// `{ deck: { cards } }` / `{ deck: { maindeck, sideboard } }` shapes the pure
// helpers in `game.ts` and `matches.ts` already consume, and the insert/patch
// helpers take those shapes and split them on the way down.
//
// Legacy tolerance mirrors `convex/limitedSeatStore.ts`: a row written BEFORE
// the split still carries its cards inline, the hydrate paths fold that copy in
// when no child row exists, and `migrateGameDecks` / `migrateMatchDecks`
// (`convex/deckBackfill.ts`) relocate them in bounded, idempotent batches.
//
// **No write path here ever strips a card array without first writing the child
// row that replaces it.** That is what makes "a slim write never loses cards"
// true by construction on an un-migrated row, and it is why the pure Match
// transitions (`recordGameResult`, `forfeitMatch`, `setReady`) can keep
// spreading `...p`: on a migrated row the spread is already slim, on a legacy
// one it preserves the inline copy until the backfill moves it.
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import type {
    MutationCtx as ConvexMutationCtx,
    QueryCtx as ConvexQueryCtx,
} from "./_generated/server";
import type { DeckCard, MatchDeck, MatchPlayer } from "./matches";

// Only `db` is ever touched, and several callers (`buildNextGameForMatch`)
// already thread a `Pick<…, "db">` ctx — take the narrowest thing that works.
type MutationCtx = Pick<ConvexMutationCtx, "db">;
type QueryCtx = Pick<ConvexQueryCtx, "db">;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The per-Game deck snapshot, hydrated. Immutable for the Game's life. */
export type GameDeck = {
    id: string;
    name: string;
    format: string;
    cards: DeckCard[];
};

/** A hydrated `games.players[]` seat — what every consumer expects. */
export type GameSeat = {
    id: string;
    name: string;
    bgColor: string;
    deck: GameDeck;
};

/** A `games` row as it is INSERTED: the caller supplies hydrated seats and the
 *  store derives `players` + `cardIds` from them. */
export type GameInsert = Omit<
    WithoutSystemFields<Doc<"games">>,
    "players" | "cardIds"
> & { players: GameSeat[] };

/** A `matches` row as it is INSERTED, same deal. */
export type MatchInsert = Omit<
    WithoutSystemFields<Doc<"matches">>,
    "players"
> & { players: MatchPlayer[] };

type StoredGameSeat = Doc<"games">["players"][number];
type StoredMatchSeat = Doc<"matches">["players"][number];

function copyCards(cards: readonly DeckCard[]): DeckCard[] {
    return cards.map((c) => ({ cardId: c.cardId, cardName: c.cardName }));
}

// ---------------------------------------------------------------------------
// games / gameDecks
// ---------------------------------------------------------------------------

/** Every DISTINCT print id across the seats, in first-seen order — the
 *  `games.cardIds` art-preload manifest `<Board>` reads (issue #2506). Derived
 *  here and nowhere else, so it cannot drift from the decklists it summarises. */
export function deckCardIds(
    seats: readonly { deck: { cards: readonly DeckCard[] } }[]
): string[] {
    const ids = new Set<string>();
    for (const seat of seats)
        for (const c of seat.deck.cards) ids.add(c.cardId);
    return Array.from(ids);
}

/** Strips the decklist off a seat, leaving the identity the `games` row keeps. */
function toStoredGameSeat(seat: GameSeat): StoredGameSeat {
    return {
        id: seat.id,
        name: seat.name,
        bgColor: seat.bgColor,
        deck: {
            id: seat.deck.id,
            name: seat.deck.name,
            format: seat.deck.format,
        },
    };
}

async function loadGameDeckRows(
    ctx: QueryCtx,
    gameId: Id<"games">
): Promise<Map<string, DeckCard[]>> {
    const rows = await ctx.db
        .query("gameDecks")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect();
    return new Map(rows.map((r) => [r.playerId, r.cards]));
}

/** Writes each seat's decklist into its `gameDecks` row (insert or replace).
 *  Rows for seats no longer present are left alone — a `games` row only ever
 *  GAINS a seat (`joinGame`), never loses one. */
async function writeGameDeckRows(
    ctx: MutationCtx,
    gameId: Id<"games">,
    seats: readonly GameSeat[]
): Promise<void> {
    const existing = await ctx.db
        .query("gameDecks")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect();
    const rowBySeat = new Map(existing.map((r) => [r.playerId, r]));
    for (const seat of seats) {
        const cards = copyCards(seat.deck.cards);
        const row = rowBySeat.get(seat.id);
        if (row) {
            await ctx.db.replace(row._id, {
                gameId,
                playerId: seat.id,
                cards,
            });
            continue;
        }
        await ctx.db.insert("gameDecks", { gameId, playerId: seat.id, cards });
    }
}

/** Inserts a `games` row with its decklists split into `gameDecks`. The ONLY
 *  way a `games` row is created — `ctx.db.insert("games", …)` outside this
 *  module would write a fat row the readers no longer expect. */
export async function insertGameWithDecks(
    ctx: MutationCtx,
    doc: GameInsert
): Promise<Id<"games">> {
    const { players, ...rest } = doc;
    const gameId = await ctx.db.insert("games", {
        ...rest,
        players: players.map(toStoredGameSeat),
        cardIds: deckCardIds(players),
    });
    await writeGameDeckRows(ctx, gameId, players);
    return gameId;
}

/** Rewrites a Game's seats (the join paths, which ADD the second seat).
 *
 *  MUST be given the FULL seat list, hydrated — handing it a slim array would
 *  write empty decklists over real ones. `hydrateGameSeats` is how callers get
 *  the existing seats back. */
export async function patchGameSeats(
    ctx: MutationCtx,
    gameId: Id<"games">,
    seats: readonly GameSeat[],
    extraPatch: Partial<Omit<Doc<"games">, "_id" | "players" | "cardIds">> = {}
): Promise<void> {
    await writeGameDeckRows(ctx, gameId, seats);
    await ctx.db.patch(gameId, {
        ...extraPatch,
        players: seats.map(toStoredGameSeat),
        cardIds: deckCardIds(seats),
    });
}

/** Reassembles `game.players` with the decklists folded back in.
 *
 *  Child row first; the inline legacy copy second; an empty list last, which is
 *  what a seat genuinely without cards has always looked like to every reader. */
export async function hydrateGameSeats(
    ctx: QueryCtx,
    game: Doc<"games">
): Promise<GameSeat[]> {
    const bySeat = await loadGameDeckRows(ctx, game._id);
    return game.players.map((p) => ({
        id: p.id,
        name: p.name,
        bgColor: p.bgColor,
        deck: {
            id: p.deck.id,
            name: p.deck.name,
            format: p.deck.format,
            cards: copyCards(bySeat.get(p.id) ?? p.deck.cards ?? []),
        },
    }));
}

/** ONE seat's decklist, by point lookup, WITHOUT reading the `games` row.
 *
 *  That omission is the whole point (issue #2506): a Convex query subscribes to
 *  exactly the documents it read, so a client query built on this re-executes
 *  only when the seat's own — immutable — decklist row changes, never on the
 *  `games` patches that fire several times a turn. The legacy branch does read
 *  the `games` row, and is therefore the one shape that keeps the old
 *  invalidation; the backfill retires it.
 *
 *  Returns `null` for a seat with no decklist anywhere. */
export async function loadGameSeatCards(
    ctx: QueryCtx,
    gameId: Id<"games">,
    playerId: string
): Promise<DeckCard[] | null> {
    const row = await ctx.db
        .query("gameDecks")
        .withIndex("by_game", (q) =>
            q.eq("gameId", gameId).eq("playerId", playerId)
        )
        .unique();
    if (row) return row.cards;
    const game = await ctx.db.get(gameId);
    const seat = game?.players.find((p) => p.id === playerId);
    return seat?.deck.cards ?? null;
}

/** Deletes every `gameDecks` row of a Game — for the Game's own deletion, which
 *  would otherwise orphan the decklists. */
export async function deleteGameDecks(
    ctx: MutationCtx,
    gameId: Id<"games">
): Promise<void> {
    const rows = await ctx.db
        .query("gameDecks")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect();
    for (const row of rows) await ctx.db.delete(row._id);
}

/** Does this `games` row still carry its decklists inline (written before the
 *  split)? The backfill's idempotence predicate. */
export function gameHasInlineDecks(game: Doc<"games">): boolean {
    return game.players.some((p) => p.deck.cards !== undefined);
}

// ---------------------------------------------------------------------------
// matches / matchDecks
// ---------------------------------------------------------------------------

/** Strips the deck copy off a Match seat, leaving what the row keeps. */
function toStoredMatchSeat(player: MatchPlayer): StoredMatchSeat {
    return {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        deck: {
            id: player.deck.id,
            name: player.deck.name,
            format: player.deck.format,
        },
        score: player.score,
        ready: player.ready,
    };
}

async function loadMatchDeckRows(
    ctx: QueryCtx,
    matchId: Id<"matches">
): Promise<Map<string, { maindeck: DeckCard[]; sideboard: DeckCard[] }>> {
    const rows = await ctx.db
        .query("matchDecks")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .collect();
    return new Map(
        rows.map((r) => [
            r.playerId,
            { maindeck: r.maindeck, sideboard: r.sideboard },
        ])
    );
}

/** Writes ONE seat's Match deck copy (insert or replace). */
async function writeMatchDeckRow(
    ctx: MutationCtx,
    matchId: Id<"matches">,
    playerId: string,
    deck: MatchDeck
): Promise<void> {
    const row = await ctx.db
        .query("matchDecks")
        .withIndex("by_match", (q) =>
            q.eq("matchId", matchId).eq("playerId", playerId)
        )
        .unique();
    const payload = {
        matchId,
        playerId,
        maindeck: copyCards(deck.maindeck),
        sideboard: copyCards(deck.sideboard),
    };
    if (row) {
        await ctx.db.replace(row._id, payload);
        return;
    }
    await ctx.db.insert("matchDecks", payload);
}

/** Inserts a `matches` row with its deck copies split into `matchDecks`. The
 *  ONLY way a `matches` row is created. */
export async function insertMatchWithDecks(
    ctx: MutationCtx,
    doc: MatchInsert
): Promise<Id<"matches">> {
    const { players, ...rest } = doc;
    const matchId = await ctx.db.insert("matches", {
        ...rest,
        players: players.map(toStoredMatchSeat),
    });
    for (const p of players)
        await writeMatchDeckRow(ctx, matchId, p.id, p.deck);
    return matchId;
}

/** Appends a seat to a waiting Match (the join paths) with its deck copy
 *  written to the child table. The existing seats' stored shape is untouched,
 *  so a legacy row keeps its inline copies until the backfill moves them. */
export async function appendMatchSeat(
    ctx: MutationCtx,
    match: Doc<"matches">,
    player: MatchPlayer,
    extraPatch: Partial<Omit<Doc<"matches">, "_id" | "players">> = {}
): Promise<void> {
    await writeMatchDeckRow(ctx, match._id, player.id, player.deck);
    await ctx.db.patch(match._id, {
        ...extraPatch,
        players: [...match.players, toStoredMatchSeat(player)],
    });
}

/** Replaces ONE seat's Match deck copy — the sideboarding write (PRD #387 /
 *  #395), the only path that edits deck CONTENT between Games.
 *
 *  Writes the child row FIRST, then rewrites that seat's stored shape slim: on
 *  a legacy row this migrates exactly the seat being edited, and it can never
 *  drop cards, because the row that replaces the inline copy already exists. */
export async function saveMatchSeatDeck(
    ctx: MutationCtx,
    match: Doc<"matches">,
    playerId: string,
    deck: MatchDeck,
    extraPatch: Partial<Omit<Doc<"matches">, "_id" | "players">> = {}
): Promise<void> {
    await writeMatchDeckRow(ctx, match._id, playerId, deck);
    await ctx.db.patch(match._id, {
        ...extraPatch,
        players: match.players.map((p) =>
            p.id === playerId
                ? {
                      ...p,
                      deck: {
                          id: deck.id,
                          name: deck.name,
                          format: deck.format,
                      },
                  }
                : p
        ),
    });
}

/** Reassembles `match.players` with the deck copies folded back in. Child row
 *  first, inline legacy copy second, empty lists last. */
export async function hydrateMatchPlayers(
    ctx: QueryCtx,
    match: Doc<"matches">
): Promise<MatchPlayer[]> {
    const bySeat = await loadMatchDeckRows(ctx, match._id);
    return match.players.map((p) => {
        const stored = bySeat.get(p.id);
        return {
            id: p.id,
            name: p.name,
            bgColor: p.bgColor,
            score: p.score,
            ready: p.ready,
            deck: {
                id: p.deck.id,
                name: p.deck.name,
                format: p.deck.format,
                maindeck: copyCards(stored?.maindeck ?? p.deck.maindeck ?? []),
                sideboard: copyCards(
                    stored?.sideboard ?? p.deck.sideboard ?? []
                ),
            },
        };
    });
}

/** Loads the hydrated deck copies of JUST `seatIds` — the read-side narrowing
 *  `getMatch` uses so a 2-player board subscription never reads the opponent's
 *  decklist it is about to strip anyway (issue #2506). One point lookup per
 *  seat; a seat with neither a child row nor an inline copy is absent from the
 *  map, which reads to `projectMatch` exactly like a stripped seat. */
export async function loadMatchSeatDecks(
    ctx: QueryCtx,
    match: Doc<"matches">,
    seatIds: readonly string[]
): Promise<Map<string, MatchDeck>> {
    const out = new Map<string, MatchDeck>();
    for (const seatId of seatIds) {
        const stored = match.players.find((p) => p.id === seatId);
        if (!stored) continue;
        const row = await ctx.db
            .query("matchDecks")
            .withIndex("by_match", (q) =>
                q.eq("matchId", match._id).eq("playerId", seatId)
            )
            .unique();
        out.set(seatId, {
            id: stored.deck.id,
            name: stored.deck.name,
            format: stored.deck.format,
            maindeck: copyCards(row?.maindeck ?? stored.deck.maindeck ?? []),
            sideboard: copyCards(row?.sideboard ?? stored.deck.sideboard ?? []),
        });
    }
    return out;
}

/** Deletes every `matchDecks` row of a Match — for the Match's own deletion. */
export async function deleteMatchDecks(
    ctx: MutationCtx,
    matchId: Id<"matches">
): Promise<void> {
    const rows = await ctx.db
        .query("matchDecks")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .collect();
    for (const row of rows) await ctx.db.delete(row._id);
}

/** Does this `matches` row still carry its deck copies inline? */
export function matchHasInlineDecks(match: Doc<"matches">): boolean {
    return match.players.some(
        (p) => p.deck.maindeck !== undefined || p.deck.sideboard !== undefined
    );
}

/** Relocates ONE legacy row's inline deck copies into `matchDecks` and rewrites
 *  it slim. Child rows are written before the strip, and an existing child row
 *  WINS over the inline copy (it is the newer of the two — a seat sideboarded
 *  since the split has both). Idempotent: a no-op on an already-split row. */
export async function migrateOneMatchRow(
    ctx: MutationCtx,
    match: Doc<"matches">
): Promise<boolean> {
    if (!matchHasInlineDecks(match)) return false;
    const hydrated = await hydrateMatchPlayers(ctx, match);
    for (const p of hydrated) {
        await writeMatchDeckRow(ctx, match._id, p.id, p.deck);
    }
    await ctx.db.patch(match._id, {
        players: hydrated.map(toStoredMatchSeat),
    });
    return true;
}

/** The `games` twin of {@link migrateOneMatchRow}. */
export async function migrateOneGameRow(
    ctx: MutationCtx,
    game: Doc<"games">
): Promise<boolean> {
    if (!gameHasInlineDecks(game)) return false;
    const seats = await hydrateGameSeats(ctx, game);
    await writeGameDeckRows(ctx, game._id, seats);
    await ctx.db.patch(game._id, {
        players: seats.map(toStoredGameSeat),
        cardIds: deckCardIds(seats),
    });
    return true;
}
