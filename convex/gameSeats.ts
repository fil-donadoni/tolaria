import { v } from "convex/values";
import { snapshotDeck, type MatchPlayer } from "./matches";

// The seat-building vocabulary shared by every function that opens a table
// (issue #4855): the input shapes, their `matches` / `games` projections and the
// args validators. Card-free — no Card Definition is read to seat a deck — so
// both `game.ts` (real-engine tables) and `gameManual.ts` (Tabletop tables)
// import it without either module carrying the other's graph.

/** Thrown by create/join when the user already occupies an active game (#155). */
export const ACTIVE_GAME_MESSAGE =
    "You already have an active game. Finish or leave it before starting another.";

/** A deck entry on a seat: `cardId` is the CHOSEN printing (a Print ID, or the
 *  Card ID itself for a default printing); `definitionId` is the Card
 *  Definition it prints, filled at the server boundary from the `cardPrints`
 *  rows just before the library is built (`withSeatDefinitionIds`, ADR 0140
 *  §5). Absent on a stored deck snapshot — never persisted. */
export type SeatDeckCard = {
    cardId: string;
    cardName: string;
    definitionId?: string;
};

export type DeckInput = {
    id: string;
    name: string;
    format: string;
    cards: SeatDeckCard[];
    sideboard?: SeatDeckCard[];
};

export type PlayerInput = {
    id: string;
    name: string;
    bgColor: string;
    deck: DeckInput;
};

/** Builds the Match `players[]` snapshot from the seat inputs. Each seat's
 *  maindeck is `deck.cards`; the sideboard defaults to empty (PRD #387). */
export function buildMatchPlayers(players: PlayerInput[]): MatchPlayer[] {
    return players.map((p) => ({
        id: p.id,
        name: p.name,
        bgColor: p.bgColor,
        deck: snapshotDeck({
            id: p.deck.id,
            name: p.deck.name,
            format: p.deck.format,
            maindeck: p.deck.cards,
            sideboard: p.deck.sideboard,
        }),
        score: 0,
        ready: false,
    }));
}

/** Projects seat inputs into the immutable per-Game snapshot stored on the
 *  `games` row. The deck keeps only `{id,name,format,cards}` — the sideboard
 *  lives on the Match copy (`buildMatchPlayers`), never on the Game (PRD #387).
 *  Mirrors `buildNextGameSeats` (matches.ts) so all `games` inserts agree. */
export function toGamePlayers(players: PlayerInput[]) {
    return players.map((p) => ({
        id: p.id,
        name: p.name,
        bgColor: p.bgColor,
        deck: {
            id: p.deck.id,
            name: p.deck.name,
            format: p.deck.format,
            cards: p.deck.cards,
        },
    }));
}

export const PLAYER_COLORS = ["#4B5A6C", "#63768D"];

// `definitionId` (Card Prints, ADR 0140/issue #4117) rides along on every deck
// card the deck builder saves, so a deck handed to `createGame` /
// `createSoloGame` / `joinGame` carries it and an args validator that does not
// name it rejects the whole mutation. It is ACCEPTED and then dropped: the
// game domain keys off `cardId` (the chosen PRINTING) alone, and both write
// boundaries already narrow — `copyCards` for `gameDecks`/`matchDecks`,
// `toStoredGameSeat` for the `games` row's identity-only deck copy
// (`convex/deckStore.ts`). Optional because a caller that predates the field,
// and every test fixture, sends none.
export const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
    definitionId: v.optional(v.string()),
});

export const deckValidator = v.object({
    id: v.string(),
    name: v.string(),
    format: v.string(),
    cards: v.array(deckCardValidator),
    // Sideboard (PRD #387). Optional so legacy callers (and tests) without a
    // sideboard still validate; snapshotted into the Match deck copy.
    sideboard: v.optional(v.array(deckCardValidator)),
    // Limited Event + Seat reference (ADR 0054/0055, issue #1109/#1111).
    // Present only for a `format: "limited"` deck; `assertDeckLegal`'s
    // injected `ResolvePool` reads these two to resolve the deck's
    // authoritative Pool (`loadLimitedPoolResolver` below). Absent for every
    // other Format.
    limitedEventId: v.optional(v.string()),
    limitedSeatId: v.optional(v.string()),
});

export const bestOfValidator = v.optional(v.union(v.literal(1), v.literal(3)));

/**
 * The Tabletop-side deck gate (ADR 0080), mirroring the three real-engine
 * rejections in `createGame` / `joinGame` / `createSoloGame`. Two conditions:
 * the deck's Format must be `manual`, and it must not be empty — the manual
 * Format validates nothing by design, so `validateDeck` passes an empty deck
 * and a table with no cards is not a game.
 */
export function assertTabletopDeck(deck: {
    format: string;
    cards: unknown[];
}): void {
    if (deck.format !== "manual")
        throw new Error(
            "Only Tabletop-format decks can start a Tabletop game."
        );
    if (deck.cards.length === 0)
        throw new Error("A Tabletop deck must contain at least one card.");
}
