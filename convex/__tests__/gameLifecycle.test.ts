import { describe, it, expect } from "vitest";
import { gameBelongsToUser, ACTIVE_GAME_STATUSES } from "../gameLifecycle";

type Player = { id: string };
function game(playerIds: string[]): { players: Player[] } {
    return { players: playerIds.map((id) => ({ id })) };
}

// The single-active-game guard (#155) hinges on correctly recognising which
// games a user occupies across the two seat shapes: bare `userId` (2-player)
// and `${userId}-p1`/`-p2` (solo / vs-AI).
describe("gameBelongsToUser (#155 single-active-game guard)", () => {
    const userId = "user_abc123";
    const other = "user_xyz789";

    it("matches a 2-player seat held by the user", () => {
        expect(gameBelongsToUser(game([userId, other]), userId)).toBe(true);
    });

    it("matches a solo P1 seat", () => {
        expect(
            gameBelongsToUser(game([`${userId}-p1`, `${userId}-p2`]), userId)
        ).toBe(true);
    });

    it("matches the P2 seat too (either seat counts)", () => {
        expect(gameBelongsToUser(game([`${userId}-p2`]), userId)).toBe(true);
    });

    it("does not match a game owned by another user", () => {
        expect(gameBelongsToUser(game([other]), userId)).toBe(false);
        expect(
            gameBelongsToUser(game([`${other}-p1`, `${other}-p2`]), userId)
        ).toBe(false);
    });

    it("does not false-match when the other id has the user's id as a suffix", () => {
        // Convex ids contain no '-', but guard against accidental substring
        // matches: `x${userId}` must not be read as belonging to `userId`.
        expect(gameBelongsToUser(game([`prefix${userId}`]), userId)).toBe(
            false
        );
    });

    it("treats an empty game as unowned", () => {
        expect(gameBelongsToUser(game([]), userId)).toBe(false);
    });

    it("counts only waiting and playing as active statuses", () => {
        expect(ACTIVE_GAME_STATUSES).toEqual(["waiting", "playing"]);
        expect(ACTIVE_GAME_STATUSES).not.toContain("finished");
    });
});
