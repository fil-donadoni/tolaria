// In-game pause menu: the Concede-vs-Forfeit split (issue #396). Concede loses
// only the current Game (api.game.concede); Forfeit ends the whole Match
// (api.game.forfeitMatch) and returns to the lobby. A Bo1 shows Concede only;
// a Bo3 shows both. See `../pause-menu-dialog`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { PublicMatch } from "@convex/matches";
import type { Id } from "@convex/_generated/dataModel";
import PauseMenuDialog from "../pause-menu-dialog";

const concede = vi.fn(() => Promise.resolve(undefined));
const forfeitMatch = vi.fn(() => Promise.resolve(undefined));
const clearSession = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "concede" ? concede : forfeitMatch,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            concede: { _name: "concede" },
            forfeitMatch: { _name: "forfeitMatch" },
        },
    },
}));
vi.mock("~/lib/session", () => ({
    clearSession: () => clearSession(),
}));

const gameId = "g1" as Id<"games">;

function bo(bestOf: 1 | 3): PublicMatch {
    return {
        matchId: "m1" as PublicMatch["matchId"],
        bestOf,
        status: "playing",
        currentGameNumber: 1,
        solo: false,
        vsAi: false,
        players: [
            { id: "me", name: "Me", bgColor: "#000", score: 0, ready: false },
            { id: "opp", name: "Opp", bgColor: "#111", score: 0, ready: false },
        ],
    };
}

describe("PauseMenuDialog Concede vs Forfeit (issue #396)", () => {
    beforeEach(() => {
        concede.mockClear();
        forfeitMatch.mockClear();
        clearSession.mockClear();
    });

    it("Bo1: only Concede is offered, and it loses the current Game", async () => {
        const { getByRole, queryByRole } = render(
            <PauseMenuDialog
                open
                onOpenChange={() => {}}
                gameId={gameId}
                playerId="me"
                match={bo(1)}
            />
        );
        // No separate match-ending action in a Bo1 (the "Concede Match" button,
        // which dispatches forfeitMatch, is Bo3-only).
        expect(queryByRole("button", { name: "Concede Match" })).toBeNull();
        fireEvent.click(getByRole("button", { name: "Concede" }));
        fireEvent.click(getByRole("button", { name: "Yes" }));
        await Promise.resolve();
        expect(concede).toHaveBeenCalledWith({ gameId, playerId: "me" });
        expect(forfeitMatch).not.toHaveBeenCalled();
    });

    it("Bo3: Concede Game loses one Game; Forfeit Match ends the Match", async () => {
        const { getByRole } = render(
            <PauseMenuDialog
                open
                onOpenChange={() => {}}
                gameId={gameId}
                playerId="me"
                match={bo(3)}
            />
        );
        // Concede path → concede mutation (loses the Game only).
        fireEvent.click(getByRole("button", { name: "Concede Game" }));
        fireEvent.click(getByRole("button", { name: "Yes" }));
        await Promise.resolve();
        expect(concede).toHaveBeenCalledWith({ gameId, playerId: "me" });
        expect(forfeitMatch).not.toHaveBeenCalled();
    });

    it("Bo3: Concede Match dispatches forfeitMatch and clears the session", async () => {
        const { getByRole } = render(
            <PauseMenuDialog
                open
                onOpenChange={() => {}}
                gameId={gameId}
                playerId="me"
                match={bo(3)}
            />
        );
        // "Concede Match" is the UI label; it still dispatches forfeitMatch.
        fireEvent.click(getByRole("button", { name: "Concede Match" }));
        fireEvent.click(getByRole("button", { name: "Yes" }));
        await Promise.resolve();
        expect(forfeitMatch).toHaveBeenCalledWith({
            matchId: "m1",
            playerId: "me",
        });
        expect(clearSession).toHaveBeenCalledOnce();
        expect(concede).not.toHaveBeenCalled();
    });
});
