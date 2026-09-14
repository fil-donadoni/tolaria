// The lobby banner's verb, derived from what the server accepts (issue #3336).
//
// The stranding this closes: a Match still active with a FINISHED current Game
// (a Bo3 between Games; before the `recordDrawnGame` fix, also a drawn Game
// that left its Match `playing`). The banner read that as "not playing" and
// offered `leaveGame`, which accepts only `waiting`/`pregame` — so the one
// button on screen threw, the Concede button was hidden precisely because the
// Game was not `playing`, and `lobbyActionGate` disabled every other action.
import { describe, it, expect } from "vitest";
import {
    activeGameBannerMessage,
    activeGameExit,
    type ActiveGameStatus,
} from "../activeGameExit";

/** The GAME statuses `leaveGame` accepts, verbatim from its own guard
 *  (`convex/game.ts`: `game.status !== "waiting" && game.status !== "pregame"`
 *  throws). This table IS the contract — if the mutation ever widens, this is
 *  the line that has to move first. */
const LEAVEABLE: ActiveGameStatus[] = ["waiting", "pregame"];
const ALL: ActiveGameStatus[] = ["waiting", "pregame", "playing", "finished"];

describe("activeGameExit (issue #3336)", () => {
    it("offers `leave` for exactly the statuses `leaveGame` accepts", () => {
        for (const status of ALL) {
            expect([status, activeGameExit(status)]).toEqual([
                status,
                LEAVEABLE.includes(status) ? "leave" : "forfeit",
            ]);
        }
    });

    it("offers `forfeit`, never `leave`, for a finished Game", () => {
        // The bug in one line: `status !== "playing"` put this case in the
        // Leave branch, and `leaveGame` throws on it.
        expect(activeGameExit("finished")).toBe("forfeit");
    });
});

describe("activeGameBannerMessage (issue #3336)", () => {
    it("never calls a finished Game 'waiting for an opponent'", () => {
        for (const matchStatus of ["playing", "sideboarding"] as const) {
            const message = activeGameBannerMessage("finished", matchStatus);
            expect(message).not.toContain("waiting for an opponent");
            expect(message).not.toContain("in progress");
        }
    });

    it("names the Bo3 between-Games state from the MATCH status", () => {
        expect(activeGameBannerMessage("finished", "sideboarding")).toContain(
            "between games"
        );
        // Same GAME status, different Match: not a sideboarding gate.
        expect(activeGameBannerMessage("finished", "playing")).not.toContain(
            "between games"
        );
    });

    it("keeps the two original states intact", () => {
        expect(activeGameBannerMessage("playing", "playing")).toContain(
            "in progress"
        );
        expect(activeGameBannerMessage("waiting", "waiting")).toContain(
            "waiting for an opponent"
        );
    });
});
