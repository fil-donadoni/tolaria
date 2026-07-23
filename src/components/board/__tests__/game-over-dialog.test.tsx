// Game-over screen contract (QA): the player can ALWAYS leave. The button used
// to be gated on `match.status === "finished" || match === null`, so any other
// Match state (meta still loading, an "active"/unknown status) rendered a
// game-over screen with no action at all and stranded the player on the board.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { PublicMatch } from "@convex/matches";
import type { GameOver, Player } from "~/types/game";

vi.mock("../sideboarding-dialog", () => ({ default: () => null }));

import GameOverDialog from "../game-over-dialog";

const PLAYERS = [
    { id: "me", name: "Me" },
    { id: "opp", name: "Rival" },
] as unknown as Player[];

const GAME_OVER = {
    winnerId: "me",
    loserId: "opp",
    reason: "life",
} as GameOver;

function renderOver(match: PublicMatch | null) {
    return render(
        <GameOverDialog
            gameOver={GAME_OVER}
            allPlayers={PLAYERS}
            match={match}
            viewerId="me"
        />
    );
}

function makeMatch(status: string): PublicMatch {
    return {
        status,
        winner: "me",
        players: [
            { id: "me", name: "Me", score: 1 },
            { id: "opp", name: "Rival", score: 0 },
        ],
    } as unknown as PublicMatch;
}

const leaveButton = () =>
    Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Back to Lobby")
    );

beforeEach(() => cleanup());

describe("GameOverDialog — Back to Lobby", () => {
    it("offers Back to Lobby with no Match meta (single game)", () => {
        renderOver(null);
        expect(leaveButton()).toBeTruthy();
    });

    it("offers Back to Lobby on a decided Match", () => {
        renderOver(makeMatch("finished"));
        expect(leaveButton()).toBeTruthy();
    });

    it("offers Back to Lobby on the Bo3 interstitial, alongside Continue", () => {
        renderOver(makeMatch("sideboarding"));
        expect(leaveButton()).toBeTruthy();
        expect(document.body.textContent).toContain("Continue to Sideboarding");
    });

    it("offers Back to Lobby on any other Match status (the stranded case)", () => {
        renderOver(makeMatch("active"));
        expect(leaveButton()).toBeTruthy();
    });
});
