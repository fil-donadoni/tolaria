// Which exit the lobby's active game actually HAS, derived from what the
// server will accept (issue #3336).
//
// `myActiveGame` reports the GAME row's status, and splitting it into
// "playing" vs "everything else" is not exhaustive. A `finished` Game row is
// reachable while its Match is still active — a Bo3 whose G1 just ended sits
// in `sideboarding` with `currentGameId` still pointing at the finished Game —
// and that state used to read as "waiting for an opponent", offering
// `leaveGame`, which accepts ONLY `waiting`/`pregame` and throws for anything
// else. Every button on the banner then failed, while `lobbyActionGate` kept
// every other lobby action disabled on `hasActiveGame`: an account with no
// in-app way out.
//
// So the offered verb is derived here, in the one place both consumers read
// (`ActiveGameNotice` and `useScenarioTestGame`), rather than each deriving it
// again — they had already drifted once, #2400's review round 3 fixing the
// hook and leaving the banner exactly as it was.
import type { Doc } from "@convex/_generated/dataModel";
import type { MatchStatus } from "@convex/matches";

/** The GAME row status `myActiveGame` reports — the source of truth's own
 *  union, never a local copy of it. */
export type ActiveGameStatus = Doc<"games">["status"];

/** `leave` → `game.leaveGame` (it deletes the waiting room and its Match);
 *  `forfeit` → `game.forfeitMatch` / `game.manualConcedeMatch`, which accept
 *  any Match that is not already finished, whatever its current Game's status.
 */
export type ActiveGameExit = "leave" | "forfeit";

/**
 * The mutation the banner may offer for a Game in `status`.
 *
 * The condition is `leaveGame`'s own, spelled as the exact statuses it
 * accepts: widening it to `status !== "playing"` is the bug — it routes a
 * `finished`-but-still-in-Match Game into a throw that frees nothing.
 */
export function activeGameExit(status: ActiveGameStatus): ActiveGameExit {
    return status === "waiting" || status === "pregame" ? "leave" : "forfeit";
}

/**
 * The banner's sentence — three situations, not two, because a finished Game
 * under a live Match is neither "in progress" nor "waiting for an opponent".
 */
export function activeGameBannerMessage(
    status: ActiveGameStatus,
    matchStatus: MatchStatus
): string {
    if (status === "playing")
        return "You have a game in progress. Finish or concede it before starting another.";
    if (status === "waiting" || status === "pregame")
        return "You have a game waiting for an opponent. Finish or leave it before starting another.";
    if (matchStatus === "sideboarding")
        return "Your match is between games. Resume it to sideboard, or concede it before starting another.";
    return "Your last game is over but the match is still open. Concede it before starting another.";
}
