// In-game pause menu: the Concede-vs-Forfeit split (issue #396). Concede loses
// only the current Game (api.game.concede); Forfeit ends the whole Match
// (api.game.forfeitMatch) and returns to the lobby. A Bo1 shows Concede only;
// a Bo3 shows both. See `../pause-menu-dialog`.
//
// Issue #2353 — the same dialog on the Manual Board, where the mode rides the
// board context's `isManualGame` discriminator: one Concede, dispatching the
// finalizing `manualConcedeMatch` and never either GRE mutation.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { PublicMatch } from "@convex/matches";
import type { Id } from "@convex/_generated/dataModel";
import { GameContext } from "~/hooks/useGameContext";
import PauseMenuDialog from "../pause-menu-dialog";
import { subscribeBugReportRequests } from "~/lib/bug-report-requests";

const concede = vi.fn(() => Promise.resolve(undefined));
const forfeitMatch = vi.fn(() => Promise.resolve(undefined));
const manualConcedeMatch = vi.fn(() => Promise.resolve(undefined));
const clearSession = vi.fn();

const MUTATIONS: Record<string, typeof concede> = {
    concede,
    forfeitMatch,
    manualConcedeMatch,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name],
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            concede: { _name: "concede" },
            forfeitMatch: { _name: "forfeitMatch" },
            manualConcedeMatch: { _name: "manualConcedeMatch" },
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
        manualConcedeMatch.mockClear();
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
        expect(manualConcedeMatch).not.toHaveBeenCalled();
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
        expect(manualConcedeMatch).not.toHaveBeenCalled();
    });
});

describe("PauseMenuDialog in a Manual Game (issue #2353)", () => {
    beforeEach(() => {
        concede.mockClear();
        forfeitMatch.mockClear();
        manualConcedeMatch.mockClear();
        clearSession.mockClear();
    });

    // Only the discriminator is read; `makeManualGameContext` is the one real
    // producer of it.
    const manualCtx = { isManualGame: true } as never;

    it("offers one Concede even on a Bo3 Match, confirms first, and dispatches manualConcedeMatch — never a GRE mutation", async () => {
        const { getByRole, queryByRole } = render(
            <GameContext value={manualCtx}>
                <PauseMenuDialog
                    open
                    onOpenChange={() => {}}
                    gameId={gameId}
                    playerId="me"
                    match={bo(3)}
                />
            </GameContext>
        );
        expect(queryByRole("button", { name: "Concede Game" })).toBeNull();
        expect(queryByRole("button", { name: "Concede Match" })).toBeNull();

        fireEvent.click(getByRole("button", { name: "Concede" }));
        // The confirmation step, not a dispatch.
        expect(manualConcedeMatch).not.toHaveBeenCalled();
        fireEvent.click(getByRole("button", { name: "Yes" }));
        await Promise.resolve();

        expect(manualConcedeMatch).toHaveBeenCalledWith({
            gameId,
            playerId: "me",
        });
        expect(concede).not.toHaveBeenCalled();
        expect(forfeitMatch).not.toHaveBeenCalled();
        // The route's `ManualGameOverDialog` owns the session teardown.
        expect(clearSession).not.toHaveBeenCalled();
    });

    it("No backs out of the confirmation without dispatching anything", () => {
        const { getByRole } = render(
            <GameContext value={manualCtx}>
                <PauseMenuDialog
                    open
                    onOpenChange={() => {}}
                    gameId={gameId}
                    playerId="me"
                    match={null}
                />
            </GameContext>
        );
        fireEvent.click(getByRole("button", { name: "Concede" }));
        fireEvent.click(getByRole("button", { name: "No" }));
        expect(getByRole("button", { name: "Concede" })).toBeTruthy();
        expect(manualConcedeMatch).not.toHaveBeenCalled();
    });
});

// Issue #3419: the portrait bar has no room for a bug-report control, so the
// pause menu carries the entry. It closes the menu and asks the router-root
// host — the dialog must outlive the menu it was opened from.
describe("PauseMenuDialog bug-report entry (issue #3419)", () => {
    it("closes the menu and asks the router-root host to open the bug report", () => {
        const onOpenChange = vi.fn();
        const requested = vi.fn();
        const unsubscribe = subscribeBugReportRequests(requested);
        const { getByRole } = render(
            <PauseMenuDialog
                open
                onOpenChange={onOpenChange}
                gameId={gameId}
                playerId="me"
                match={bo(1)}
            />
        );
        fireEvent.click(getByRole("button", { name: "Report a bug" }));
        unsubscribe();
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(requested).toHaveBeenCalledTimes(1);
    });
});
