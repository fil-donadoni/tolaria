// The Tabletop result screen (ADR 0080: "a game ends by concede only").
//
// Two things it must never do, both of which the Manual Game had before this
// screen existed: leave the player looking at a permanent "Loading..." (the
// board's `manualStates` rows are deleted on concede), and route an undecided
// Bo3 into the GRE `SideboardingDialog` — that dialog reads `useGameContext()`
// a Manual Game never mounts, and ADR 0080 rejects the between-games sideboard
// editor outright. The interstitial action here is "Next game".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

const continueMatch = vi.fn(() =>
    Promise.resolve({ gameId: "game_2", gameNumber: 2 })
);
let matchStatus: string | null = "finished";

vi.mock("convex/react", () => ({
    useMutation: () => continueMatch,
    useQuery: () =>
        matchStatus === null
            ? null
            : {
                  status: matchStatus,
                  winner: "opp",
                  players: [
                      { id: "me", name: "Me", score: 0 },
                      { id: "opp", name: "Rival", score: 1 },
                  ],
              },
}));
vi.mock("@convex/_generated/api", () => ({
    api: { matches: { getMatch: {} }, game: { continueManualMatch: {} } },
}));

const storeSession = vi.fn();
vi.mock("~/lib/session", () => ({
    storeSession: (...args: unknown[]) => storeSession(...args),
    clearSession: vi.fn(),
}));

import ManualGameOverDialog from "../manual-game-over-dialog";

const PLAYERS = [
    { id: "me", name: "Me" },
    { id: "opp", name: "Rival" },
];

const onSwitchGame = vi.fn();

function renderOver(viewerId: string) {
    return render(
        <ManualGameOverDialog
            players={PLAYERS}
            winnerId="opp"
            matchId={"match_1" as Id<"matches">}
            viewerId={viewerId}
            onSwitchGame={onSwitchGame}
        />
    );
}

const buttonWith = (text: string) =>
    Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes(text)
    );

beforeEach(() => {
    cleanup();
    matchStatus = "finished";
    continueMatch.mockClear();
    storeSession.mockClear();
    onSwitchGame.mockClear();
});

describe("ManualGameOverDialog", () => {
    it("names the conceder and reads the result from the viewer's seat", () => {
        renderOver("me");
        expect(document.body.textContent).toContain("Defeat");
        expect(document.body.textContent).toContain("Me conceded");
        expect(buttonWith("Back to Lobby")).toBeTruthy();
    });

    it("shows Victory to the seat that did not concede", () => {
        renderOver("opp");
        expect(document.body.textContent).toContain("Victory");
    });

    it("offers no Next game once the Match is decided", () => {
        renderOver("me");
        expect(buttonWith("Next game")).toBeFalsy();
    });

    it("builds the next Game from the Bo3 interstitial and re-points the session", async () => {
        matchStatus = "sideboarding";
        renderOver("me");

        const next = buttonWith("Next game");
        expect(next).toBeTruthy();
        fireEvent.click(next!);

        await waitFor(() =>
            expect(continueMatch).toHaveBeenCalledWith({ matchId: "match_1" })
        );
        await waitFor(() =>
            expect(onSwitchGame).toHaveBeenCalledWith("game_2", "me")
        );
        expect(storeSession).toHaveBeenCalledWith("game_2", "me");
    });

    it("still lets the player leave when the Match meta has not loaded", () => {
        matchStatus = null;
        renderOver("me");
        expect(buttonWith("Back to Lobby")).toBeTruthy();
    });
});

// The one ornament (ADR 0103 §5, issue #2729): same "moment" shape as the
// real GameOverDialog, minus the stats row (no life data on this screen).
describe("ManualGameOverDialog — the moment (issue #2729)", () => {
    it("renders the ornamental divider under the result", () => {
        const { baseElement } = renderOver("me");
        expect(
            baseElement.querySelector('[data-slot="ornamental-divider"]')
        ).toBeTruthy();
    });
});
