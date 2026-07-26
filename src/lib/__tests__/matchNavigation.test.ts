// Where leaving a Match lands the player (QA): a Match played inside a Limited
// Event must return to THAT event's lobby — the general lobby strands the
// player away from their pool, the other seats and the next opponent.
import { describe, it, expect } from "vitest";
import type { PublicMatch } from "@convex/matches";
import { lobbyHrefForMatch } from "../matchNavigation";

const match = (over: Partial<PublicMatch> = {}) =>
    ({
        matchId: "match_1",
        bestOf: 1,
        status: "finished",
        currentGameNumber: 1,
        solo: false,
        vsAi: false,
        players: [],
        ...over,
    }) as unknown as PublicMatch;

describe("lobbyHrefForMatch", () => {
    it("returns the event lobby for an event-bound Match", () => {
        expect(lobbyHrefForMatch(match({ limitedEventId: "ev_1" }))).toBe(
            "/limited/ev_1"
        );
    });

    it("returns the general lobby for an ordinary Match", () => {
        expect(lobbyHrefForMatch(match())).toBe("/");
    });

    it("returns the general lobby when the Match meta is still loading", () => {
        expect(lobbyHrefForMatch(null)).toBe("/");
    });
});
