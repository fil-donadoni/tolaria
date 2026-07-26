import type { PublicMatch } from "@convex/matches";

/** Where "leaving" a Match lands the player.
 *
 *  A Match played INSIDE a Limited Event — a human-vs-human seat challenge
 *  (`challengeLimitedSeat`, issue #1577) or a "Play vs the Table" vs-AI
 *  playtest (PRD #1107 story 25) — carries `limitedEventId`, and its lobby is
 *  the EVENT page: that is where the pool, the other seats and the next
 *  opponent live. Every other Match (constructed, solo, plain vs-AI) goes back
 *  to the general lobby. Shared by every exit affordance (game over, forfeit)
 *  so they can never diverge.
 */
export function lobbyHrefForMatch(match: PublicMatch | null): string {
    return match?.limitedEventId ? `/limited/${match.limitedEventId}` : "/";
}
