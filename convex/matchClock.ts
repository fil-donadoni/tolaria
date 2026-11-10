// Per-player Match Clock (issue #2308): a chess clock for Constructed Matches.
//
// PURE — no `ctx`, no database: the arithmetic of who is charged, who runs and
// when a clock runs out lives here, so the persistence seam
// (`convex/gameStateStore.ts`'s tick writer), the expiry job (`convex/game.ts`)
// and the board (`src/components/board/match-clock.tsx`) all read one
// definition (ADR 0074: the client may import it, never with authority).
//
// Semantics (owner decisions recorded on issue #2308):
// - each player owns a budget for the WHOLE Match (Bo1 15', Bo3 25' by
//   default), carried from Game to Game;
// - a player's clock runs while the game is WAITING ON THAT PLAYER — priority
//   or any pending decision without priority — and stops the moment it is not;
// - a clock reaching zero loses the Match (server-driven expiry);
// - between Games both clocks are stopped and sideboarding is a fixed window.
import { v, type Infer } from "convex/values";

/** Default minutes per player, keyed by Games Format (issue #2308). */
export const MATCH_CLOCK_DEFAULT_MINUTES: Readonly<Record<1 | 3, number>> = {
    1: 15,
    3: 25,
};

/** Bounds a configured budget must sit in (minutes per player). */
export const MATCH_CLOCK_MIN_MINUTES = 1;
export const MATCH_CLOCK_MAX_MINUTES = 120;

/** The fixed sideboarding window between Games of a clocked Match (issue
 *  #2308 — the owner's figure for the Arena/MTGO default). Both player clocks
 *  are stopped for its duration; at its end the decks are taken unchanged. */
export const SIDEBOARD_WINDOW_MS = 2 * 60_000;

export const clockRemainingValidator = v.array(
    v.object({ playerId: v.string(), remainingMs: v.number() })
);

/** The Match row's clock configuration: the budget, and — once a Game has
 *  ended — each player's remainder, which the next Game starts from. */
export const matchClockConfigValidator = v.object({
    budgetMs: v.number(),
    remaining: v.optional(clockRemainingValidator),
});

/** The live clock of one Game, carried on its `gameTicks` row. A running
 *  player's `remainingMs` is the value AT `runningSince` — the live value is
 *  derived (`liveRemainingMs`), never stored, so nothing has to tick. */
export const tickClockValidator = v.object({
    players: clockRemainingValidator,
    runningPlayerId: v.optional(v.string()),
    runningSince: v.optional(v.number()),
    expiryJobId: v.optional(v.id("_scheduled_functions")),
});

export type MatchClockConfig = Infer<typeof matchClockConfigValidator>;
export type TickClock = Infer<typeof tickClockValidator>;

/** Minutes → budget, refusing anything outside the bounds or fractional. */
export function clockBudgetMs(minutes: number): number {
    if (
        !Number.isInteger(minutes) ||
        minutes < MATCH_CLOCK_MIN_MINUTES ||
        minutes > MATCH_CLOCK_MAX_MINUTES
    ) {
        throw new Error(
            `Match clock must be a whole number of minutes between ${MATCH_CLOCK_MIN_MINUTES} and ${MATCH_CLOCK_MAX_MINUTES}.`
        );
    }
    return minutes * 60_000;
}

/** A Game's clock at its first save: every seat starts from the Match's
 *  carried remainder, or the full budget when it has none (Game 1). */
export function initialTickClock(
    config: MatchClockConfig,
    playerIds: readonly string[]
): TickClock {
    return {
        players: playerIds.map((playerId) => ({
            playerId,
            remainingMs:
                config.remaining?.find((r) => r.playerId === playerId)
                    ?.remainingMs ?? config.budgetMs,
        })),
    };
}

/** What `player` has left at `now`, the running time deducted. */
export function liveRemainingMs(
    clock: TickClock,
    playerId: string,
    now: number
): number {
    const entry = clock.players.find((p) => p.playerId === playerId);
    if (!entry) return 0;
    if (clock.runningPlayerId !== playerId || clock.runningSince === undefined)
        return entry.remainingMs;
    // A `now` read before `runningSince` (a display's last tick predating the
    // save) charges nothing rather than crediting time back.
    const elapsed = Math.max(0, now - clock.runningSince);
    return Math.max(0, entry.remainingMs - elapsed);
}

/** One stable save: charge the time elapsed since the last one to the player
 *  who was running, then start the clock of the player the game now waits on
 *  (none once the game is over, or when it waits on no clocked seat). */
export function advanceClock(
    clock: TickClock,
    awaitedPlayerId: string | null,
    now: number,
    gameOver: boolean
): TickClock {
    const players = clock.players.map((p) => ({
        playerId: p.playerId,
        remainingMs: liveRemainingMs(clock, p.playerId, now),
    }));
    const runner =
        !gameOver &&
        awaitedPlayerId !== null &&
        players.some((p) => p.playerId === awaitedPlayerId)
            ? awaitedPlayerId
            : undefined;
    return {
        players,
        ...(runner !== undefined
            ? { runningPlayerId: runner, runningSince: now }
            : {}),
        ...(clock.expiryJobId !== undefined
            ? { expiryJobId: clock.expiryJobId }
            : {}),
    };
}

/** The instant the running clock reaches zero, or `null` when none runs. */
export function clockExpiresAt(clock: TickClock): number | null {
    if (clock.runningPlayerId === undefined || clock.runningSince === undefined)
        return null;
    const entry = clock.players.find(
        (p) => p.playerId === clock.runningPlayerId
    );
    return entry ? clock.runningSince + entry.remainingMs : null;
}

/** The player whose clock has run out at `now`, or `null`. Only the running
 *  clock can run out — a stopped one never moves. */
export function expiredPlayerId(clock: TickClock, now: number): string | null {
    const at = clockExpiresAt(clock);
    return at !== null && now >= at ? (clock.runningPlayerId ?? null) : null;
}
