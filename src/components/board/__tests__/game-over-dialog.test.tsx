// Game-over screen contract (QA): the player can ALWAYS leave. The button used
// to be gated on `match.status === "finished" || match === null`, so any other
// Match state (meta still loading, an "active"/unknown status) rendered a
// game-over screen with no action at all and stranded the player on the board.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { PublicMatch } from "@convex/matches";
import type { GameOver, Player } from "~/types/game";

vi.mock("../sideboarding-dialog", () => ({ default: () => null }));
// Leaving is in-app router navigation (issue #10229): observed at the router.
const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

import GameOverDialog from "../game-over-dialog";

const PLAYERS = [
    { id: "me", name: "Me", life: 14 },
    { id: "opp", name: "Rival", life: 0 },
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
        /Back to (Lobby|event)/.test(b.textContent ?? "")
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

// Leaving a Match played INSIDE a Limited Event returns to the EVENT lobby —
// the general lobby strands the player away from their pool and the seats they
// still have to play. Leaving is IN-APP navigation, never a full-page load: a
// page unload let an in-flight request raise the browser's own "Leave site?"
// dialog (issue #10229).
describe("GameOverDialog — leaving an event Match", () => {
    const originalLocation = window.location;
    let href = "";

    beforeEach(() => {
        navigate.mockClear();
        href = "";
        Object.defineProperty(window, "location", {
            configurable: true,
            value: {
                ...originalLocation,
                set href(next: string) {
                    href = next;
                },
                get href() {
                    return href;
                },
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, "location", {
            configurable: true,
            value: originalLocation,
        });
    });

    it("labels the button by destination (issue #9990)", () => {
        renderOver({ ...makeMatch("finished"), limitedEventId: "ev_1" });
        expect(leaveButton()?.textContent).toBe("Back to event");
        cleanup();
        renderOver(makeMatch("finished"));
        expect(leaveButton()?.textContent).toBe("Back to Lobby");
    });

    it("returns to the event lobby when the Match is event-bound", () => {
        const match = makeMatch("finished");
        renderOver({ ...match, limitedEventId: "ev_1" });
        leaveButton()!.click();
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "ev_1" },
            replace: true,
        });
        expect(href).toBe("");
    });

    it("returns to the general lobby for an ordinary Match, with no page load", () => {
        renderOver(makeMatch("finished"));
        leaveButton()!.click();
        expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
        expect(href).toBe("");
    });
});

// The "moment" (ADR 0103 §26, issue #2729): TitleTreatment + the one
// ornament + a stats row, not a bespoke frame.
describe("GameOverDialog — the moment (issue #2729)", () => {
    it("renders the ornamental divider between the result and the stats row", () => {
        const { baseElement } = renderOver(null);
        expect(
            baseElement.querySelector('[data-slot="ornamental-divider"]')
        ).toBeTruthy();
    });

    it("renders each player's final life total in the stats row", () => {
        renderOver(null);
        expect(document.body.textContent).toContain("14");
        expect(document.body.textContent).toContain("Me life");
        expect(document.body.textContent).toContain("0");
        expect(document.body.textContent).toContain("Rival life");
    });

    it("shows both players' real life on a draw instead of a winner/loser fallback", () => {
        const drawOver = {
            winnerId: "",
            loserId: "",
            reason: "draw",
            isDraw: true,
        } as GameOver;
        render(
            <GameOverDialog
                gameOver={drawOver}
                allPlayers={PLAYERS}
                match={null}
                viewerId="me"
            />
        );
        expect(document.body.textContent).not.toContain("? life");
        expect(document.body.textContent).toContain("Me life");
        expect(document.body.textContent).toContain("Rival life");
    });
});
