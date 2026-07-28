import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { query } from "./_generated/server";
import { seatBelongsToUser } from "./gameLifecycle";

// ---------------------------------------------------------------------------
// Match orchestration (ADR 0029 / PRD #387). A Match is a best-of-N set of
// Games. Issue #392 ships the Bo1 spine: every create/join/solo path now wraps
// its single Game in a `bestOf: 1` Match. The Match owns the cross-game state
// (score, deck copies, ready flags, play/draw chooser); the GRE and the per-
// Game logic are unchanged.
//
// The non-trivial transitions live here as PURE functions over plain
// Match-shaped data so they can be unit-tested without a Convex `ctx` (the
// project has no convex-test harness — integration tests drive the same pure
// functions the mutations call). The Convex mutations in `game.ts` call these
// and persist the result.
// ---------------------------------------------------------------------------

/** A card entry in a deck (maindeck or sideboard). */
export type DeckCard = { cardId: string; cardName: string };

/** The mutable Match-scoped deck copy. Sideboarding edits this; `userDecks`
 *  is read-only for the Match's duration. Each Game's library is built from
 *  `maindeck` as of that Game's start. */
export type MatchDeck = {
    id: string;
    name: string;
    format: string;
    maindeck: DeckCard[];
    sideboard: DeckCard[];
};

export type MatchPlayer = {
    id: string;
    name: string;
    bgColor: string;
    deck: MatchDeck;
    score: number;
    ready: boolean;
};

export type MatchStatus =
    | "waiting"
    | "pregame"
    | "playing"
    | "sideboarding"
    | "finished";

/**
 * Resolve the G1 coin toss (CR 103.2-103.3): a random method determines the
 * starting-player *chooser*, who then decides play/draw (CR 103.4). `roll` is a
 * uniform value in [0, 1) supplied by the mutation (`Math.random()`) — kept out
 * of this pure helper so the winner selection is deterministically testable.
 * Returns the winning seat's id; the caller records it as `playDrawChooserId`.
 */
export function pickCoinTossWinner(
    players: { id: string }[],
    roll: number
): string {
    return players[roll < 0.5 ? 0 : 1].id;
}

/** The mutable subset of a `matches` row the pure transitions operate on. */
export type MatchCore = {
    bestOf: 1 | 3;
    status: MatchStatus;
    players: MatchPlayer[];
    currentGameNumber: number;
    currentGameId?: Id<"games">;
    playDrawChooserId?: string;
    winner?: string;
    /** vs-AI Match: the `-p2` seat is the bot (#394 auto-play). */
    vsAi?: boolean;
};

/** Games a player must win to take the Match: 1 for Bo1, 2 for Bo3 (CR 100.6).
 *  General formula for best-of-N: ceil(N/2) = floor(N/2)+1. */
export function gamesToWin(bestOf: 1 | 3): number {
    return Math.floor(bestOf / 2) + 1;
}

/** Builds the Match-scoped deck copy from a lobby deck payload. Snapshotted at
 *  Match creation so later edits to `userDecks` don't bleed into the Match. */
export function snapshotDeck(input: {
    id: string;
    name: string;
    format: string;
    maindeck: DeckCard[];
    sideboard?: DeckCard[];
}): MatchDeck {
    return {
        id: input.id,
        name: input.name,
        format: input.format,
        // Defensive copies so the Match owns its own arrays.
        maindeck: input.maindeck.map((c) => ({ ...c })),
        sideboard: (input.sideboard ?? []).map((c) => ({ ...c })),
    };
}

/**
 * Record the result of a finished Game into its Match (PRD #387). Pure: returns
 * the patch to apply to the Match row, or `null` when there's nothing to do
 * (no winner — e.g. a draw — leaves the Match untouched for this slice).
 *
 * - Bumps the winner's `score`.
 * - If a player reached games-to-win → `status: "finished"`, set `winner`.
 * - Otherwise (Bo3 mid-match) → `status: "sideboarding"`, reset both `ready`
 *   flags, set `playDrawChooserId` to the Game's loser. (Sideboarding/next-Game
 *   build is a later slice; the Bo1 spine never reaches this branch.)
 */
export function recordGameResult(
    match: MatchCore,
    winnerId: string
): Partial<MatchCore> | null {
    const winnerIdx = match.players.findIndex((p) => p.id === winnerId);
    if (winnerIdx === -1) return null;

    const players = match.players.map((p, i) =>
        i === winnerIdx ? { ...p, score: p.score + 1 } : { ...p }
    );
    const newScore = players[winnerIdx].score;

    if (newScore >= gamesToWin(match.bestOf)) {
        return {
            players,
            status: "finished",
            winner: winnerId,
        };
    }

    // Bo3 mid-match: route to the between-Games sideboarding gate.
    const loser = match.players.find((p) => p.id !== winnerId);
    return {
        players: players.map((p) => ({ ...p, ready: false })),
        status: "sideboarding",
        playDrawChooserId: loser?.id,
    };
}

/**
 * Forfeit the whole Match (PRD #387 user story 30 / issue #396). The forfeiting
 * player gives up the entire Match in one action; the opponent is awarded the
 * Games they still need to win (their score jumps to `gamesToWin(bestOf)`), the
 * Match is marked `finished`, and `winner` is set to the opponent. This differs
 * from `concede`, which loses only the CURRENT Game and routes through the
 * normal flow. In a Bo1 the two coincide — conceding the one Game ends the Match
 * — but in a Bo3 a forfeit ends the Match immediately regardless of the running
 * score, where a concede would only lose that Game.
 *
 * Pure: returns the patch to apply to the Match row, or `null` when the
 * forfeiter isn't in the seat list (nothing to do). The opponent's score is set
 * to exactly the games-to-win threshold so the recorded Match score is
 * internally consistent (e.g. 2–0 / 2–1 in a Bo3) rather than left mid-flight.
 */
export function forfeitMatch(
    match: MatchCore,
    forfeiterId: string
): Partial<MatchCore> | null {
    const forfeiterIdx = match.players.findIndex((p) => p.id === forfeiterId);
    if (forfeiterIdx === -1) return null;
    const opponent = match.players.find((p) => p.id !== forfeiterId);
    if (!opponent) return null;

    const target = gamesToWin(match.bestOf);
    const players = match.players.map((p) => ({
        ...p,
        // Opponent is awarded the games they need to win; never lower an
        // already-higher score (defensive — a winner would have finished).
        score: p.id === opponent.id ? Math.max(p.score, target) : p.score,
        ready: false,
    }));
    return {
        players,
        status: "finished",
        winner: opponent.id,
        playDrawChooserId: undefined,
    };
}

// ---------------------------------------------------------------------------
// Sideboarding (PRD #387 / issue #395). Between Games of a Bo3 a player may
// exchange cards between their Maindeck and Sideboard. The swap is constrained
// so the Maindeck size stays equal to its starting size and the combined card
// pool (Maindeck + Sideboard) is unchanged — sideboarding only RE-PARTITIONS the
// pool, it never adds or drops cards. Edits mutate the Match deck copy ONLY; the
// saved `userDecks` row is read-only for the Match's duration.
// ---------------------------------------------------------------------------

/** A canonical multiset of a card list: counts per `cardId`, order-independent.
 *  Two pools are equal iff their multisets match. */
function poolMultiset(cards: DeckCard[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const c of cards) m.set(c.cardId, (m.get(c.cardId) ?? 0) + 1);
    return m;
}

function multisetEqual(
    a: Map<string, number>,
    b: Map<string, number>
): boolean {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (b.get(k) !== v) return false;
    return true;
}

/** A player's post-swap partition of their combined pool into Maindeck and
 *  Sideboard, submitted during the between-Games Sideboarding step. */
export type SideboardSubmission = {
    maindeck: DeckCard[];
    sideboard: DeckCard[];
};

/**
 * Apply a player's sideboarding submission to their Match deck copy (PRD #387 /
 * #395). Pure: returns the new {@link MatchDeck}; throws on any invariant
 * violation so the Convex mutation rejects an illegal swap atomically.
 *
 * Invariants enforced:
 * - **Size-lock**: the new Maindeck size MUST equal the current Maindeck size
 *   (a player can't change their deck size mid-match).
 * - **Pool preservation**: the combined multiset (Maindeck + Sideboard) MUST be
 *   unchanged — sideboarding only re-partitions the existing pool.
 *
 * `userDecks` is never read or written here; the caller passes the Match copy.
 */
export function applySideboard(
    deck: MatchDeck,
    submission: SideboardSubmission
): MatchDeck {
    // Size floor, not a hard lock (QA sideboard revamp): the maindeck may GROW
    // past the registered size (constructed 60 / limited 40 stay the floor) —
    // MTG sideboarding only forbids going UNDER the minimum. Pool preservation
    // below still pins the combined main+side multiset.
    if (submission.maindeck.length < deck.maindeck.length) {
        throw new Error(
            `Maindeck must stay at least ${deck.maindeck.length} cards; got ${submission.maindeck.length}`
        );
    }
    const currentPool = poolMultiset([...deck.maindeck, ...deck.sideboard]);
    const nextPool = poolMultiset([
        ...submission.maindeck,
        ...submission.sideboard,
    ]);
    if (!multisetEqual(currentPool, nextPool)) {
        throw new Error(
            "Sideboarding may only re-partition the existing card pool; the combined Maindeck + Sideboard must be unchanged"
        );
    }
    return {
        id: deck.id,
        name: deck.name,
        format: deck.format,
        // Defensive copies — the Match owns its own arrays.
        maindeck: submission.maindeck.map((c) => ({ ...c })),
        sideboard: submission.sideboard.map((c) => ({ ...c })),
    };
}

/** True when every seat in the Match is ready — the gate to build the next
 *  Game. Both flags are reset by `recordGameResult` when a Game ends. */
export function allSeatsReady(match: {
    players: { ready: boolean }[];
}): boolean {
    return match.players.length > 0 && match.players.every((p) => p.ready);
}

/** The bot's seat id in a vs-AI Match (`${userId}-p2`, ADR 0001), or null. The
 *  bot auto-readies with no swaps so the human is never blocked on it (#395). */
export function botSeatId(match: {
    vsAi?: boolean;
    players: { id: string }[];
}): string | null {
    if (match.vsAi !== true) return null;
    return match.players.find((p) => isBotSeat(p.id))?.id ?? null;
}

/**
 * SECURITY (issue #1645 review) — the RESIGNATION gate for an event-bound
 * vs-AI pairing. Applies to `forfeitMatch` and `concede` ONLY.
 *
 * This is a strictly HIGHER bar than `assertSeatOwnership`, and the two must
 * not be conflated. `assertSeatOwnership` asks "does the caller own this seat
 * HANDLE" — in a vs-AI pairing the human owns BOTH handles (`${uid}-p1` and
 * `${uid}-p2`, ADR 0001), which is exactly right for ordinary gameplay (the
 * client-side Brain drives the bot seat through `playCard`, `passPriority`, …
 * and must keep working) and exactly useless against a resignation aimed at
 * `${uid}-p2`. A round pairing's Match result is written into the Limited
 * standings (PRD #1628), so `forfeitMatch({ playerId: "${uid}-p2" })` would
 * otherwise be a one-call 2-0 with zero games played.
 *
 * `limitedPairing` is the discriminator: a CASUAL solo/vs-AI Match carries
 * none, writes no standings row, and stays freely concedable from either seat.
 *
 * Never call this from an ordinary gameplay mutation — it would make the bot
 * unplayable in an event pairing, which is worse than the hole it closes.
 */
export function assertNotEventBotSeat(
    doc: {
        vsAi?: boolean;
        limitedPairing?: unknown;
        players: { id: string }[];
    },
    playerId: string
): void {
    if (doc.limitedPairing === undefined) return;
    if (playerId === botSeatId(doc))
        throw new Error(
            "You cannot resign your bot opponent's seat in an event pairing."
        );
}

/** A seat for the next Game, derived from a Match player. Mirrors the
 *  `PlayerInput` shape that `game.ts`'s `buildInitialGameState` consumes — the
 *  next Game's library is built from the player's CURRENT Match maindeck as of
 *  this Game's start (PRD #387). Sideboarding (#394) edits `deck.maindeck`
 *  before this runs; this slice reads it unchanged. */
export type NextGameSeat = {
    id: string;
    name: string;
    bgColor: string;
    deck: {
        id: string;
        name: string;
        format: string;
        cards: DeckCard[];
        /** CR 702.139c (ADR 0064) — the Match deck's current SIDEBOARD,
         *  carried through so `buildInitialGameState` can auto-declare a
         *  Companion at game init (`selectCompanion`, gre/companion.ts).
         *  Re-scanned per Bo3 Game — this seat is rebuilt from the Match
         *  copy after every sideboarding submission, so a companion
         *  swapped in/out changes legality for the next Game. Distinct
         *  from the per-Game `games` row snapshot (PRD #387), which never
         *  carries the sideboard. */
        sideboard: DeckCard[];
    };
};

/**
 * Build the seat inputs for the next Game of an undecided Bo3 Match (PRD #387).
 * Pure: maps each Match player to a `PlayerInput`-shaped seat whose library
 * comes from that player's current Match `maindeck`. The Convex `continueMatch`
 * mutation feeds these into `buildInitialGameState` (fresh 20 life, shuffled
 * library, new hand, MULLIGAN). This slice does NOT apply the play/draw choice —
 * the next Game auto-builds with the default active player (#395 refines it).
 */
export function buildNextGameSeats(match: {
    players: MatchPlayer[];
}): NextGameSeat[] {
    return match.players.map((p) => ({
        id: p.id,
        name: p.name,
        bgColor: p.bgColor,
        deck: {
            id: p.deck.id,
            name: p.deck.name,
            format: p.deck.format,
            // Defensive copy — the new Game owns its own card array. The
            // sideboard stays on the Match copy only; the per-Game snapshot
            // (`games` row) holds the immutable starting maindeck (PRD #387).
            cards: p.deck.maindeck.map((c) => ({ ...c })),
            // CR 702.139c (ADR 0064) — also a defensive copy. Carried on the
            // SEAT (not the immutable `games` row snapshot) purely to feed
            // `buildInitialGameState`'s companion auto-declare; never
            // persisted onto the Game document itself.
            sideboard: p.deck.sideboard.map((c) => ({ ...c })),
        },
    }));
}

/** Project the next-Game seats into the immutable `games`-row `players[]`
 *  snapshot: drop the seat's `sideboard`, which is carried purely to feed
 *  `buildInitialGameState`'s companion auto-declare (ADR 0064) and is NOT part
 *  of the `games` schema (an extra field the validator rejects). Mirrors
 *  `toGamePlayers` (game.ts) so all `games` inserts agree (PRD #387). */
export function toNextGamePlayers(seats: NextGameSeat[]) {
    return seats.map((s) => ({
        id: s.id,
        name: s.name,
        bgColor: s.bgColor,
        deck: {
            id: s.deck.id,
            name: s.deck.name,
            format: s.deck.format,
            cards: s.deck.cards,
        },
    }));
}

// ---------------------------------------------------------------------------
// Play/draw choice for Games 2+ (#394, CR 103.4). After a non-deciding Game the
// loser of that Game (`playDrawChooserId`, set by `recordGameResult`) chooses to
// play or draw for the next Game. The choice only sets which player is active at
// turn 1: "play" => the chooser is the active player; "draw" => the opponent is.
// The on-the-play skip-first-draw rule is already correct in the engine
// (`turn === 1`, CR 103.8), so no engine change is needed — only the starting
// active player.
// ---------------------------------------------------------------------------

export type PlayDrawChoice = "play" | "draw";

/** In a vs-AI Match the bot seat is the `${userId}-p2` seat created by
 *  `createSoloGame` (ADR 0001). The human always holds `-p1`. */
export function isBotSeat(seatId: string): boolean {
    return seatId.endsWith("-p2");
}

/** True when the recorded play/draw chooser is the AI bot, so the choice must
 *  be made automatically (auto-play) with no human prompt (#394). Only vs-AI
 *  Matches have a bot seat. */
export function botIsChooser(match: {
    vsAi?: boolean;
    playDrawChooserId?: string;
}): boolean {
    return (
        match.vsAi === true &&
        match.playDrawChooserId !== undefined &&
        isBotSeat(match.playDrawChooserId)
    );
}

/**
 * Resolve the play/draw choice to the active player at turn 1 of the next Game
 * (#394, CR 103.4). `chooserId` is the previous Game's loser; `choice` is their
 * decision. "play" keeps the chooser as the active player; "draw" hands the
 * first turn to the opponent. Returns `undefined` when the chooser isn't found
 * in the seat list, letting the caller fall back to the default active player.
 */
export function nextGameActivePlayerId(
    match: { players: { id: string }[]; playDrawChooserId?: string },
    choice: PlayDrawChoice
): string | undefined {
    const chooserId = match.playDrawChooserId;
    if (chooserId === undefined) return undefined;
    if (!match.players.some((p) => p.id === chooserId)) return undefined;
    if (choice === "play") return chooserId;
    // "draw": the opponent of the chooser takes the first turn.
    return match.players.find((p) => p.id !== chooserId)?.id;
}

// ---------------------------------------------------------------------------
// Single-active-match guard (#155 → match-scoped, ADR 0029). Replaces the
// single-active-game guard: a user holds at most one active (waiting / playing
// / sideboarding) Match. Finished Matches never count.
// ---------------------------------------------------------------------------

export const ACTIVE_MATCH_STATUSES = [
    "waiting",
    "pregame",
    "playing",
    "sideboarding",
] as const;

/** A player handle belongs to `userId` when it equals the user's id (2-player)
 *  or one of the solo seats `${userId}-p1` / `${userId}-p2`. Convex ids contain
 *  no `-`, so the prefix test is unambiguous. Mirrors `gameBelongsToUser`. */
export function matchBelongsToUser(
    match: { players: { id: string }[] },
    userId: string
): boolean {
    return match.players.some((p) => seatBelongsToUser(p.id, userId));
}

/** The user's current active Match, or null. Scans only the small active set
 *  via the `by_status` index — finished Matches are never read. */
export async function findActiveMatchForUser(
    ctx: GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>,
    userId: string
): Promise<Doc<"matches"> | null> {
    for (const status of ACTIVE_MATCH_STATUSES) {
        const matches = await ctx.db
            .query("matches")
            .withIndex("by_status", (q) => q.eq("status", status))
            .collect();
        const mine = matches.find((m) => matchBelongsToUser(m, userId));
        if (mine) return mine;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Projection (PRD #387). Public Match meta is visible to both players; the deck
// copies are projected per-viewer — a player sees only their own maindeck +
// sideboard, the opponent's is reduced to ready-state only. Solo sees both
// seats (consistent with Solo seeing both hands).
// ---------------------------------------------------------------------------

export type PublicMatchPlayer = {
    id: string;
    name: string;
    bgColor: string;
    score: number;
    ready: boolean;
    /** Own (or solo) seat only: the Match-scoped deck copy. Stripped for the
     *  opponent so sideboarding stays secret. */
    deck?: MatchDeck;
};

export type PublicMatch = {
    matchId: Id<"matches">;
    bestOf: 1 | 3;
    status: MatchStatus;
    currentGameNumber: number;
    currentGameId?: Id<"games">;
    playDrawChooserId?: string;
    winner?: string;
    solo: boolean;
    vsAi: boolean;
    /** Limited Event this Match belongs to (issue #1577 challenge, or a "Play
     *  vs the Table" playtest). On the wire so the client can return to the
     *  EVENT lobby when the Match ends rather than the general lobby. */
    limitedEventId?: string;
    players: PublicMatchPlayer[];
};

/** Projects a Match for a viewer. `viewerId` is the user's id; solo mode passes
 *  `solo: true` to reveal both seats. The opponent's deck contents are stripped
 *  during a 2-player Match. */
export function projectMatch(
    match: Doc<"matches">,
    viewerId: string
): PublicMatch {
    const solo = match.solo === true;
    return {
        matchId: match._id,
        bestOf: match.bestOf,
        status: match.status,
        currentGameNumber: match.currentGameNumber,
        currentGameId: match.currentGameId,
        playDrawChooserId: match.playDrawChooserId,
        winner: match.winner,
        solo,
        vsAi: match.vsAi === true,
        limitedEventId: match.limitedEventId,
        players: match.players.map((p) => {
            const own =
                solo || p.id === viewerId || p.id.startsWith(`${viewerId}-`);
            return {
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                score: p.score,
                ready: p.ready,
                ...(own ? { deck: p.deck } : {}),
            };
        }),
    };
}

// ---------------------------------------------------------------------------
// Cascade delete (ADR 0029). Removing a finished Match cascades its Games and
// their `gameStates`. Shared by the cleanup cron and any explicit teardown.
// ---------------------------------------------------------------------------

export async function deleteMatchCascade(
    ctx: GenericMutationCtx<DataModel>,
    matchId: Id<"matches">
): Promise<void> {
    const games = await ctx.db
        .query("games")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .collect();
    for (const game of games) {
        const snapshots = await ctx.db
            .query("gameStates")
            .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
            .collect();
        for (const s of snapshots) await ctx.db.delete(s._id);
        // Tick row companion (PRD #1776 T3, issue #1778) — deleted alongside
        // its `gameStates` row so a finished game leaves no orphan.
        const ticks = await ctx.db
            .query("gameTicks")
            .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
            .collect();
        for (const t of ticks) await ctx.db.delete(t._id);
        await ctx.db.delete(game._id);
    }
    await ctx.db.delete(matchId);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Public Match meta for the client (score, format, status, ready flags, the
 *  play/draw chooser). The viewer's own deck copy is included; the opponent's
 *  is stripped. Returns null when the Match is gone. */
export const getMatch = query({
    args: { matchId: v.id("matches") },
    handler: async (ctx, args) => {
        const userId = await auth.getUserId(ctx);
        const match = await ctx.db.get(args.matchId);
        if (!match) return null;
        return projectMatch(match, userId ?? "");
    },
});

/** #155 (match-scoped): the caller's current active Match, or null. The lobby
 *  surfaces it instead of attempting a (rejected) second creation. */
export const myActiveMatch = query({
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return null;
        const match = await findActiveMatchForUser(ctx, userId);
        if (!match) return null;
        return {
            matchId: match._id,
            bestOf: match.bestOf,
            status: match.status,
            currentGameId: match.currentGameId,
            solo: match.solo === true,
            vsAi: match.vsAi === true,
        };
    },
});
