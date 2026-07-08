// G1 coin-toss + play/draw gate (CR 103.2-103.4). Covers the three viewer roles
// resolved by `interstitialChoiceState` and the `chooseFirstPlayer` dispatch.
// See `../pregame-dialog`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { PublicMatch } from "@convex/matches";
import PregameDialog from "../pregame-dialog";

const chooseFirstPlayer = vi.fn(() => Promise.resolve({ gameId: "g1" }));
let matchValue: PublicMatch | null | undefined;

vi.mock("convex/react", () => ({
    useMutation: () => chooseFirstPlayer,
    useQuery: () => matchValue,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        matches: { getMatch: { _name: "getMatch" } },
        game: { chooseFirstPlayer: { _name: "chooseFirstPlayer" } },
    },
}));

function baseMatch(overrides: Partial<PublicMatch> = {}): PublicMatch {
    return {
        matchId: "m1" as PublicMatch["matchId"],
        bestOf: 1,
        status: "pregame",
        currentGameNumber: 1,
        playDrawChooserId: "me",
        solo: false,
        vsAi: false,
        players: [
            { id: "me", name: "Me", bgColor: "#000", score: 0, ready: false },
            { id: "opp", name: "Opp", bgColor: "#111", score: 0, ready: false },
        ],
        ...overrides,
    };
}

beforeEach(() => {
    chooseFirstPlayer.mockClear();
    matchValue = baseMatch();
});

describe("PregameDialog — prompt (this client won the toss)", () => {
    it("shows the toss winner and Play/Draw choices", () => {
        matchValue = baseMatch({ playDrawChooserId: "me" });
        const { getByText, getAllByText } = render(
            <PregameDialog matchId={matchValue.matchId} viewerId="me" />
        );
        // Subtitle + the sr-only DialogDescription both carry the toss text.
        expect(getAllByText("Me won the toss").length).toBeGreaterThan(0);
        expect(getByText("Play")).toBeTruthy();
        expect(getByText("Draw")).toBeTruthy();
    });

    it("clicking Play submits choice 'play'", () => {
        matchValue = baseMatch({ playDrawChooserId: "me" });
        const { getByText } = render(
            <PregameDialog matchId={matchValue.matchId} viewerId="me" />
        );
        fireEvent.click(getByText("Play"));
        expect(chooseFirstPlayer).toHaveBeenCalledWith({
            matchId: "m1",
            choice: "play",
        });
    });

    it("clicking Draw submits choice 'draw'", () => {
        matchValue = baseMatch({ playDrawChooserId: "me" });
        const { getByText } = render(
            <PregameDialog matchId={matchValue.matchId} viewerId="me" />
        );
        fireEvent.click(getByText("Draw"));
        expect(chooseFirstPlayer).toHaveBeenCalledWith({
            matchId: "m1",
            choice: "draw",
        });
    });
});

describe("PregameDialog — waiting (opponent won the toss)", () => {
    it("shows a waiting notice and no choice buttons", () => {
        matchValue = baseMatch({ playDrawChooserId: "opp" });
        const { queryByText, getByText } = render(
            <PregameDialog matchId={matchValue.matchId} viewerId="me" />
        );
        expect(getByText("Opp")).toBeTruthy();
        expect(queryByText("Play")).toBeNull();
        expect(queryByText("Draw")).toBeNull();
        expect(chooseFirstPlayer).not.toHaveBeenCalled();
    });
});

describe("PregameDialog — auto (vs-AI bot won the toss)", () => {
    it("auto-continues once with no explicit choice", async () => {
        // vs-AI Match whose chooser is the bot seat (`-p2`, ADR 0001).
        matchValue = baseMatch({
            vsAi: true,
            playDrawChooserId: "user-p2",
            players: [
                {
                    id: "user-p1",
                    name: "Me",
                    bgColor: "#000",
                    score: 0,
                    ready: false,
                },
                {
                    id: "user-p2",
                    name: "AI",
                    bgColor: "#111",
                    score: 0,
                    ready: false,
                },
            ],
        });
        render(
            <PregameDialog matchId={matchValue.matchId} viewerId="user-p1" />
        );
        await waitFor(() => {
            expect(chooseFirstPlayer).toHaveBeenCalledTimes(1);
        });
        expect(chooseFirstPlayer).toHaveBeenCalledWith({ matchId: "m1" });
    });
});
